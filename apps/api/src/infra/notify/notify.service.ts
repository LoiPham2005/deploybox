import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Escape ký tự HTML để không vỡ message Telegram (parse_mode HTML). */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Gửi thông báo deploy. Hiện hỗ trợ Telegram (bật khi có
 * TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID trong .env). Không cấu hình → tự bỏ qua.
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(private readonly config: ConfigService) {}

  /** Gửi 1 message tới Telegram (im lặng nếu chưa cấu hình / lỗi mạng). */
  async telegram(text: string): Promise<void> {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    const chatId = this.config.get<string>('TELEGRAM_CHAT_ID');
    if (!token || !chatId) return; // chưa bật → bỏ qua

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn(`Telegram trả lỗi ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    } catch (e) {
      this.logger.warn(`Gửi Telegram thất bại: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Thông báo kết quả deploy (thành công / thất bại) — format sẵn cho Telegram. */
  async deployResult(opts: {
    ok: boolean;
    projectName: string;
    branch?: string | null;
    url?: string | null;
    error?: string | null;
  }): Promise<void> {
    const icon = opts.ok ? '✅' : '❌';
    const status = opts.ok ? 'THÀNH CÔNG' : 'THẤT BẠI';
    const lines = [
      `${icon} <b>Deploy ${status}</b>`,
      `📦 <b>${esc(opts.projectName)}</b>${opts.branch ? ` · <i>${esc(opts.branch)}</i>` : ''}`,
    ];
    if (opts.ok && opts.url) lines.push(`🔗 ${esc(opts.url)}`);
    if (!opts.ok && opts.error) lines.push(`⚠️ <code>${esc(opts.error.slice(0, 350))}</code>`);
    await this.telegram(lines.join('\n'));
  }
}
