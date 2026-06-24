import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from '../docker/docker.service';
import { CaddyService } from '../caddy/caddy.service';

/**
 * Scale-to-zero cho app BACKEND: ngủ (docker stop) khi nhàn rỗi, đánh thức
 * (docker start) khi có request. Idle phát hiện qua access log của Caddy.
 */
@Injectable()
export class SleepService implements OnModuleInit {
  private readonly logger = new Logger(SleepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly caddy: CaddyService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const sweepMs =
      this.config.get<number>('SLEEP_SWEEP_SECONDS', 30) * 1000;
    setInterval(() => {
      this.sweepIdle().catch((e) => this.logger.warn(`sweepIdle lỗi: ${e}`));
    }, sweepMs).unref();
  }

  async sleep(projectId: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project || project.type !== 'BACKEND') return false;
    await this.docker.stop(`deploybox-${project.slug}`).catch(() => undefined);
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
    await this.caddy.sync().catch(() => undefined);
    this.logger.log(`Ngủ ${project.slug}`);
    return true;
  }

  async wake(slug: string): Promise<boolean> {
    const project = await this.prisma.project.findFirst({ where: { slug } });
    if (!project) return false;
    await this.docker.start(`deploybox-${project.slug}`).catch(() => undefined);
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
    this.logger.log(`Đánh thức ${project.slug}`);
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
    const dataDir = resolve(
      process.cwd(),
      this.config.get<string>('DATA_DIR', '.deploybox-data'),
    );
    const content = await readFile(
      join(dataDir, 'caddy', 'access.log'),
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
