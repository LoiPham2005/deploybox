import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from '../docker/docker.service';
import { capture } from '../process.util';

/**
 * Điều khiển Caddy: mỗi project RUNNING được một subdomain
 * `<slug>.<APP_DOMAIN>:<PROXY_PORT>` phục vụ ở GỐC (sửa luôn vụ đường dẫn `../`).
 * - STATIC: rewrite về /sites/<slug> rồi proxy vào API.
 * - BACKEND: proxy thẳng vào host port của container.
 * Cập nhật bằng `caddy reload` (CLI) — chuẩn hơn gọi Admin API qua HTTP.
 */
@Injectable()
export class CaddyService implements OnModuleInit {
  private readonly logger = new Logger(CaddyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.sync().catch((e) =>
      this.logger.warn(`Không sync được Caddy lúc khởi động: ${e}`),
    );
  }

  private proxyPort(): string {
    return this.config.get<string>('PROXY_PORT', '8080');
  }
  private appDomain(): string {
    return this.config.get<string>('APP_DOMAIN', 'localhost');
  }

  /** URL công khai của project (qua Caddy). */
  publicUrl(slug: string): string {
    return `http://${slug}.${this.appDomain()}:${this.proxyPort()}/`;
  }

  /** Dựng lại toàn bộ Caddyfile từ các project RUNNING rồi reload Caddy. */
  async sync(): Promise<void> {
    const port = this.proxyPort();
    const appDomain = this.appDomain();
    const projects = await this.prisma.project.findMany({
      where: { deployments: { some: { status: 'RUNNING' } } },
      include: { domains: true },
    });

    const blocks: string[] = [];
    for (const p of projects) {
      const hosts = [
        `http://${p.slug}.${appDomain}:${port}`,
        ...p.domains
          .filter((d) => !d.isManaged)
          .map((d) => `http://${d.hostname}:${port}`),
      ];
      const addr = hosts.join(', ');
      if (p.type === 'STATIC') {
        blocks.push(
          `${addr} {\n\trewrite * /sites/${p.slug}{uri}\n\treverse_proxy localhost:4000\n}`,
        );
      } else {
        const hostPort = await this.docker.getHostPort(
          `deploybox-${p.slug}`,
          p.internalPort,
        );
        if (!hostPort) continue;
        blocks.push(`${addr} {\n\treverse_proxy localhost:${hostPort}\n}`);
      }
    }

    const caddyfile = `{\n\tadmin localhost:2019\n\tauto_https off\n}\n\n${blocks.join('\n\n')}\n`;

    const dataDir = resolve(
      process.cwd(),
      this.config.get<string>('DATA_DIR', '.deploybox-data'),
    );
    const caddyDir = join(dataDir, 'caddy');
    await mkdir(caddyDir, { recursive: true });
    const file = join(caddyDir, 'Caddyfile');
    await writeFile(file, caddyfile);

    const { code, stderr } = await capture('caddy', [
      'reload',
      '--config',
      file,
      '--adapter',
      'caddyfile',
    ]);
    if (code !== 0) {
      throw new Error(`caddy reload lỗi: ${stderr.trim() || 'không rõ'}`);
    }
  }
}
