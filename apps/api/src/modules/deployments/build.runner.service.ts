import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { type BuildLogger, HostStaticBuilder } from '../../infra/builder/host-static.builder';
import { DockerBackendEngine } from '../../infra/builder/docker-backend.engine';
import { HostBackendBuilder } from '../../infra/builder/host-backend.builder';
import { MobileBuilder } from '../../infra/builder/mobile.builder';
import { CaddyService } from '../../infra/caddy/caddy.service';
import { CleanupService } from '../../infra/cleanup/cleanup.service';
import { NotifyService } from '../../infra/notify/notify.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LogBroadcastService } from '../../infra/log-broadcast/log-broadcast.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SshService } from '../../infra/ssh/ssh.service';
import { EnvService } from '../env/env.service';
import { buildGitAuthUrl } from '../../common/git-auth.util';
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
  ) {}

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
    const log: BuildLogger = (line) => {
      appendFileSync(logFile, line + '\n');
      this.broadcast.emit(deploymentId, line);
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

      await this.prisma.domain.updateMany({
        where: { projectId: project.id, isPrimary: true },
        data: { status: 'ACTIVE' },
      });
      await this.caddy
        .sync()
        .catch((e) => log(`Cảnh báo: không cập nhật được Caddy (${e})`, 'stderr'));
      log('=== DEPLOY THÀNH CÔNG ===', 'stdout');
      await this.notify.deployResult({
        ok: true,
        projectName: project.name,
        branch: project.gitBranch,
      });
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
      await this.notify.deployResult({
        ok: false,
        projectName: project.name,
        branch: project.gitBranch,
        error: msg,
      });
    } finally {
      clearTimeout(tid);
      this.broadcast.end(deploymentId);
    }
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
