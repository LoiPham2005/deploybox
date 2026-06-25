import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { type BuildLogger, HostStaticBuilder } from '../../infra/builder/host-static.builder';
import { DockerBackendEngine } from '../../infra/builder/docker-backend.engine';
import { MobileBuilder } from '../../infra/builder/mobile.builder';
import { CaddyService } from '../../infra/caddy/caddy.service';
import { CleanupService } from '../../infra/cleanup/cleanup.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LogBroadcastService } from '../../infra/log-broadcast/log-broadcast.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { EnvService } from '../env/env.service';
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
    private readonly mobileBuilder: MobileBuilder,
    private readonly caddy: CaddyService,
    private readonly cleanup: CleanupService,
    private readonly env: EnvService,
    private readonly broadcast: LogBroadcastService,
    private readonly crypto: CryptoService,
  ) {}

  /** Inject PAT vào HTTPS clone URL: https://host/... → https://oauth2:{token}@host/... */
  private cloneUrl(repoUrl: string, token?: string | null): string {
    if (!token) return repoUrl;
    try {
      const u = new URL(repoUrl);
      u.username = 'oauth2';
      u.password = token;
      return u.toString();
    } catch {
      return repoUrl;
    }
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

      await this.prisma.domain.updateMany({
        where: { projectId: project.id, isPrimary: true },
        data: { status: 'ACTIVE' },
      });
      await this.caddy
        .sync()
        .catch((e) => log(`Cảnh báo: không cập nhật được Caddy (${e})`, 'stderr'));
      log('=== DEPLOY THÀNH CÔNG ===', 'stdout');
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
    } finally {
      clearTimeout(tid);
      this.broadcast.end(deploymentId);
    }
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
