import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SshService } from '../../infra/ssh/ssh.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { NotifyService } from '../../infra/notify/notify.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';

// Quét mỗi 2 phút (SSH nhẹ: 1 lệnh/server/lần, gộp mọi project trên server đó)
const SWEEP_MS = 2 * 60_000;

/**
 * 🛰️ Watchdog cho app deploy lên server REMOTE (máy của khách):
 * - Mỗi 2 phút, SSH 1 lệnh `docker ps` sang từng server → so container
 *   deploybox-<slug> với project đang RUNNING.
 * - Container chết → `docker start` tự cứu; không cứu được → đánh dấu STOPPED
 *   + báo Telegram. Trước đây app remote chết mà web vẫn hiện "Đang chạy".
 * - Server không SSH được → bỏ qua lần đó (không kết luận bừa app chết).
 * Bật/tắt ở Admin: flag remote_watchdog.
 */
@Injectable()
export class RemoteReconcilerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RemoteReconcilerService.name);
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ssh: SshService,
    private readonly crypto: CryptoService,
    private readonly notify: NotifyService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => void this.sweep().catch((e) => this.warn(e)),
      SWEEP_MS,
    );
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private warn(e: unknown): void {
    this.logger.warn(`Remote watchdog lỗi: ${e instanceof Error ? e.message : e}`);
  }

  /** Chạy lệnh trên server remote, gom stdout thành chuỗi. */
  private async capture(
    server: { host: string; port: number; username: string; sshPrivateKey: string | null },
    command: string,
  ): Promise<string> {
    const lines: string[] = [];
    await this.ssh.exec(
      {
        host: server.host,
        port: server.port,
        username: server.username,
        privateKey: server.sshPrivateKey ? this.crypto.decrypt(server.sshPrivateKey) : '',
      },
      command,
      (l) => lines.push(l),
    );
    return lines.join('\n');
  }

  async sweep(): Promise<void> {
    if (this.sweeping) return;
    if (!this.flags.isEnabled('remote_watchdog')) return;
    this.sweeping = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const servers: any[] = await (this.prisma as any).server.findMany({
        where: { type: 'REMOTE' },
      });
      for (const server of servers) {
        await this.sweepServer(server).catch((e) =>
          // Server không SSH được → chỉ log, KHÔNG đánh dấu app chết (mất mạng ≠ app chết)
          this.logger.warn(`Không kiểm tra được server "${server.name}": ${e instanceof Error ? e.message : e}`),
        );
      }
    } finally {
      this.sweeping = false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async sweepServer(server: any): Promise<void> {
    const projects = await this.prisma.project.findMany({
      where: {
        serverId: server.id,
        deployments: { some: { status: 'RUNNING' } },
      },
      select: { id: true, slug: true, name: true, teamId: true },
    });
    if (!projects.length) return;

    // 1 lệnh duy nhất: tên các container đang chạy
    const out = await this.capture(server, `docker ps --format '{{.Names}}'`);
    const running = new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));

    for (const p of projects) {
      const cn = `deploybox-${p.slug}`;
      if (running.has(cn) || running.has(`${cn}-art`)) continue; // -art: project MOBILE

      // Container chết → thử tự cứu
      let action: 'restarted' | 'stopped' = 'stopped';
      try {
        await this.capture(server, `docker start "${cn}" && sleep 2 && [ "$(docker inspect -f '{{.State.Running}}' "${cn}")" = "true" ]`);
        action = 'restarted';
        this.logger.log(`Remote watchdog: ${p.slug}@${server.name} đã chạy lại ✓`);
      } catch {
        this.logger.warn(`Remote watchdog: ${p.slug}@${server.name} KHÔNG cứu được → STOPPED`);
        await this.prisma.deployment.updateMany({
          where: { projectId: p.id, status: 'RUNNING' },
          data: {
            status: 'STOPPED',
            errorMessage: `Container trên server remote "${server.name}" đã dừng và không khởi động lại được — kiểm tra server hoặc Deploy lại.`,
          },
        });
      }

      // Báo Telegram cho team (best-effort)
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: p.teamId },
        select: { user: { select: { telegramChatId: true } } },
      });
      await this.notify
        .runtimeCrash(
          {
            projectName: `${p.name} (server: ${server.name})`,
            action,
            crashCount: 1,
            diagnosis: null,
            tip: '',
          },
          members.map((m) => m.user.telegramChatId).filter((x): x is string => !!x),
        )
        .catch(() => undefined);
    }
  }
}
