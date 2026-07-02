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
import type { AiDiagnosis, DeploymentDetail, DeploymentView } from '@deploybox/shared';
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

  private dispatch(data: BuildJobData): void {
    if (this.buildQueue) {
      void this.buildQueue.add('build', data, { removeOnComplete: 50, removeOnFail: 50 });
    } else {
      setImmediate(() => this.runner.run(data).catch((e) => this.logger.error(e)));
    }
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
}
