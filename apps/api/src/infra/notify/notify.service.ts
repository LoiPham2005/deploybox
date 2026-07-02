import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiDiagnosis } from '@deploybox/shared';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

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

  constructor(
    private readonly config: ConfigService,
    private readonly flags: FeatureFlagsService,
  ) {}

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
    // Admin tắt tính năng này thì không gửi gì (vd lúc bảo trì).
    if (!this.flags.isEnabled('telegram_notifications')) return;

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

  /** Gửi 1 tin HTML tới global chat + danh sách chat_id (dedupe, tôn trọng flag). */
  async broadcast(textHtml: string, extraRecipients: string[] = []): Promise<void> {
    if (!this.flags.isEnabled('telegram_notifications')) return;
    const global = this.config.get<string>('TELEGRAM_CHAT_ID') ?? '';
    const recipients = [...new Set([global, ...extraRecipients].filter(Boolean))];
    for (const chatId of recipients) await this.telegram(chatId, textHtml.slice(0, 4000));
  }

  /** ⚡ Cảnh báo SỚM: app còn sống nhưng log lỗi tăng vọt — báo trước khi chết hẳn. */
  async earlyWarning(
    opts: {
      projectName: string;
      errorCount: number;
      windowSec: number;
      sample: string[]; // vài dòng lỗi mẫu
      tip?: string;
    },
    extraRecipients: string[] = [],
  ): Promise<void> {
    if (!this.flags.isEnabled('telegram_notifications')) return;
    const global = this.config.get<string>('TELEGRAM_CHAT_ID') ?? '';
    const recipients = [...new Set([global, ...extraRecipients].filter(Boolean))];
    if (!recipients.length) return;

    const lines = [
      `⚡ <b>CẢNH BÁO SỚM</b> · 📦 <b>${esc(opts.projectName)}</b>`,
      `App vẫn đang chạy nhưng log lỗi tăng vọt: ${opts.errorCount} dòng lỗi trong ~${opts.windowSec}s.`,
    ];
    if (opts.sample.length) {
      lines.push(`<pre>${esc(opts.sample.join('\n').slice(0, 500))}</pre>`);
    }
    if (opts.tip) lines.push(`💡 ${esc(opts.tip)}`);
    lines.push('Xem runtime log ở trang deployment để xử lý trước khi app chết.');
    const text = lines.join('\n');
    for (const chatId of recipients) await this.telegram(chatId, text);
  }

  /** ⏪ Đã tự động rollback (smoke test fail trên bản Docker mới). */
  async autoRollback(
    opts: { projectName: string; targetShort: string; reason: string },
    extraRecipients: string[] = [],
  ): Promise<void> {
    if (!this.flags.isEnabled('telegram_notifications')) return;
    const global = this.config.get<string>('TELEGRAM_CHAT_ID') ?? '';
    const recipients = [...new Set([global, ...extraRecipients].filter(Boolean))];
    if (!recipients.length) return;
    const text = [
      `⏪ <b>TỰ ĐỘNG ROLLBACK</b> · 📦 <b>${esc(opts.projectName)}</b>`,
      `Lý do: ${esc(opts.reason)}`,
      `Đang quay về bản ổn định <code>${esc(opts.targetShort)}</code>…`,
    ].join('\n');
    for (const chatId of recipients) await this.telegram(chatId, text);
  }

  /**
   * Smoke test sau deploy THẤT BẠI: deploy báo thành công nhưng app không
   * trả lời / trả 5xx. Gửi cảnh báo + chẩn đoán AI nếu có.
   */
  async smokeTestFailed(
    opts: {
      projectName: string;
      detail: string; // vd "không trả lời sau 20s" / "trả HTTP 500"
      diagnosis?: AiDiagnosis | null;
      tip?: string; // gợi ý vận hành theo loại lỗi (OOM, cổng bận…)
    },
    extraRecipients: string[] = [],
  ): Promise<void> {
    if (!this.flags.isEnabled('telegram_notifications')) return;

    const global = this.config.get<string>('TELEGRAM_CHAT_ID') ?? '';
    const recipients = [...new Set([global, ...extraRecipients].filter(Boolean))];
    if (!recipients.length) return;

    const lines = [
      `🩺 <b>Smoke test THẤT BẠI</b> · 📦 <b>${esc(opts.projectName)}</b>`,
      `Deploy báo thành công nhưng ${esc(opts.detail)} — app có thể đang hỏng.`,
    ];
    const d = opts.diagnosis;
    if (d) {
      lines.push(`🔍 <b>Nguyên nhân:</b> ${esc(d.cause.slice(0, 500))}`);
      lines.push(`🛠 <b>Cách sửa:</b> ${esc(d.fix.slice(0, 700))}`);
    }
    if (opts.tip) lines.push(`💡 ${esc(opts.tip)}`);
    const text = lines.join('\n');
    for (const chatId of recipients) await this.telegram(chatId, text);
  }

  /**
   * App đang chạy bị CRASH (watchdog phát hiện): báo trạng thái xử lý
   * (đã tự khởi động lại / đã dừng vì crash liên tục) + chẩn đoán AI nếu có.
   */
  async runtimeCrash(
    opts: {
      projectName: string;
      action: 'restarted' | 'stopped'; // restarted = self-heal OK; stopped = crash loop, đã dừng
      crashCount: number;
      diagnosis?: AiDiagnosis | null;
      tip?: string; // gợi ý vận hành theo loại lỗi (OOM, cổng bận…)
    },
    extraRecipients: string[] = [],
  ): Promise<void> {
    if (!this.flags.isEnabled('telegram_notifications')) return;

    const global = this.config.get<string>('TELEGRAM_CHAT_ID') ?? '';
    const recipients = [...new Set([global, ...extraRecipients].filter(Boolean))];
    if (!recipients.length) return;

    const lines = [
      `🔥 <b>App CRASH</b> · 📦 <b>${esc(opts.projectName)}</b>`,
      opts.action === 'restarted'
        ? `🔁 Đã tự khởi động lại (lần crash thứ ${opts.crashCount})`
        : `⛔ Crash liên tục ${opts.crashCount} lần → ĐÃ DỪNG app. Sửa lỗi rồi deploy lại.`,
    ];
    const d = opts.diagnosis;
    if (d) {
      lines.push(`🔍 <b>Nguyên nhân:</b> ${esc(d.cause.slice(0, 500))}`);
      lines.push(`🛠 <b>Cách sửa:</b> ${esc(d.fix.slice(0, 700))}`);
      if (d.configField !== 'none' && d.configValue) {
        lines.push(`💡 <code>${esc(d.configField)} = ${esc(d.configValue.slice(0, 200))}</code>`);
      }
    }
    if (opts.tip) lines.push(`💡 ${esc(opts.tip)}`);
    const text = lines.join('\n');
    for (const chatId of recipients) await this.telegram(chatId, text);
  }

  /**
   * Tin BỔ SUNG sau tin fail: kết quả AI chẩn đoán (nguyên nhân + cách sửa).
   * Gửi riêng để tin fail đến ngay lập tức, không phải chờ AI (~5–15s).
   */
  async deployDiagnosis(
    opts: { projectName: string; branch?: string | null; diagnosis: AiDiagnosis },
    extraRecipients: string[] = [],
  ): Promise<void> {
    if (!this.flags.isEnabled('telegram_notifications')) return;

    const global = this.config.get<string>('TELEGRAM_CHAT_ID') ?? '';
    const recipients = [...new Set([global, ...extraRecipients].filter(Boolean))];
    if (!recipients.length) return;

    const d = opts.diagnosis;
    const lines = [
      `🤖 <b>AI chẩn đoán</b> · 📦 <b>${esc(opts.projectName)}</b>${opts.branch ? ` · <i>${esc(opts.branch)}</i>` : ''}`,
      `🔍 <b>Nguyên nhân:</b> ${esc(d.cause.slice(0, 600))}`,
      `🛠 <b>Cách sửa:</b> ${esc(d.fix.slice(0, 900))}`,
    ];
    if (d.commands.length) {
      lines.push(`<pre>${esc(d.commands.join('\n').slice(0, 500))}</pre>`);
    }
    if (d.configField !== 'none' && d.configValue) {
      lines.push(
        `💡 Sửa cấu hình: <code>${esc(d.configField)} = ${esc(d.configValue.slice(0, 200))}</code>`,
      );
      lines.push('⚡ Mở trang deployment để bấm "Áp dụng &amp; deploy lại".');
    }
    const text = lines.join('\n');

    for (const chatId of recipients) await this.telegram(chatId, text);
  }
}
