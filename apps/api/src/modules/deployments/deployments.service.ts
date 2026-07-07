import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Deployment, Prisma, ProjectType } from '../../generated/prisma';
import type { AiDiagnosis, DeploymentDetail, DeploymentView, PreviewDto } from '@deploybox/shared';
import { Queue } from 'bullmq';
import { readFile, rm } from 'fs/promises';
import { join, resolve } from 'path';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { DockerService } from '../../infra/docker/docker.service';
import { type ContainerStats } from '../../infra/docker/docker.service';
import { HostBackendBuilder } from '../../infra/builder/host-backend.builder';
import { CaddyService } from '../../infra/caddy/caddy.service';
import { SleepService } from '../../infra/sleep/sleep.service';
import { BuildRunnerService } from './build.runner.service';
import { AiService } from '../../infra/ai/ai.service';
import { GitService } from '../git/git.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { BUILD_QUEUE, type BuildJobData } from './queue.constants';

@Injectable()
export class DeploymentsService {
  private readonly logger = new Logger(DeploymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly docker: DockerService,
    private readonly caddy: CaddyService,
    private readonly sleepSvc: SleepService,
    private readonly runner: BuildRunnerService,
    private readonly hostBackend: HostBackendBuilder,
    private readonly ai: AiService,
    private readonly flags: FeatureFlagsService,
    private readonly git: GitService,
    private readonly cryptoSvc: CryptoService,
    @Optional() @InjectQueue(BUILD_QUEUE) private readonly buildQueue: Queue<BuildJobData> | null,
  ) {
    if (buildQueue) {
      this.logger.log('Chế độ Queue (Redis) — build chạy nền qua BullMQ');
    } else {
      this.logger.log('Chế độ Direct — build chạy thẳng (không cần Redis)');
    }
  }

  private static readonly ROLE_ORDER = { MEMBER: 0, OWNER: 1 } as const;

  private async assertRole(userId: string, teamId: string, min: 'MEMBER' | 'OWNER'): Promise<void> {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Bạn không thuộc team này');
    if (DeploymentsService.ROLE_ORDER[member.role] < DeploymentsService.ROLE_ORDER[min]) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này');
    }
  }

  /** MEMBER chỉ thao tác được project được cấp quyền; OWNER thì mọi project của team. */
  private async assertProjectAccess(
    userId: string,
    project: { id: string; teamId: string },
  ): Promise<void> {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Bạn không thuộc team này');
    if (member.role === 'OWNER') return;
    const access = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId } },
    });
    if (!access) {
      throw new ForbiddenException('Bạn không được cấp quyền dùng project này');
    }
  }

  private async loadOwnedProject(userId: string, projectId: string, min: 'MEMBER' | 'OWNER' = 'MEMBER') {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Không tìm thấy project');
    if (min === 'OWNER') {
      await this.assertRole(userId, project.teamId, 'OWNER');
    } else {
      await this.assertProjectAccess(userId, project);
    }
    return project;
  }

  async deploy(userId: string, projectId: string): Promise<DeploymentDetail> {
    return this.enqueue(userId, projectId, 'MANUAL');
  }

  async redeploy(userId: string, projectId: string): Promise<DeploymentDetail> {
    return this.enqueue(userId, projectId, 'REDEPLOY');
  }

  async rollback(
    userId: string,
    deploymentId: string,
  ): Promise<DeploymentDetail> {
    const src = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { project: true },
    });
    if (!src) throw new NotFoundException('Không tìm thấy deployment');
    await this.assertProjectAccess(userId, src.project);
    const deployment = await this.prisma.deployment.create({
      data: {
        projectId: src.projectId,
        status: 'QUEUED',
        trigger: 'REDEPLOY',
        createdBy: userId,
      },
    });
    this.dispatch({ deploymentId: deployment.id, rollbackOf: deploymentId });
    return this.toDetail(deployment);
  }

  /** Trigger từ webhook git (đã xác thực ở WebhooksService — không kiểm user). */
  async deployFromPush(
    projectId: string,
    commitSha?: string,
    commitMsg?: string,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project?.gitRepoUrl) return;
    const deployment = await this.prisma.deployment.create({
      data: {
        projectId,
        status: 'QUEUED',
        trigger: 'GIT_PUSH',
        commitSha,
        commitMsg,
      },
    });
    this.dispatch({ deploymentId: deployment.id });
  }

  /** Direct mode: nối tiếp các build (1 build/lúc) — tránh nhiều build cùng ăn RAM → OOM app khác. */
  private buildChain: Promise<void> = Promise.resolve();
  private queuedBuilds = 0;

  private dispatch(data: BuildJobData): void {
    if (this.buildQueue) {
      // Có Redis → BullMQ tự quản concurrency
      void this.buildQueue.add('build', data, { removeOnComplete: 50, removeOnFail: 50 });
      return;
    }
    // Không Redis → hàng đợi trong tiến trình, chạy TUẦN TỰ
    this.queuedBuilds++;
    if (this.queuedBuilds > 1) {
      this.logger.log(`Build đang bận — xếp hàng (còn ${this.queuedBuilds - 1} chờ trước)`);
    }
    this.buildChain = this.buildChain
      .catch(() => undefined) // 1 build lỗi không chặn build sau
      .then(() => this.runner.run(data).catch((e) => this.logger.error(e)))
      .finally(() => { this.queuedBuilds--; });
  }

  private async enqueue(
    userId: string,
    projectId: string,
    trigger: 'MANUAL' | 'REDEPLOY',
  ): Promise<DeploymentDetail> {
    const project = await this.loadOwnedProject(userId, projectId, 'MEMBER');
    if (!project.gitRepoUrl) {
      throw new BadRequestException('Project chưa có Git repo URL để deploy');
    }
    const deployment = await this.prisma.deployment.create({
      data: { projectId, status: 'QUEUED', trigger, createdBy: userId },
    });
    this.dispatch({ deploymentId: deployment.id });
    return this.toDetail(deployment);
  }

  async stop(userId: string, projectId: string): Promise<{ ok: true }> {
    const project = await this.loadOwnedProject(userId, projectId, 'MEMBER');
    if (project.type === 'STATIC') {
      const dataDir = resolve(
        process.cwd(),
        this.config.get<string>('DATA_DIR', '.deploybox-data'),
      );
      await rm(join(dataDir, 'sites', project.slug), {
        recursive: true,
        force: true,
      });
    } else if ((project as { useDocker?: boolean }).useDocker === false) {
      // BACKEND chạy host → kill process theo pidfile
      const dataDir = resolve(
        process.cwd(),
        this.config.get<string>('DATA_DIR', '.deploybox-data'),
      );
      await this.hostBackend.stop(dataDir, project.slug).catch(() => undefined);
    } else {
      await this.docker
        .remove(`deploybox-${project.slug}`)
        .catch(() => undefined);
    }
    const latest = await this.prisma.deployment.findFirst({
      where: { projectId, status: 'RUNNING' },
      orderBy: { queuedAt: 'desc' },
    });
    if (latest) {
      await this.prisma.deployment.update({
        where: { id: latest.id },
        data: { status: 'STOPPED' },
      });
    }
    await this.prisma.domain.updateMany({
      where: { projectId, isPrimary: true },
      data: { status: 'PENDING_DNS' },
    });
    await this.caddy.sync().catch(() => undefined);
    return { ok: true };
  }

  async sleepProject(
    userId: string,
    projectId: string,
  ): Promise<{ ok: boolean }> {
    await this.loadOwnedProject(userId, projectId, 'MEMBER');
    return { ok: await this.sleepSvc.sleep(projectId) };
  }

  /** Đánh thức app đang ngủ từ nút UI (bình thường request đầu vào URL cũng tự đánh thức). */
  async wakeProject(
    userId: string,
    projectId: string,
  ): Promise<{ ok: boolean }> {
    const project = await this.loadOwnedProject(userId, projectId, 'MEMBER');
    return { ok: await this.sleepSvc.wake(project.slug) };
  }

  async list(
    userId: string,
    projectId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: DeploymentDetail[]; total: number; page: number; pageSize: number }> {
    await this.loadOwnedProject(userId, projectId);
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const safePage = Math.max(1, page);
    const [deployments, total] = await Promise.all([
      this.prisma.deployment.findMany({
        where: { projectId },
        orderBy: { queuedAt: 'desc' },
        take: safeLimit,
        skip: (safePage - 1) * safeLimit,
      }),
      this.prisma.deployment.count({ where: { projectId } }),
    ]);
    return { data: deployments.map((d) => this.toDetail(d)), total, page: safePage, pageSize: safeLimit };
  }

  async getView(userId: string, deploymentId: string): Promise<DeploymentView> {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { project: true },
    });
    if (!deployment) throw new NotFoundException('Không tìm thấy deployment');
    await this.assertProjectAccess(userId, deployment.project);

    const logs = await this.readLogs(deploymentId);
    const isMobile = deployment.project.type === ProjectType.MOBILE;
    const url = isMobile ? null : this.resolveUrl(deployment);
    const artifactUrl = isMobile
      ? this.resolveArtifactUrl(deployment)
      : null;

    return {
      deployment: this.toDetail(deployment),
      project: {
        id: deployment.project.id,
        name: deployment.project.name,
        slug: deployment.project.slug,
        type: deployment.project.type,
      },
      url,
      artifactUrl,
      logs,
    };
  }

  private resolveUrl(deployment: {
    status: string;
    project: { slug: string };
  }): string | null {
    if (deployment.status !== 'RUNNING') return null;
    return this.caddy.publicUrl(deployment.project.slug);
  }

  private resolveArtifactUrl(deployment: {
    status: string;
    staticPath?: string | null;
  }): string | null {
    if (deployment.status !== 'RUNNING' || !deployment.staticPath) return null;
    const apiUrl = this.config.get<string>('PUBLIC_API_URL', `http://localhost:${this.config.get('PORT', 4000)}`);
    return `${apiUrl}/${deployment.staticPath}`;
  }

  private async readLogs(deploymentId: string): Promise<string> {
    const dataDir = resolve(
      process.cwd(),
      this.config.get<string>('DATA_DIR', '.deploybox-data'),
    );
    try {
      return await readFile(
        join(dataDir, 'logs', `${deploymentId}.log`),
        'utf8',
      );
    } catch {
      return '';
    }
  }

  /** Dùng bởi controller SSE — trả về nội dung log file. */
  async getLogs(deploymentId: string): Promise<string> {
    return this.readLogs(deploymentId);
  }

  /** Dùng bởi controller SSE — xác minh quyền truy cập và trả về status. */
  async getDeploymentForStream(
    userId: string,
    deploymentId: string,
  ): Promise<{ status: string; projectSlug: string; projectType: string }> {
    const d = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { project: true },
    });
    if (!d) throw new NotFoundException('Không tìm thấy deployment');
    await this.assertProjectAccess(userId, d.project);
    return { status: d.status, projectSlug: d.project.slug, projectType: d.project.type };
  }

  /** Container metrics cho BACKEND project đang chạy. */
  async getContainerMetrics(
    userId: string,
    projectId: string,
  ): Promise<ContainerStats | null> {
    const project = await this.loadOwnedProject(userId, projectId);
    if (project.type !== 'BACKEND') return null;
    return this.docker.stats(`deploybox-${project.slug}`);
  }

  /** Cache release notes theo deployment. */
  private notesCache = new Map<string, string>();

  /** 📝 Release notes: commit giữa bản deploy này và bản thành công TRƯỚC nó. */
  async releaseNotes(userId: string, deploymentId: string): Promise<{ notes: string; commits: number }> {
    if (!this.flags.aiEnabled('ai_release_notes')) {
      throw new BadRequestException('Tính năng "Release notes" đang tắt (Admin → Tính năng hệ thống).');
    }
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { project: true },
    });
    if (!deployment) throw new NotFoundException('Không tìm thấy deployment');
    await this.assertProjectAccess(userId, deployment.project);
    const p = deployment.project;
    if (!p.gitRepoUrl) throw new BadRequestException('Project không có Git repo');

    const cached = this.notesCache.get(deploymentId);
    if (cached) return { notes: cached, commits: -1 };

    // Bản thành công gần nhất TRƯỚC bản này (để lấy khoảng commit)
    const prev = await this.prisma.deployment.findFirst({
      where: {
        projectId: p.id,
        queuedAt: { lt: deployment.queuedAt },
        commitSha: { not: null },
        status: { in: ['RUNNING', 'STOPPED', 'SLEEPING'] },
      },
      orderBy: { queuedAt: 'desc' },
      select: { commitSha: true },
    });
    const token = p.gitToken
      ? (() => { try { return this.cryptoSvc.decrypt(p.gitToken!); } catch { return undefined; } })()
      : undefined;
    const commits = await this.git.listCommits(
      p.gitRepoUrl,
      token,
      p.gitBranch,
      prev?.commitSha && deployment.commitSha ? prev.commitSha : null,
      prev?.commitSha && deployment.commitSha ? deployment.commitSha : null,
    );
    if (!commits.length) throw new BadRequestException('Không có commit nào để tóm tắt');

    const notes = await this.ai.releaseNotes(p.name, commits);
    this.notesCache.set(deploymentId, notes);
    if (this.notesCache.size > 200) {
      const first = this.notesCache.keys().next().value;
      if (first) this.notesCache.delete(first);
    }
    return { notes, commits: commits.length };
  }

  /** 💡 Gợi ý vận hành: đọc access log Caddy → giờ vắng/bận + gợi ý sleep/chọn server. */
  async opsAdvice(userId: string, projectId: string): Promise<{ advice: string }> {
    if (!this.flags.aiEnabled('ai_ops_advice')) {
      throw new BadRequestException('Tính năng "Gợi ý vận hành" đang tắt (Admin → Tính năng hệ thống).');
    }
    const project = await this.loadOwnedProject(userId, projectId);

    // Đếm request theo giờ-trong-ngày từ access log (JSON mỗi dòng, có field request.host)
    const dataDir = resolve(process.cwd(), this.config.get<string>('DATA_DIR', '.deploybox-data'));
    const logText = await readFile(join(dataDir, 'caddy', 'access.log'), 'utf8').catch(() => '');
    const lines = logText.split('\n').slice(-50_000);
    const byHour = new Array(24).fill(0);
    let total = 0;
    for (const line of lines) {
      if (!line.includes(project.slug)) continue;
      try {
        const j = JSON.parse(line);
        const host: string = j.request?.host ?? '';
        if (!host.startsWith(project.slug + '.')) continue;
        const d = new Date((j.ts ?? 0) * 1000);
        byHour[d.getHours()]++;
        total++;
      } catch { /* dòng hỏng */ }
    }

    const servers = await this.prisma.server.findMany({
      where: { teamId: project.teamId },
      select: { name: true, type: true, projects: { select: { id: true } } },
    });
    const stats = [
      `App: ${project.name} (sleepEnabled=${project.sleepEnabled}, memoryMb=${project.memoryMb})`,
      `Tổng request ghi nhận: ${total}`,
      'Request theo giờ trong ngày (0-23h): ' + byHour.map((c, h) => `${h}h:${c}`).join(', '),
      `Server của team: ${servers.map((s) => `${s.name}(${s.type}, ${s.projects.length} project)`).join('; ') || '(chỉ local)'}`,
    ].join('\n');

    const advice = await this.ai.answer(
      'Dựa vào số liệu, gợi ý: 1) có nên bật chế độ ngủ (sleep) không và khung giờ nào vắng, ' +
        '2) app nên đặt ở server nào (nếu có nhiều server), 3) 1 gợi ý tối ưu khác nếu thấy. ' +
        'Ngắn gọn ~6 dòng. Không có dữ liệu thì nói thẳng cần chạy thêm vài ngày.',
      stats,
    );
    return { advice };
  }

  private toDetail(d: Deployment): DeploymentDetail {
    return {
      id: d.id,
      projectId: d.projectId,
      status: d.status,
      trigger: d.trigger,
      commitSha: d.commitSha,
      commitMsg: d.commitMsg,
      queuedAt: d.queuedAt.toISOString(),
      startedAt: d.startedAt?.toISOString() ?? null,
      finishedAt: d.finishedAt?.toISOString() ?? null,
      errorMessage: d.errorMessage,
      aiDiagnosis: (d.aiDiagnosis as unknown as AiDiagnosis | null) ?? null,
    };
  }

  /** Cache tóm tắt log theo deployment (log bất biến khi deploy đã kết thúc). */
  private summaryCache = new Map<string, string>();

  /** AI tóm tắt build log của 1 deployment (cache RAM). */
  async summarize(userId: string, deploymentId: string): Promise<{ summary: string }> {
    if (!this.flags.aiEnabled('ai_log_summary')) {
      throw new BadRequestException('Tính năng "Tóm tắt build log" đang tắt (Admin → Tính năng hệ thống).');
    }
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { project: true },
    });
    if (!deployment) throw new NotFoundException('Không tìm thấy deployment');
    await this.assertProjectAccess(userId, deployment.project);

    const cached = this.summaryCache.get(deploymentId);
    if (cached) return { summary: cached };

    const log = await this.readLogs(deploymentId);
    if (!log.trim()) throw new BadRequestException('Deployment này chưa có log');

    const summary = await this.ai.summarizeLog(deployment.project.name, log);
    // Chỉ cache khi deploy đã kết thúc (log không đổi nữa)
    if (['RUNNING', 'FAILED', 'STOPPED', 'CANCELLED', 'SLEEPING'].includes(deployment.status)) {
      this.summaryCache.set(deploymentId, summary);
      if (this.summaryCache.size > 200) {
        const first = this.summaryCache.keys().next().value;
        if (first) this.summaryCache.delete(first);
      }
    }
    return { summary };
  }

  /**
   * AI "bác sĩ lỗi deploy": đọc log bản deploy này → nguyên nhân + cách sửa.
   * Lưu kết quả vào deployment.aiDiagnosis (cache) để lần sau không gọi lại.
   */
  async diagnose(userId: string, deploymentId: string): Promise<DeploymentDetail> {
    if (!this.flags.aiEnabled('ai_diagnosis')) {
      throw new BadRequestException('Tính năng "Bác sĩ lỗi deploy" đang tắt (Admin → Tính năng hệ thống).');
    }
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { project: true },
    });
    if (!deployment) throw new NotFoundException('Không tìm thấy deployment');
    await this.assertProjectAccess(userId, deployment.project);

    const p = deployment.project;
    const log = await this.readLogs(deploymentId);
    const diagnosis = await this.ai.diagnose({
      projectId: p.id,
      projectName: p.name,
      projectType: p.type,
      useDocker: p.useDocker,
      installCommand: p.installCommand,
      buildCommand: p.buildCommand,
      startCommand: p.startCommand,
      outputDir: p.outputDir,
      internalPort: p.internalPort,
      rootDir: p.rootDir,
      errorMessage: deployment.errorMessage,
      log,
    });

    const updated = await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { aiDiagnosis: diagnosis as unknown as Prisma.InputJsonValue },
    });
    return this.toDetail(updated);
  }

  // ─── PREVIEW DEPLOY THEO PULL REQUEST (A1) ────────────────────────────────
  // Mỗi PR mở ra → tạo 1 "shadow project" ẩn (isPreview) build từ nhánh PR,
  // chạy ở port riêng, phục vụ tại <pr-N-slug>.<domain>. PR đóng → xoá sạch.
  // Tái dùng nguyên pipeline build/Caddy/teardown qua deployFromPush.

  /**
   * Xử lý webhook Pull Request (đã xác thực chữ ký ở WebhooksService).
   * project = project GỐC (parent). Trả về mô tả hành động để ghi log webhook.
   */
  async handlePullRequest(
    project: PreviewParent,
    source: string,
    payload: unknown,
  ): Promise<{ deployed: boolean; reason: string }> {
    const ev = this.parsePrEvent(source, payload as PrPayload);
    if (!ev) return { deployed: false, reason: 'Sự kiện PR không đọc được' };
    if (ev.kind === 'ignore') {
      return { deployed: false, reason: `Bỏ qua PR #${ev.prNumber}: ${ev.reason ?? 'action khác'}` };
    }
    // 🔒 Bảo mật: CHỈ preview PR cùng repo. PR từ fork = code người ngoài;
    // host chạy thẳng (không sandbox) → tuyệt đối không build/chạy code fork.
    if (!ev.sameRepo) {
      return { deployed: false, reason: `Bỏ qua PR #${ev.prNumber}: từ fork (không chạy code ngoài)` };
    }
    if (project.type === 'MOBILE') {
      return { deployed: false, reason: 'Project MOBILE không hỗ trợ preview' };
    }

    if (ev.kind === 'teardown') {
      const removed = await this.teardownPreview(project.id, ev.prNumber);
      return {
        deployed: false,
        reason: removed ? `Đã xoá preview PR #${ev.prNumber}` : `Không có preview PR #${ev.prNumber} để xoá`,
      };
    }

    // opened / reopened / synchronize → tạo (nếu chưa có) rồi deploy nhánh PR
    const preview = await this.createOrUpdatePreview(project, ev.prNumber, ev.branch);
    const commitMsg = ev.title ? `PR #${ev.prNumber}: ${ev.title}` : `PR #${ev.prNumber}`;
    await this.deployFromPush(preview.id, ev.sha, commitMsg);
    return {
      deployed: true,
      reason: `Preview PR #${ev.prNumber} đang deploy → ${this.caddy.publicUrl(preview.slug)}`,
    };
  }

  /** Chuẩn hoá payload PR của GitHub / GitLab về 1 dạng chung. */
  private parsePrEvent(source: string, data: PrPayload): PrEvent | null {
    if (source === 'github') {
      const pr = data.pull_request;
      const num = typeof data.number === 'number' ? data.number : pr?.number;
      if (!pr || typeof num !== 'number') return null;
      const sameRepo =
        !!pr.head?.repo?.full_name &&
        pr.head.repo.full_name === pr.base?.repo?.full_name;
      const branch = pr.head?.ref ?? '';
      if (data.action === 'closed') {
        return { kind: 'teardown', prNumber: num, branch, sameRepo };
      }
      if (data.action === 'opened' || data.action === 'reopened' || data.action === 'synchronize') {
        return { kind: 'upsert', prNumber: num, branch, sha: pr.head?.sha, title: pr.title, sameRepo };
      }
      return { kind: 'ignore', prNumber: num, branch, sameRepo, reason: `action ${data.action}` };
    }
    if (source === 'gitlab') {
      const a = data.object_attributes;
      if (!a || typeof a.iid !== 'number') return null;
      const sameRepo = a.source_project_id === a.target_project_id;
      const branch = a.source_branch ?? '';
      if (a.action === 'close' || a.action === 'merge') {
        return { kind: 'teardown', prNumber: a.iid, branch, sameRepo };
      }
      if (a.action === 'open' || a.action === 'reopen' || a.action === 'update') {
        return { kind: 'upsert', prNumber: a.iid, branch, sha: a.last_commit?.id, title: a.title, sameRepo };
      }
      return { kind: 'ignore', prNumber: a.iid, branch, sameRepo, reason: `action ${a.action}` };
    }
    return null; // Bitbucket PR chưa hỗ trợ preview (chỉ push)
  }

  /** Tạo preview project mới hoặc trả lại cái đã có (đồng bộ nhánh nếu đổi). */
  private async createOrUpdatePreview(
    parent: PreviewParent,
    prNumber: number,
    branch: string,
  ): Promise<{ id: string; slug: string }> {
    const existing = await this.prisma.project.findFirst({
      where: { parentProjectId: parent.id, prNumber },
    });
    if (existing) {
      if (branch && existing.gitBranch !== branch) {
        await this.prisma.project.update({
          where: { id: existing.id },
          data: { gitBranch: branch },
        });
      }
      return { id: existing.id, slug: existing.slug };
    }

    const port = await this.allocatePreviewPort();
    const slug = `pr-${prNumber}-${parent.slug}`.slice(0, 63);
    const preview = await this.prisma.project.create({
      data: {
        teamId: parent.teamId,
        name: `${parent.name} · PR #${prNumber}`,
        slug,
        type: parent.type as ProjectType,
        gitProvider: parent.gitProvider,
        gitRepoUrl: parent.gitRepoUrl,
        gitBranch: branch || parent.gitBranch,
        rootDir: parent.rootDir,
        gitToken: parent.gitToken, // đã mã hoá at-rest — copy nguyên chuỗi
        autoDeploy: false, // preview không tự trigger; không có webhook riêng
        installCommand: parent.installCommand,
        buildCommand: parent.buildCommand,
        startCommand: parent.startCommand,
        outputDir: parent.outputDir,
        preDeployCommand: parent.preDeployCommand,
        postDeployCommand: parent.postDeployCommand,
        internalPort: port,
        buildImage: parent.buildImage,
        artifactPath: parent.artifactPath,
        useDocker: parent.useDocker,
        requiredEnvKeys: parent.requiredEnvKeys ?? [],
        memoryMb: parent.memoryMb,
        cpuLimit: parent.cpuLimit,
        serverId: parent.serverId,
        isPreview: true,
        parentProjectId: parent.id,
        prNumber,
      },
      select: { id: true, slug: true },
    });

    // Copy env vars của parent (value đã mã hoá/plain đúng như lưu → copy nguyên)
    const envs = await this.prisma.envVar.findMany({
      where: { projectId: parent.id },
      select: { key: true, value: true, isSecret: true, target: true },
    });
    if (envs.length) {
      await this.prisma.envVar.createMany({
        data: envs.map((e) => ({ projectId: preview.id, ...e })),
      });
    }
    return preview;
  }

  /** Chọn 1 port trống trong dải preview 7000–7999 (tránh trùng project khác). */
  private async allocatePreviewPort(): Promise<number> {
    const rows = await this.prisma.project.findMany({
      where: { internalPort: { gte: 7000, lte: 7999 } },
      select: { internalPort: true },
    });
    const used = new Set(rows.map((r) => r.internalPort));
    for (let p = 7000; p <= 7999; p++) if (!used.has(p)) return p;
    throw new BadRequestException('Hết port preview (7000–7999) — đóng bớt PR cũ.');
  }

  /** Dừng runtime + xoá hẳn preview project (cascade deployment/env) + reload Caddy. */
  private async teardownPreview(parentId: string, prNumber: number): Promise<boolean> {
    const preview = await this.prisma.project.findFirst({
      where: { parentProjectId: parentId, prNumber },
      select: { id: true, slug: true, type: true, useDocker: true },
    });
    if (!preview) return false;

    await this.stopRuntime(preview).catch(() => undefined);

    const dataDir = resolve(
      process.cwd(),
      this.config.get<string>('DATA_DIR', '.deploybox-data'),
    );
    const deps = await this.prisma.deployment.findMany({
      where: { projectId: preview.id },
      select: { id: true },
    });
    await this.prisma.project.delete({ where: { id: preview.id } });
    for (const { id } of deps) {
      await rm(join(dataDir, 'logs', `${id}.log`), { force: true }).catch(() => undefined);
      await rm(join(dataDir, 'artifacts', id), { recursive: true, force: true }).catch(() => undefined);
    }
    if (preview.type === 'STATIC') {
      await rm(join(dataDir, 'sites', preview.slug), { recursive: true, force: true }).catch(() => undefined);
    }
    await this.caddy.sync().catch(() => undefined);
    return true;
  }

  /** Dừng process/container đang chạy của 1 project (dùng khi teardown preview). */
  private async stopRuntime(project: {
    type: string;
    slug: string;
    useDocker: boolean;
  }): Promise<void> {
    const dataDir = resolve(
      process.cwd(),
      this.config.get<string>('DATA_DIR', '.deploybox-data'),
    );
    if (project.type === 'STATIC') {
      await rm(join(dataDir, 'sites', project.slug), { recursive: true, force: true });
    } else if (project.useDocker === false) {
      await this.hostBackend.stop(dataDir, project.slug);
    } else {
      await this.docker.remove(`deploybox-${project.slug}`);
    }
  }

  /** Danh sách preview đang sống của 1 project (cho UI). */
  async listPreviews(userId: string, projectId: string): Promise<PreviewDto[]> {
    const project = await this.loadOwnedProject(userId, projectId);
    const previews = await this.prisma.project.findMany({
      where: { parentProjectId: project.id },
      orderBy: { prNumber: 'asc' },
      include: { deployments: { orderBy: { queuedAt: 'desc' }, take: 1 } },
    });
    return previews.map((p) => {
      const status = p.deployments[0]?.status ?? 'NONE';
      return {
        id: p.id,
        prNumber: p.prNumber ?? 0,
        branch: p.gitBranch,
        slug: p.slug,
        status,
        url: status === 'RUNNING' ? this.caddy.publicUrl(p.slug) : null,
        createdAt: p.createdAt.toISOString(),
      };
    });
  }
}

// ─── Kiểu dữ liệu nội bộ cho preview ─────────────────────────────────────────

/** Project GỐC cần đủ field để nhân bản sang preview. */
interface PreviewParent {
  id: string;
  teamId: string;
  name: string;
  slug: string;
  type: string;
  gitProvider: import('../../generated/prisma').GitProvider | null;
  gitRepoUrl: string | null;
  gitBranch: string;
  rootDir: string;
  gitToken: string | null;
  installCommand: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  outputDir: string | null;
  preDeployCommand: string | null;
  postDeployCommand: string | null;
  buildImage: string | null;
  artifactPath: string | null;
  useDocker: boolean;
  requiredEnvKeys: string[];
  memoryMb: number;
  cpuLimit: number;
  serverId: string | null;
  previewEnabled: boolean;
}

type PrEventKind = 'upsert' | 'teardown' | 'ignore';
interface PrEvent {
  kind: PrEventKind;
  prNumber: number;
  branch: string;
  sha?: string;
  title?: string;
  sameRepo: boolean;
  reason?: string;
}

/** Payload thô của webhook PR (GitHub / GitLab) — chỉ khai field ta đọc. */
interface PrPayload {
  action?: string;
  number?: number;
  pull_request?: {
    number?: number;
    title?: string;
    head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
    base?: { ref?: string; repo?: { full_name?: string } };
    merged?: boolean;
  };
  object_attributes?: {
    iid?: number;
    action?: string;
    source_branch?: string;
    title?: string;
    last_commit?: { id?: string };
    source_project_id?: number;
    target_project_id?: number;
  };
}
