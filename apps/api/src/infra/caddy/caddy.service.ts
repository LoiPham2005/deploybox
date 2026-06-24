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

  /** URL công khai của project. */
  publicUrl(slug: string): string {
    const domain = this.appDomain();
    // localhost (dev) → http:port. Domain thật (VPS hoặc Cloudflare Tunnel) → https.
    return domain === 'localhost'
      ? `http://${slug}.${domain}:${this.proxyPort()}/`
      : `https://${slug}.${domain}/`;
  }

  /** Dựng lại toàn bộ Caddyfile từ các project RUNNING rồi reload Caddy. */
  async sync(): Promise<void> {
    const port = this.proxyPort();
    const appDomain = this.appDomain();
    const tls = this.config.get<string>('PUBLIC_TLS', 'false') === 'true';
    const apiUp = this.config.get<string>('API_UPSTREAM', 'localhost:4000');
    const webUp = this.config.get<string>('WEB_UPSTREAM', 'localhost:3000');
    const email = this.config.get<string>('ACME_EMAIL', '');
    // Local: http://host:8080. Production: bare host -> Caddy tự lo HTTPS (443).
    const fmtHost = (h: string) => (tls ? h : `http://${h}:${port}`);
    const projects = await this.prisma.project.findMany({
      where: {
        deployments: { some: { status: { in: ['RUNNING', 'SLEEPING'] } } },
      },
      include: {
        domains: true,
        deployments: {
          where: { status: { in: ['RUNNING', 'SLEEPING'] } },
          orderBy: { queuedAt: 'desc' },
          take: 1,
        },
      },
    });

    const dataDir = resolve(
      process.cwd(),
      this.config.get<string>('DATA_DIR', '.deploybox-data'),
    );
    const accessLog = join(dataDir, 'caddy', 'access.log');
    const logBlock = `\tlog {\n\t\toutput file ${accessLog}\n\t\tformat json\n\t}`;

    const blocks: string[] = [];
    for (const p of projects) {
      const hosts = [
        fmtHost(`${p.slug}.${appDomain}`),
        ...p.domains.filter((d) => !d.isManaged).map((d) => fmtHost(d.hostname)),
      ];
      const addr = hosts.join(', ');
      const sleeping = p.deployments[0]?.status === 'SLEEPING';

      if (p.type === 'STATIC') {
        blocks.push(
          `${addr} {\n${logBlock}\n\trewrite * /sites/${p.slug}{uri}\n\treverse_proxy ${apiUp}\n}`,
        );
      } else if (sleeping) {
        // Đang ngủ: mọi request đi qua API waker để đánh thức container.
        blocks.push(
          `${addr} {\n${logBlock}\n\trewrite * /api/v1/internal/wake/${p.slug}\n\treverse_proxy ${apiUp}\n}`,
        );
      } else {
        const hostPort = await this.docker.getHostPort(
          `deploybox-${p.slug}`,
          p.internalPort,
        );
        if (!hostPort) continue;
        blocks.push(
          `${addr} {\n${logBlock}\n\treverse_proxy localhost:${hostPort}\n}`,
        );
      }
    }

    // Production: thêm route cho chính dashboard + API (cùng được cấp HTTPS).
    if (tls) {
      blocks.unshift(
        `api.${appDomain} {\n${logBlock}\n\treverse_proxy ${apiUp}\n}`,
        `${appDomain} {\n${logBlock}\n\treverse_proxy ${webUp}\n}`,
      );
    }
    const globalBlock = tls
      ? `{\n\tadmin localhost:2019${email ? `\n\temail ${email}` : ''}\n}`
      : `{\n\tadmin localhost:2019\n\tauto_https off\n}`;
    const caddyfile = `${globalBlock}\n\n${blocks.join('\n\n')}\n`;

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
