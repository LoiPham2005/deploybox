import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Escape ký tự HTML để không vỡ message Telegram (parse_mode HTML). */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Gửi thông báo deploy qua Telegram (1 bot chung của instance).
 * Người nhận = chat global (TELEGRAM_CHAT_ID, nếu đặt) + danh sách chat_id truyền vào
 * (thường là các thành viên team đã nối Telegram). Tự dedupe. Không có ai → bỏ qua.
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(private readonly config: ConfigService) {}

  private token(): string {
    return this.config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
  }

  /** Gửi 1 message tới 1 chat_id cụ thể (im lặng nếu chưa cấu hình / lỗi). */
  async telegram(chatId: string, text: string): Promise<void> {
    const token = this.token();
    if (!token || !chatId) return;
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
        this.logger.warn(`Telegram trả lỗi ${res.status} (chat ${chatId}): ${(await res.text()).slice(0, 200)}`);
      }
    } catch (e) {
      this.logger.warn(`Gửi Telegram thất bại: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Thông báo kết quả deploy tới global + `extraRecipients` (dedupe).
   * @param extraRecipients chat_id thêm (vd thành viên team đã nối Telegram)
   */
  async deployResult(
    opts: { ok: boolean; projectName: string; branch?: string | null; url?: string | null; error?: string | null },
    extraRecipients: string[] = [],
  ): Promise<void> {
    const global = this.config.get<string>('TELEGRAM_CHAT_ID') ?? '';
    const recipients = [...new Set([global, ...extraRecipients].filter(Boolean))];
    if (!recipients.length) return;

    const icon = opts.ok ? '✅' : '❌';
    const status = opts.ok ? 'THÀNH CÔNG' : 'THẤT BẠI';
    const lines = [
      `${icon} <b>Deploy ${status}</b>`,
      `📦 <b>${esc(opts.projectName)}</b>${opts.branch ? ` · <i>${esc(opts.branch)}</i>` : ''}`,
    ];
    if (opts.ok && opts.url) lines.push(`🔗 ${esc(opts.url)}`);
    if (!opts.ok && opts.error) lines.push(`⚠️ <code>${esc(opts.error.slice(0, 350))}</code>`);
    const text = lines.join('\n');

    for (const chatId of recipients) await this.telegram(chatId, text);
  }
}
