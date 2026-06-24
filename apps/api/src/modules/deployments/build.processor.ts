import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { appendFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import {
  HostStaticBuilder,
  type BuildLogger,
} from '../../infra/builder/host-static.builder';
import { DockerBackendEngine } from '../../infra/builder/docker-backend.engine';
import { CaddyService } from '../../infra/caddy/caddy.service';
import { CleanupService } from '../../infra/cleanup/cleanup.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EnvService } from '../env/env.service';
import { BUILD_QUEUE, type BuildJobData } from './queue.constants';

@Processor(BUILD_QUEUE)
export class BuildProcessor extends WorkerHost {
  private readonly logger = new Logger(BuildProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly builder: HostStaticBuilder,
    private readonly dockerEngine: DockerBackendEngine,
    private readonly caddy: CaddyService,
    private readonly cleanup: CleanupService,
    private readonly env: EnvService,
  ) {
    super();
  }

  async process(job: Job<BuildJobData>): Promise<void> {
    const { deploymentId, rollbackOf } = job.data;
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
    };

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
      } else if (project.type === 'STATIC') {
        const buildEnv = await this.env.resolveForPhase(project.id, 'build');
        const { releaseDir } = await this.builder.build(
          {
            deploymentId,
            slug: project.slug,
            repoUrl: project.gitRepoUrl!,
            branch: project.gitBranch,
            rootDir: project.rootDir,
            buildCommand: project.buildCommand,
            outputDir: project.outputDir,
            env: buildEnv,
            dataDir,
          },
          log,
        );
        await this.prisma.deployment.update({
          where: { id: deploymentId },
          data: { status: 'DEPLOYING' },
        });
        log('Đăng ký phục vụ tĩnh…', 'stdout');
        await this.prisma.deployment.update({
          where: { id: deploymentId },
          data: {
            status: 'RUNNING',
            finishedAt: new Date(),
            staticPath: releaseDir,
          },
        });
      } else {
        const runtimeEnv = await this.env.resolveForPhase(
          project.id,
          'runtime',
        );
        const { containerId, imageTag } = await this.dockerEngine.build(
          {
            deploymentId,
            slug: project.slug,
            repoUrl: project.gitRepoUrl!,
            branch: project.gitBranch,
            rootDir: project.rootDir,
            internalPort: project.internalPort,
            memoryMb: project.memoryMb,
            cpuLimit: project.cpuLimit,
            dataDir,
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
          data: {
            status: 'RUNNING',
            finishedAt: new Date(),
            containerId,
            imageTag,
          },
        });
      }

      await this.prisma.domain.updateMany({
        where: { projectId: project.id, isPrimary: true },
        data: { status: 'ACTIVE' },
      });
      await this.caddy
        .sync()
        .catch((e) =>
          log(`Cảnh báo: không cập nhật được Caddy (${e})`, 'stderr'),
        );
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
    }
  }

  private async doRollback(
    deploymentId: string,
    rollbackOf: string,
    project: {
      id: string;
      type: string;
      slug: string;
      internalPort: number;
      memoryMb: number;
      cpuLimit: number;
    },
    dataDir: string,
    log: BuildLogger,
  ): Promise<void> {
    const src = await this.prisma.deployment.findUnique({
      where: { id: rollbackOf },
    });
    if (!src) throw new Error('Không tìm thấy bản deploy để rollback');
    log(`=== ROLLBACK về ${rollbackOf.slice(0, 8)} ===`, 'stdout');

    if (project.type === 'STATIC') {
      if (!src.staticPath) {
        throw new Error('Bản cũ không còn artifact tĩnh để rollback');
      }
      await this.builder.activate(dataDir, project.slug, src.staticPath);
      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: {
          status: 'RUNNING',
          finishedAt: new Date(),
          staticPath: src.staticPath,
        },
      });
    } else {
      if (!src.imageTag) {
        throw new Error('Bản cũ không còn image để rollback');
      }
      const runtimeEnv = await this.env.resolveForPhase(project.id, 'runtime');
      const { containerId } = await this.dockerEngine.runImage(
        {
          slug: project.slug,
          imageTag: src.imageTag,
          internalPort: project.internalPort,
          memoryMb: project.memoryMb,
          cpuLimit: project.cpuLimit,
        },
        runtimeEnv,
        log,
      );
      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: {
          status: 'RUNNING',
          finishedAt: new Date(),
          containerId,
          imageTag: src.imageTag,
        },
      });
    }
  }
}
