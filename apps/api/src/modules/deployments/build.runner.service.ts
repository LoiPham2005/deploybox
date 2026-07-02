import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFileSync, mkdirSync } from 'fs';
import { readFile, readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import type { Prisma, Project } from '../../generated/prisma';
import { type BuildLogger, HostStaticBuilder } from '../../infra/builder/host-static.builder';
import { DockerBackendEngine } from '../../infra/builder/docker-backend.engine';
import { HostBackendBuilder } from '../../infra/builder/host-backend.builder';
import { MobileBuilder } from '../../infra/builder/mobile.builder';
import { CaddyService } from '../../infra/caddy/caddy.service';
import { CleanupService } from '../../infra/cleanup/cleanup.service';
import { NotifyService } from '../../infra/notify/notify.service';
import { AiService } from '../../infra/ai/ai.service';
import { DockerService } from '../../infra/docker/docker.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LogBroadcastService } from '../../infra/log-broadcast/log-broadcast.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SshService } from '../../infra/ssh/ssh.service';
import { EnvService } from '../env/env.service';
import { buildGitAuthUrl } from '../../common/git-auth.util';
import { maskSecrets, opsTip } from '../git/secret-scan.util';
import type { BuildJobData } from './queue.constants';

/**
 * Chứa toàn bộ logic build/deploy thực tế.
 * Được dùng bởi cả BuildProcessor (Redis mode) và DeploymentsService (direct mode).
 */
@Injectable()
export class BuildRunnerService {
  private readonly logger = new Logger(BuildRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly builder: HostStaticBuilder,
    private readonly dockerEngine: DockerBackendEngine,
    private readonly hostBackend: HostBackendBuilder,
    private readonly mobileBuilder: MobileBuilder,
    private readonly caddy: CaddyService,
    private readonly cleanup: CleanupService,
    private readonly env: EnvService,
    private readonly broadcast: LogBroadcastService,
    private readonly crypto: CryptoService,
    private readonly ssh: SshService,
    private readonly notify: NotifyService,
    private readonly ai: AiService,
    private readonly docker: DockerService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /** chat_id Telegram của các thành viên team đã nối (để gửi thông báo deploy). */
  private async telegramRecipients(teamId: string): Promise<string[]> {
    const members = await this.prisma.teamMember.findMany({
      where: { teamId },
      select: { user: { select: { telegramChatId: true } } },
    });
    return members
      .map((m) => m.user.telegramChatId)
      .filter((x): x is string => !!x);
  }

  /**
   * Inject PAT vào HTTPS clone URL. Tự detect kiểu xác thực theo prefix token + host
   * để hỗ trợ GitHub (classic + fine-grained), GitLab và Bitbucket access token.
   */
  private cloneUrl(repoUrl: string, token?: string | null): string {
    return buildGitAuthUrl(repoUrl, token, 'auto');
  }

  async run(data: BuildJobData): Promise<void> {
    const { deploymentId, rollbackOf } = data;
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { project: true },
    });
    if (!deployment) return;
    const project = deployment.project;

    const dataDir = resolve(
      process.cwd(),
      this.config.get<string>('DATA_DIR', '.deploybox-data'),
    );
    const logsDir = join(dataDir, 'logs');
    mkdirSync(logsDir, { recursive: true });
    const logFile = join(logsDir, `${deploymentId}.log`);

    // 🕶️ Che secret trong log: giá trị env bí mật của project + token khớp pattern.
    // Che TỪ NGUỒN → file log, SSE stream và cả AI đọc log đều chỉ thấy bản đã che.
    let secretValues: string[] = [];
    if (this.flags.aiEnabled('ai_log_masking')) {
      try {
        const secretRows = await this.prisma.envVar.findMany({
          where: { projectId: project.id, isSecret: true },
          select: { key: true },
        });
        if (secretRows.length) {
          const resolved = {
            ...(await this.env.resolveForPhase(project.id, 'build')),
            ...(await this.env.resolveForPhase(project.id, 'runtime')),
          };
          secretValues = secretRows
            .map((r) => resolved[r.key])
            .filter((v): v is string => !!v && v.length >= 6);
        }
      } catch {
        /* không chặn deploy vì masking */
      }
    }
    const mask = this.flags.aiEnabled('ai_log_masking')
      ? (line: string) => maskSecrets(line, secretValues)
      : (line: string) => line;

    const log: BuildLogger = (line) => {
      const safe = mask(line);
      appendFileSync(logFile, safe + '\n');
      this.broadcast.emit(deploymentId, safe);
    };

    // Timeout để kill build bị treo
    const timeoutMin = this.config.get<number>('BUILD_TIMEOUT_MINUTES', 30);
    const controller = new AbortController();
    const tid = setTimeout(() => {
      controller.abort();
      log(`=== BUILD TIMEOUT sau ${timeoutMin} phút ===`, 'stderr');
    }, timeoutMin * 60_000);

    // Decrypt git token nếu có (không log)
    const gitToken = project.gitToken
      ? (() => { try { return this.crypto.decrypt(project.gitToken!); } catch { return null; } })()
      : null;

    try {
      if (!rollbackOf && !project.gitRepoUrl) {
        throw new Error('Project chưa có Git repo URL để deploy');
      }
      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: 'BUILDING', startedAt: new Date() },
      });
      log('=== BẮT ĐẦU BUILD ===', 'stdout');

      // 🛡️ Gác lệnh phá dữ liệu: chặn deploy nếu lệnh cấu hình chứa lệnh nguy hiểm.
      // Cố ý dùng → admin tắt flag "Gác lệnh phá dữ liệu" rồi deploy lại.
      if (!rollbackOf && this.flags.aiEnabled('ai_migration_guard')) {
        const DANGEROUS: { re: RegExp; name: string }[] = [
          { re: /prisma\s+(db\s+push\s+.*--force-reset|migrate\s+reset)/i, name: 'prisma migrate reset / --force-reset (XÓA toàn bộ dữ liệu)' },
          { re: /migrate(:|\s+)fresh/i, name: 'migrate fresh (drop hết bảng)' },
          { re: /drop\s+(table|database|schema)/i, name: 'DROP TABLE/DATABASE' },
          { re: /truncate\s+table/i, name: 'TRUNCATE TABLE' },
          { re: /flushall|flushdb/i, name: 'redis FLUSHALL/FLUSHDB' },
        ];
        const cmds = [project.installCommand, project.buildCommand, project.startCommand]
          .filter(Boolean)
          .join(' && ');
        const hit = DANGEROUS.find((d) => d.re.test(cmds));
        if (hit) {
          throw new Error(
            `🛡️ Chặn deploy: lệnh cấu hình chứa "${hit.name}" — chạy sẽ MẤT DỮ LIỆU. ` +
              'Sửa lệnh trong Sửa cấu hình, hoặc nếu cố ý thì tắt "AI · Gác lệnh phá dữ liệu" ở Admin.',
          );
        }
      }

      // ⚠️ Cảnh báo env thiếu (requiredEnvKeys do AI đọc từ repo) — chỉ báo, không chặn
      const requiredKeys = (project as { requiredEnvKeys?: string[] }).requiredEnvKeys ?? [];
      if (requiredKeys.length && !rollbackOf && this.flags.aiEnabled('ai_env_check')) {
        const declared = await this.prisma.envVar.findMany({
          where: { projectId: project.id },
          select: { key: true },
        });
        const have = new Set(declared.map((v) => v.key));
        const missing = requiredKeys.filter((k) => !have.has(k));
        if (missing.length) {
          log(
            `⚠️ Thiếu ${missing.length} biến env app cần: ${missing.join(', ')} — app có thể lỗi lúc chạy. Thêm ở tab Env.`,
            'stderr',
          );
        }
      }

      // Server REMOTE → chạy qua SSH. Server LOCAL → build ngay trên máy chủ DeployBox
      // (LOCAL không có SSH key, host=localhost — không được SSH vào chính mình).
      if ((project as any).serverId) {
        const srv = await (this.prisma as any).server.findUnique({
          where: { id: (project as any).serverId },
          select: { type: true, name: true },
        });
        if (srv?.type === 'REMOTE') {
          await this.runRemote({ deploymentId, project: project as any, gitToken, log });
          return;
        }
        log(`=== Server "${srv?.name ?? 'local'}" (LOCAL) → build trên máy này ===`, 'stdout');
        // rơi xuống local builders bên dưới
      }

      if (rollbackOf) {
        await this.doRollback(deploymentId, rollbackOf, project, dataDir, log);
      } else if (project.type === 'MOBILE') {
        if (!project.artifactPath) {
          throw new Error(
            'Project MOBILE cần artifactPath. Ví dụ: build/app/outputs/flutter-apk/app-dev-release.apk',
          );
        }
        const buildEnv = await this.env.resolveForPhase(project.id, 'build');
        const { fileName } = await this.mobileBuilder.build(
          {
            deploymentId,
            slug: project.slug,
            repoUrl: this.cloneUrl(project.gitRepoUrl!, gitToken),
            repoUrlDisplay: project.gitRepoUrl!,
            branch: project.gitBranch,
            rootDir: project.rootDir,
            buildImage: project.buildImage ?? undefined,
            buildCommand: project.buildCommand ?? 'flutter build apk --release',
            artifactPath: project.artifactPath!,
            dataDir,
            signal: controller.signal,
          },
          buildEnv,
          log,
        );
        log(`Artifact sẵn sàng: ${fileName}`, 'stdout');
        await this.prisma.deployment.update({
          where: { id: deploymentId },
          data: {
            status: 'RUNNING',
            finishedAt: new Date(),
            staticPath: `artifacts/${deploymentId}/${fileName}`,
          },
        });
      } else if (project.type === 'STATIC') {
        const buildEnv = await this.env.resolveForPhase(project.id, 'build');
        const { releaseDir } = await this.builder.build(
          {
            deploymentId,
            slug: project.slug,
            repoUrl: this.cloneUrl(project.gitRepoUrl!, gitToken),
            repoUrlDisplay: project.gitRepoUrl!,
            branch: project.gitBranch,
            rootDir: project.rootDir,
            buildCommand: project.buildCommand,
            outputDir: project.outputDir,
            env: buildEnv,
            dataDir,
            signal: controller.signal,
          },
          log,
        );
        await this.prisma.deployment.update({
          where: { id: deploymentId },
          data: { status: 'DEPLOYING' },
        });
        await this.prisma.deployment.update({
          where: { id: deploymentId },
          data: { status: 'RUNNING', finishedAt: new Date(), staticPath: releaseDir },
        });
      } else if ((project as any).useDocker === false) {
        // BACKEND chạy thẳng trên host (không Docker)
        const runtimeEnv = await this.env.resolveForPhase(project.id, 'runtime');
        const { pid } = await this.hostBackend.run(
          {
            deploymentId,
            slug: project.slug,
            repoUrl: this.cloneUrl(project.gitRepoUrl!, gitToken),
            repoUrlDisplay: project.gitRepoUrl!,
            branch: project.gitBranch,
            rootDir: project.rootDir,
            installCommand: project.installCommand,
            buildCommand: project.buildCommand,
            startCommand: project.startCommand,
            internalPort: project.internalPort,
            env: runtimeEnv,
            dataDir,
            signal: controller.signal,
          },
          log,
        );
        await this.prisma.deployment.update({
          where: { id: deploymentId },
          data: { status: 'RUNNING', finishedAt: new Date(), containerId: `host:${pid}` },
        });
      } else {
        const runtimeEnv = await this.env.resolveForPhase(project.id, 'runtime');
        const { containerId, imageTag } = await this.dockerEngine.build(
          {
            deploymentId,
            slug: project.slug,
            repoUrl: this.cloneUrl(project.gitRepoUrl!, gitToken),
            repoUrlDisplay: project.gitRepoUrl!,
            branch: project.gitBranch,
            rootDir: project.rootDir,
            internalPort: project.internalPort,
            memoryMb: project.memoryMb,
            cpuLimit: project.cpuLimit,
            dataDir,
            signal: controller.signal,
            // 🤖 Repo không có Dockerfile → AI sinh (flag ai_dockerfile_gen)
            onMissingDockerfile: this.flags.aiEnabled('ai_dockerfile_gen')
              ? async (appDir) => {
                  log('🤖 Không thấy Dockerfile — nhờ AI sinh…', 'stdout');
                  const snap = await this.localSnapshot(appDir);
                  return this.ai.generateDockerfile({
                    projectName: project.name,
                    internalPort: project.internalPort,
                    startCommand: project.startCommand,
                    tree: snap.tree,
                    files: snap.files,
                  });
                }
              : undefined,
          },
          runtimeEnv,
          log,
        );
        await this.prisma.deployment.update({
          where: { id: deploymentId },
          data: { status: 'DEPLOYING' },
        });
        await this.prisma.deployment.update({
          where: { id: deploymentId },
          data: { status: 'RUNNING', finishedAt: new Date(), containerId, imageTag },
        });
      }

      // Bản deploy này vừa RUNNING → hạ các bản RUNNING/SLEEPING cũ của project xuống STOPPED.
      // Builder đã kill process cũ rồi, nên thực tế chỉ 1 bản chạy; cập nhật status cho khớp
      // để lịch sử chỉ hiện đúng 1 "Đang chạy" (bản mới nhất).
      await this.prisma.deployment.updateMany({
        where: {
          projectId: project.id,
          id: { not: deploymentId },
          status: { in: ['RUNNING', 'SLEEPING'] },
        },
        data: { status: 'STOPPED', finishedAt: new Date() },
      });

      // 📚 Deploy thành công ngay sau 1 bản FAILED có chẩn đoán → cách sửa đó hiệu quả → HỌC
      void this.learnFromRecovery(project.id, deploymentId, dataDir).catch(() => undefined);

      await this.prisma.domain.updateMany({
        where: { projectId: project.id, isPrimary: true },
        data: { status: 'ACTIVE' },
      });
      await this.caddy
        .sync()
        .catch((e) => log(`Cảnh báo: không cập nhật được Caddy (${e})`, 'stderr'));
      log('=== DEPLOY THÀNH CÔNG ===', 'stdout');
      await this.notify.deployResult(
        { ok: true, projectName: project.name, branch: project.gitBranch },
        await this.telegramRecipients(project.teamId),
      );
      // 🩺 Smoke test NỀN (BACKEND): gọi thử app thật — bắt ca "deploy xong nhưng app hỏng"
      if (project.type === 'BACKEND' && this.flags.aiEnabled('ai_smoke_test')) {
        void this.smokeTest(deploymentId, project, dataDir, log, !!rollbackOf).catch((e) =>
          this.logger.warn(`Smoke test lỗi: ${e instanceof Error ? e.message : e}`),
        );
      }
      await this.cleanup
        .pruneProject(project, dataDir)
        .catch((e) => this.logger.warn(`Dọn dẹp lỗi: ${e}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Deploy ${deploymentId} thất bại: ${msg}`);
      log(`=== LỖI: ${msg} ===`, 'stderr');
      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: msg },
      });
      if (project.notifyUrl) {
        fetch(project.notifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'deployment.failed',
            deploymentId,
            projectId: project.id,
            projectName: project.name,
            error: msg,
          }),
          signal: AbortSignal.timeout(10_000),
        }).catch((e) => this.logger.warn(`Gửi notify thất bại: ${e}`));
      }
      await this.notify.deployResult(
        { ok: false, projectName: project.name, branch: project.gitBranch, error: msg },
        await this.telegramRecipients(project.teamId).catch(() => []),
      );
      // AI chẩn đoán NỀN (không chặn, không ném lỗi): lưu vào DB cho web +
      // gửi tin Telegram bổ sung. Tin fail ở trên đã đi ngay, tin này theo sau ~5–15s.
      void this.diagnoseInBackground(deploymentId, project, msg, logFile).catch((e) =>
        this.logger.warn(`AI chẩn đoán nền lỗi: ${e instanceof Error ? e.message : e}`),
      );
    } finally {
      clearTimeout(tid);
      this.broadcast.end(deploymentId);
    }
  }

  /** 📚 Bản TRƯỚC fail + có chẩn đoán, bản NÀY thành công → lưu cách sửa vào trí nhớ. */
  private async learnFromRecovery(
    projectId: string,
    currentDeploymentId: string,
    dataDir: string,
  ): Promise<void> {
    const prev = await this.prisma.deployment.findFirst({
      where: { projectId, id: { not: currentDeploymentId } },
      orderBy: { queuedAt: 'desc' },
      select: { id: true, status: true, errorMessage: true, aiDiagnosis: true },
    });
    if (!prev || prev.status !== 'FAILED' || !prev.aiDiagnosis) return;
    const prevLog = await readFile(join(dataDir, 'logs', `${prev.id}.log`), 'utf8').catch(() => '');
    await this.ai.learnFix({
      projectId,
      errorMessage: prev.errorMessage,
      logTail: prevLog,
      diagnosis: prev.aiDiagnosis as unknown as import('@deploybox/shared').AiDiagnosis,
    });
  }

  /** Ảnh chụp nhẹ repo ĐÃ CLONE trên máy (cho AI sinh Dockerfile): cây 2 cấp + file chìa khóa. */
  private async localSnapshot(
    appDir: string,
  ): Promise<{ tree: string; files: Record<string, string> }> {
    const KEY = new Set([
      'package.json', 'pnpm-lock.yaml', 'requirements.txt', 'pyproject.toml',
      'go.mod', 'composer.json', 'nest-cli.json', 'next.config.js',
      'next.config.mjs', 'next.config.ts', 'tsconfig.json',
    ]);
    const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'vendor']);
    const tree: string[] = [];
    const files: Record<string, string> = {};
    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
      if (depth > 2 || tree.length >= 120) return;
      for (const name of (await readdir(dir).catch(() => [] as string[])).sort()) {
        if (SKIP.has(name) || tree.length >= 120) continue;
        const abs = join(dir, name);
        const rp = rel ? `${rel}/${name}` : name;
        const st = await stat(abs).catch(() => null);
        if (!st) continue;
        if (st.isDirectory()) {
          tree.push(rp + '/');
          await walk(abs, rp, depth + 1);
        } else {
          tree.push(rp);
          if (KEY.has(name) && st.size < 100_000) {
            const c = await readFile(abs, 'utf8').catch(() => '');
            if (c) files[rp] = c.slice(0, 4_000);
          }
        }
      }
    };
    await walk(appDir, '', 1);
    return { tree: tree.join('\n'), files };
  }

  /**
   * 🩺 Smoke test sau deploy (BACKEND): gọi thử app tối đa ~20s.
   * - App trả lời (HTTP < 500, kể cả 404) → PASS, ghi log.
   * - Trả 5xx hoặc không trả lời → lấy runtime log → AI chẩn đoán → lưu DB + Telegram.
   * Chạy nền, best-effort — không ảnh hưởng kết quả deploy.
   */
  private async smokeTest(
    deploymentId: string,
    project: Project,
    dataDir: string,
    log: BuildLogger,
    isRollback = false,
  ): Promise<void> {
    const url = `http://127.0.0.1:${project.internalPort}/`;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    let lastStatus: number | null = null;
    for (let attempt = 1; attempt <= 7; attempt++) {
      await sleep(3_000);
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(3_000),
          redirect: 'manual',
        });
        lastStatus = res.status;
        if (res.status < 500) {
          log(`🩺 Smoke test OK — app trả lời HTTP ${res.status} tại port ${project.internalPort}`, 'stdout');
          return;
        }
      } catch {
        lastStatus = null; // không kết nối được / timeout
      }
    }

    const detail =
      lastStatus !== null
        ? `app trả HTTP ${lastStatus} tại port ${project.internalPort}`
        : `app KHÔNG trả lời tại port ${project.internalPort} sau ~20 giây`;
    log(`🩺 Smoke test THẤT BẠI — ${detail}`, 'stderr');

    // Lấy runtime log theo chế độ chạy để AI chẩn đoán
    const runtimeLog =
      project.useDocker === false
        ? await readFile(this.hostBackend.runtimeLog(dataDir, project.slug), 'utf8').catch(() => '')
        : await this.docker.logsTail(`deploybox-${project.slug}`, 200).catch(() => '');

    const diagnosis = await this.ai.tryDiagnose(
      {
        projectId: project.id,
        projectName: project.name,
        projectType: project.type,
        useDocker: project.useDocker,
        installCommand: project.installCommand,
        buildCommand: project.buildCommand,
        startCommand: project.startCommand,
        outputDir: project.outputDir,
        internalPort: project.internalPort,
        rootDir: project.rootDir,
        errorMessage: `Smoke test thất bại: ${detail}`,
        log: `[RUNTIME LOG — deploy xong nhưng smoke test thất bại]\n${runtimeLog.slice(-12_000)}`,
      },
      'smoke',
    );

    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        errorMessage: `Smoke test: ${detail}`,
        ...(diagnosis
          ? { aiDiagnosis: diagnosis as unknown as Prisma.InputJsonValue }
          : {}),
      },
    }).catch(() => undefined);

    await this.notify.smokeTestFailed(
      {
        projectName: project.name,
        detail,
        diagnosis,
        tip: this.flags.aiEnabled('ai_ops_tips')
          ? opsTip(runtimeLog, project.memoryMb)
          : '',
      },
      await this.telegramRecipients(project.teamId).catch(() => []),
    );

    // ⏪ Rollback thông minh: bản Docker mới hỏng → tự quay về image ổn định gần nhất.
    // Không áp dụng cho: bản rollback (tránh lặp vô hạn), host-run (không lưu bản cũ).
    if (
      !isRollback &&
      project.useDocker !== false &&
      this.flags.aiEnabled('ai_auto_rollback')
    ) {
      const prev = await this.prisma.deployment.findFirst({
        where: {
          projectId: project.id,
          id: { not: deploymentId },
          imageTag: { not: null },
          errorMessage: null, // bản cũ sạch (không smoke fail / crash)
        },
        orderBy: { queuedAt: 'desc' },
        select: { id: true },
      });
      if (prev) {
        log(`⏪ Auto-rollback: quay về bản ${prev.id.slice(0, 8)} (image ổn định gần nhất)`, 'stderr');
        const rb = await this.prisma.deployment.create({
          data: {
            projectId: project.id,
            status: 'QUEUED',
            trigger: 'REDEPLOY',
            createdBy: 'auto-rollback',
            commitMsg: `Auto-rollback về ${prev.id.slice(0, 8)} — smoke test thất bại`,
          },
        });
        await this.notify.autoRollback(
          {
            projectName: project.name,
            targetShort: prev.id.slice(0, 8),
            reason: detail,
          },
          await this.telegramRecipients(project.teamId).catch(() => []),
        );
        setImmediate(() =>
          this.run({ deploymentId: rb.id, rollbackOf: prev.id }).catch((e) =>
            this.logger.error(e),
          ),
        );
      }
    }
  }

  /**
   * Deploy fail → AI đọc log chẩn đoán (best-effort), lưu Deployment.aiDiagnosis
   * (web mở là có sẵn, không gọi AI lại) rồi gửi tin Telegram bổ sung.
   * Tắt `ai_features` hoặc thiếu API key → tryDiagnose trả null, không làm gì.
   */
  private async diagnoseInBackground(
    deploymentId: string,
    project: Project,
    errorMessage: string,
    logFile: string,
  ): Promise<void> {
    if (!this.flags.aiEnabled('ai_auto_diagnosis')) return;
    const log = await readFile(logFile, 'utf8').catch(() => '');
    if (!log && !errorMessage) return;

    const diagnosis = await this.ai.tryDiagnose(
      {
        projectId: project.id,
        projectName: project.name,
        projectType: project.type,
        useDocker: project.useDocker,
        installCommand: project.installCommand,
        buildCommand: project.buildCommand,
        startCommand: project.startCommand,
        outputDir: project.outputDir,
        internalPort: project.internalPort,
        rootDir: project.rootDir,
        errorMessage,
        log,
      },
      'auto_diagnosis',
    );
    if (!diagnosis) return;

    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { aiDiagnosis: diagnosis as unknown as Prisma.InputJsonValue },
    });
    await this.notify.deployDiagnosis(
      { projectName: project.name, branch: project.gitBranch, diagnosis },
      await this.telegramRecipients(project.teamId).catch(() => []),
    );
  }

  // ─── REMOTE BUILD (SSH) ───────────────────────────────────────────────────

  private async runRemote(params: {
    deploymentId: string;
    project: {
      id: string; slug: string; teamId: string; type: string; name: string;
      serverId: string; gitRepoUrl: string | null; gitBranch: string; rootDir: string;
      installCommand?: string | null; buildCommand?: string | null;
      startCommand?: string | null; outputDir?: string | null;
      internalPort: number; buildImage?: string | null; artifactPath?: string | null;
      notifyUrl?: string | null;
    };
    gitToken: string | null;
    log: BuildLogger;
  }): Promise<void> {
    const { deploymentId, project, gitToken, log } = params;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const server = await (this.prisma as any).server.findUniqueOrThrow({
      where: { id: project.serverId },
    });
    const privateKey = server.sshPrivateKey
      ? this.crypto.decrypt(server.sshPrivateKey)
      : '';
    const sshOpts = {
      host: server.host,
      port: server.port,
      username: server.username,
      privateKey,
    };

    const phase = project.type === 'BACKEND' ? 'runtime' : 'build';
    const envVars = await this.env.resolveForPhase(project.id, phase as 'build' | 'runtime');

    const script = this.generateRemoteScript(project, deploymentId, gitToken, envVars);
    log(`=== DEPLOY LÊN SERVER REMOTE: ${server.name} (${server.host}) ===`, 'stdout');

    await this.ssh.exec(sshOpts, script, (line) => log(line, 'stdout'));

    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'RUNNING', finishedAt: new Date() },
    });
    log(`=== THÀNH CÔNG → http://${server.host}:${project.internalPort} ===`, 'stdout');
  }

  private generateRemoteScript(
    project: {
      slug: string; type: string; gitRepoUrl: string | null; gitBranch: string;
      rootDir: string; installCommand?: string | null; buildCommand?: string | null;
      startCommand?: string | null; outputDir?: string | null; internalPort: number;
      buildImage?: string | null; artifactPath?: string | null;
    },
    deploymentId: string,
    gitToken: string | null,
    envVars: Record<string, string>,
  ): string {
    const { slug, type, gitBranch, rootDir, internalPort } = project;
    const cloneUrl = this.cloneUrl(project.gitRepoUrl ?? '', gitToken);
    const workDir = `/opt/deploybox/projects/${slug}`;
    const cdRoot = rootDir !== '.' ? `cd "${rootDir}"` : '';
    const install = project.installCommand ?? '';
    const build = project.buildCommand ?? '';

    const gitBlock = [
      `mkdir -p "${workDir}" && cd "${workDir}"`,
      `if [ -d ".git" ]; then`,
      `  git remote set-url origin "${cloneUrl}" 2>/dev/null || true`,
      `  git fetch --all --prune && git reset --hard "origin/${gitBranch}"`,
      `else`,
      `  GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch "${gitBranch}" "${cloneUrl}" .`,
      `fi`,
    ].join('\n');

    if (type === 'STATIC') {
      const out = project.outputDir ?? 'dist';
      return `#!/bin/bash\nset -euo pipefail\n${gitBlock}\n${cdRoot}\n${install}\n${build}\n` +
        `docker stop "deploybox-${slug}" 2>/dev/null || true\n` +
        `docker rm "deploybox-${slug}" 2>/dev/null || true\n` +
        `docker run -d --name "deploybox-${slug}" --restart unless-stopped \\\n` +
        `  -p ${internalPort}:80 \\\n` +
        `  -v "$(pwd)/${out}:/usr/share/nginx/html:ro" \\\n` +
        `  nginx:alpine\n` +
        `echo "Static site chạy tại port ${internalPort}"\n`;
    }

    if (type === 'MOBILE') {
      const artifact = project.artifactPath ?? 'build/app/outputs/flutter-apk/app-release.apk';
      const image = project.buildImage ?? 'cirrusci/flutter:stable';
      const buildCmd = project.buildCommand ?? 'flutter build apk --release';
      const artifactDir = `/opt/deploybox/artifacts/${deploymentId}`;
      return `#!/bin/bash\nset -euo pipefail\n${gitBlock}\n${cdRoot}\n` +
        `docker run --rm -v "$(pwd):/app" -w /app "${image}" sh -c "${buildCmd}"\n` +
        `mkdir -p "${artifactDir}"\ncp "${artifact}" "${artifactDir}/"\n` +
        `FNAME=$(basename "${artifact}")\n` +
        `docker stop "deploybox-${slug}-art" 2>/dev/null || true\n` +
        `docker rm "deploybox-${slug}-art" 2>/dev/null || true\n` +
        `docker run -d --name "deploybox-${slug}-art" --restart unless-stopped \\\n` +
        `  -p ${internalPort}:80 \\\n` +
        `  -v "${artifactDir}:/usr/share/nginx/html:ro" nginx:alpine\n` +
        `echo "Artifact tại port ${internalPort}/$FNAME"\n`;
    }

    // BACKEND
    const envFile = `/tmp/deploybox-${slug}.env`;
    const envContent = Object.entries(envVars)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const startCmd = project.startCommand ?? 'node dist/index.js';
    return `#!/bin/bash\nset -euo pipefail\n${gitBlock}\n${cdRoot}\n${install}\n${build}\n` +
      `printf '%s' ${JSON.stringify(envContent)} > "${envFile}"\n` +
      `docker stop "deploybox-${slug}" 2>/dev/null || true\n` +
      `docker rm "deploybox-${slug}" 2>/dev/null || true\n` +
      `if [ -f "Dockerfile" ]; then\n` +
      `  docker build -t "deploybox-${slug}" .\n` +
      `  docker run -d --name "deploybox-${slug}" --restart unless-stopped \\\n` +
      `    -p ${internalPort}:${internalPort} --env-file "${envFile}" "deploybox-${slug}"\n` +
      `else\n` +
      `  docker run -d --name "deploybox-${slug}" --restart unless-stopped \\\n` +
      `    -p ${internalPort}:${internalPort} --env-file "${envFile}" \\\n` +
      `    -v "$(pwd):/app" -w /app node:lts-alpine sh -c "${startCmd}"\n` +
      `fi\n` +
      `echo "Backend chạy tại port ${internalPort}"\n`;
  }

  private async doRollback(
    deploymentId: string,
    rollbackOf: string,
    project: { id: string; type: string; slug: string; internalPort: number; memoryMb: number; cpuLimit: number },
    dataDir: string,
    log: BuildLogger,
  ): Promise<void> {
    const src = await this.prisma.deployment.findUnique({ where: { id: rollbackOf } });
    if (!src) throw new Error('Không tìm thấy bản deploy để rollback');
    log(`=== ROLLBACK về ${rollbackOf.slice(0, 8)} ===`, 'stdout');

    if (project.type === 'STATIC') {
      if (!src.staticPath) throw new Error('Bản cũ không còn artifact tĩnh để rollback');
      await this.builder.activate(dataDir, project.slug, src.staticPath);
      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: 'RUNNING', finishedAt: new Date(), staticPath: src.staticPath },
      });
    } else {
      if (!src.imageTag) throw new Error('Bản cũ không còn image để rollback');
      const runtimeEnv = await this.env.resolveForPhase(project.id, 'runtime');
      const { containerId } = await this.dockerEngine.runImage(
        { slug: project.slug, imageTag: src.imageTag, internalPort: project.internalPort, memoryMb: project.memoryMb, cpuLimit: project.cpuLimit },
        runtimeEnv,
        log,
      );
      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: 'RUNNING', finishedAt: new Date(), containerId, imageTag: src.imageTag },
      });
    }
  }
}
