import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';

const TG = 'https://api.telegram.org';

/**
 * Kết nối Telegram per-user bằng deep-link (1 bot chung của instance):
 *  - Sinh mã link → user bấm link `t.me/<bot>?start=<mã>` → Telegram gửi `/start <mã>` cho bot.
 *  - Service POLL getUpdates, bắt `/start <mã>`, khớp mã → lưu chat_id vào user đó.
 * Poller là consumer DUY NHẤT của getUpdates (đừng gọi getUpdates thủ công nơi khác).
 */
@Injectable()
export class TelegramLinkService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramLinkService.name);
  private token = '';
  private botUsername: string | null = null;
  private offset = 0;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.token = this.config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
    if (!this.token) {
      this.logger.log('TELEGRAM_BOT_TOKEN chưa đặt → bỏ qua kết nối Telegram.');
      return;
    }
    this.botUsername = await this.fetchBotUsername();
    if (this.botUsername) this.logger.log(`Bot Telegram: @${this.botUsername} — bắt đầu lắng nghe /start.`);
    this.running = true;
    void this.pollLoop();
  }

  onModuleDestroy(): void {
    this.running = false;
  }

  /** Username của bot (cho deep-link). Null nếu chưa cấu hình. */
  getBotUsername(): string | null {
    return this.botUsername;
  }

  isEnabled(): boolean {
    return !!this.token;
  }

  /** Sinh mã link mới cho user + trả về deep-link. */
  async createLink(userId: string): Promise<{ url: string; botUsername: string } | null> {
    if (!this.token || !this.botUsername) return null;
    const code = randomBytes(12).toString('hex');
    await this.prisma.user.update({ where: { id: userId }, data: { telegramLinkCode: code } });
    return { url: `https://t.me/${this.botUsername}?start=${code}`, botUsername: this.botUsername };
  }

  private async fetchBotUsername(): Promise<string | null> {
    try {
      const r = await fetch(`${TG}/bot${this.token}/getMe`, { signal: AbortSignal.timeout(10_000) });
      const j = (await r.json()) as any;
      return j.ok ? j.result.username : null;
    } catch (e) {
      this.logger.warn(`getMe lỗi: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  /** Vòng lặp long-poll getUpdates. */
  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const r = await fetch(`${TG}/bot${this.token}/getUpdates?timeout=25&offset=${this.offset}`, {
          signal: AbortSignal.timeout(35_000),
        });
        const j = (await r.json()) as any;
        if (j.ok && Array.isArray(j.result)) {
          for (const u of j.result) {
            this.offset = u.update_id + 1;
            await this.handleUpdate(u).catch((e) =>
              this.logger.warn(`Xử lý update lỗi: ${e instanceof Error ? e.message : e}`),
            );
          }
        }
      } catch {
        // mạng lỗi / timeout → nghỉ chút rồi thử lại
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
  }

  private async handleUpdate(u: any): Promise<void> {
    const m = u.message;
    if (!m || typeof m.text !== 'string' || !m.chat) return;
    // Bắt "/start <code>" (có thể kèm @botname)
    const match = m.text.match(/^\/start(?:@\w+)?\s+(\S+)/);
    if (!match) return;
    const code = match[1];

    const user = await this.prisma.user.findUnique({ where: { telegramLinkCode: code } });
    if (!user) return; // mã sai/hết hạn

    const chatId = String(m.chat.id);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { telegramChatId: chatId, telegramLinkCode: null },
    });
    this.logger.log(`User ${user.email} đã nối Telegram (chat ${chatId}).`);
    await this.send(chatId, `✅ Đã kết nối DeployBox!\nTừ giờ bạn sẽ nhận thông báo deploy ở đây.`);
  }

  private async send(chatId: string, text: string): Promise<void> {
    try {
      await fetch(`${TG}/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      /* im lặng */
    }
  }
}
