import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from '../docker/docker.service';
import { CaddyService } from '../caddy/caddy.service';
import { HostBackendBuilder } from '../builder/host-backend.builder';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { EnvService } from '../../modules/env/env.service';

/**
 * Scale-to-zero cho app BACKEND: ngủ khi nhàn rỗi, đánh thức khi có request
 * (idle phát hiện qua access log của Caddy).
 * - Docker: ngủ = docker stop, thức = docker start.
 * - Host-run: ngủ = KILL process (trả RAM cho máy — bật/tắt ở Admin, flag
 *   host_scale_to_zero), thức = chạy lại từ bản build sẵn trên đĩa (~3-5s).
 */
@Injectable()
export class SleepService implements OnModuleInit {
  private readonly logger = new Logger(SleepService.name);
  /** slug → wake đang chạy dở — request dồn dập chỉ đánh thức 1 lần */
  private waking = new Map<string, Promise<boolean>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly caddy: CaddyService,
    private readonly config: ConfigService,
    private readonly hostBackend: HostBackendBuilder,
    private readonly flags: FeatureFlagsService,
    private readonly env: EnvService,
  ) {}

  onModuleInit(): void {
    const sweepMs =
      this.config.get<number>('SLEEP_SWEEP_SECONDS', 30) * 1000;
    setInterval(() => {
      this.sweepIdle().catch((e) => this.logger.warn(`sweepIdle lỗi: ${e}`));
    }, sweepMs).unref();
  }

  private dataDir(): string {
    return resolve(
      process.cwd(),
      this.config.get<string>('DATA_DIR', '.deploybox-data'),
    );
  }

  async sleep(projectId: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project || project.type !== 'BACKEND') return false;

    // Đổi trạng thái TRƯỚC khi tắt process: watchdog chỉ soi app RUNNING —
    // đánh dấu SLEEPING xong mới kill thì không bị watchdog "cứu" nhầm.
    const latest = await this.prisma.deployment.findFirst({
      where: { projectId, status: 'RUNNING' },
      orderBy: { queuedAt: 'desc' },
    });
    if (latest) {
      await this.prisma.deployment.update({
        where: { id: latest.id },
        data: { status: 'SLEEPING' },
      });
    }

    if (project.useDocker) {
      await this.docker.stop(`deploybox-${project.slug}`).catch(() => undefined);
    } else if (this.flags.isEnabled('host_scale_to_zero')) {
      // Host-run: tắt hẳn process → TRẢ RAM (trước đây chỉ đổi trạng thái, RAM giữ nguyên)
      await this.hostBackend.stop(this.dataDir(), project.slug).catch(() => undefined);
    }

    await this.caddy.sync().catch(() => undefined);
    this.logger.log(`Ngủ ${project.slug}`);
    return true;
  }

  async wake(slug: string): Promise<boolean> {
    // Nhiều request cùng đập vào app đang ngủ → chỉ 1 lần wake, còn lại chờ chung
    const inflight = this.waking.get(slug);
    if (inflight) return inflight;
    const p = this.doWake(slug).finally(() => this.waking.delete(slug));
    this.waking.set(slug, p);
    return p;
  }

  private async doWake(slug: string): Promise<boolean> {
    const project = await this.prisma.project.findFirst({ where: { slug } });
    if (!project) return false;

    if (project.useDocker) {
      await this.docker.start(`deploybox-${project.slug}`).catch(() => undefined);
    } else if (!(await this.hostBackend.isRunning(this.dataDir(), slug))) {
      // Host-run đã bị tắt lúc ngủ → chạy lại từ bản build sẵn trên đĩa
      try {
        const runtimeEnv = await this.env.resolveForPhase(project.id, 'runtime');
        await this.hostBackend.restart(
          {
            slug: project.slug,
            rootDir: project.rootDir,
            startCommand: project.startCommand,
            internalPort: project.internalPort,
            env: runtimeEnv,
            dataDir: this.dataDir(),
            memoryMb: project.memoryMb,
            cpuLimit: project.cpuLimit,
          },
          (line) => this.logger.debug(`[wake:${slug}] ${line}`),
        );
      } catch (e) {
        // Không dậy được (vd bản build đã bị dọn) → giữ SLEEPING, báo lỗi
        this.logger.warn(
          `Wake ${slug} thất bại: ${e instanceof Error ? e.message : e}`,
        );
        return false;
      }
    }

    const latest = await this.prisma.deployment.findFirst({
      where: { projectId: project.id, status: 'SLEEPING' },
      orderBy: { queuedAt: 'desc' },
    });
    if (latest) {
      await this.prisma.deployment.update({
        where: { id: latest.id },
        data: { status: 'RUNNING' },
      });
    }
    await this.caddy.sync().catch(() => undefined);
    this.logger.log(`Đánh thức ${slug}`);
    return true;
  }

  async sweepIdle(): Promise<void> {
    const idleMs = this.config.get<number>('SLEEP_IDLE_SECONDS', 120) * 1000;
    const projects = await this.prisma.project.findMany({
      where: {
        type: 'BACKEND',
        sleepEnabled: true,
        deployments: { some: { status: 'RUNNING' } },
      },
      include: {
        deployments: {
          where: { status: 'RUNNING' },
          orderBy: { queuedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!projects.length) return;

    const lastAccess = await this.readLastAccess();
    const now = Date.now();
    const appDomain = this.config.get<string>('APP_DOMAIN', 'localhost');
    const port = this.config.get<string>('PROXY_PORT', '8080');

    for (const p of projects) {
      const candidates = [
        `${p.slug}.${appDomain}:${port}`,
        `${p.slug}.${appDomain}`,
      ];
      const accessed = Math.max(
        0,
        ...candidates.map((h) => lastAccess.get(h) ?? 0),
      );
      const deployedAt = p.deployments[0]?.finishedAt?.getTime() ?? 0;
      const last = Math.max(accessed, deployedAt);
      if (last > 0 && now - last > idleMs) {
        await this.sleep(p.id).catch(() => undefined);
      }
    }
  }

  private async readLastAccess(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const content = await readFile(
      join(this.dataDir(), 'caddy', 'access.log'),
      'utf8',
    ).catch(() => '');
    if (!content) return map;
    for (const line of content.split('\n').slice(-5000)) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as {
          ts?: number;
          request?: { host?: string };
        };
        const host = e.request?.host;
        const ts = e.ts ? e.ts * 1000 : 0;
        if (host && ts && ts > (map.get(host) ?? 0)) map.set(host, ts);
      } catch {
        // bỏ qua dòng log hỏng
      }
    }
    return map;
  }
}
