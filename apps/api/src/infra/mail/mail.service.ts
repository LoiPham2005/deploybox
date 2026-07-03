import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * Gửi email qua SMTP (mặc định Gmail + App Password).
 * Chưa cấu hình SMTP_USER/SMTP_PASS → isConfigured() = false, tính năng email tự tắt.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!(
      (this.config.get<string>('SMTP_USER') ?? '').trim() &&
      (this.config.get<string>('SMTP_PASS') ?? '').trim()
    );
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const port = this.config.get<number>('SMTP_PORT', 587);
      this.transporter = createTransport({
        host: this.config.get<string>('SMTP_HOST', 'smtp.gmail.com'),
        port,
        secure: port === 465, // 465 = TLS ngay; 587 = STARTTLS
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
    }
    return this.transporter;
  }

  /** Gửi 1 email HTML. Ném lỗi nếu gửi thất bại (caller quyết định xử lý). */
  async send(to: string, subject: string, html: string): Promise<void> {
    const from =
      (this.config.get<string>('MAIL_FROM') ?? '').trim() ||
      `DeployBox <${this.config.get<string>('SMTP_USER')}>`;
    await this.getTransporter().sendMail({ from, to, subject, html });
    this.logger.log(`Đã gửi email "${subject}" → ${to}`);
  }

  /** Email chứa mã OTP (đăng ký / đặt lại mật khẩu). */
  otpHtml(opts: { title: string; code: string; note: string }): string {
    return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:0 auto;padding:24px;background:#0f0f13;color:#e5e5e5;border-radius:12px">
  <p style="font-size:15px;font-weight:bold;margin:0 0 4px;color:#a5b4fc">🚀 DeployBox</p>
  <h2 style="font-size:18px;margin:0 0 16px;color:#ffffff">${opts.title}</h2>
  <p style="font-size:13px;color:#a3a3a3;margin:0 0 16px">${opts.note}</p>
  <div style="background:#1c1c22;border:1px solid #33333d;border-radius:10px;padding:16px;text-align:center">
    <span style="font-size:32px;font-weight:bold;letter-spacing:10px;color:#ffffff">${opts.code}</span>
  </div>
  <p style="font-size:12px;color:#737373;margin:16px 0 0">
    Mã có hiệu lực trong <b>10 phút</b> và chỉ dùng được 1 lần.
    Nếu không phải bạn yêu cầu, hãy bỏ qua email này.
  </p>
</div>`;
  }
}
