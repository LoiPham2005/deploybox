import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

const SITE_KEY = 'turnstile_site_key';
const SECRET_KEY = 'turnstile_secret_key';
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * 🤖 Cloudflare Turnstile — "check người hay robot" ở đăng nhập/đăng ký.
 * Key admin nhập ở UI (Setting, secret mã hoá at-rest). Chỉ ép kiểm khi:
 * flag turnstile_captcha BẬT + đủ cả site key lẫn secret. Miễn phí, không cần
 * người dùng bấm gì (invisible/managed).
 */
@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly flags: FeatureFlagsService,
  ) {}

  private async setting(key: string): Promise<string> {
    const row = await this.prisma.setting.findUnique({ where: { key } }).catch(() => null);
    return row?.value ?? '';
  }

  async siteKey(): Promise<string> {
    return this.setting(SITE_KEY);
  }

  private async secret(): Promise<string> {
    const raw = await this.setting(SECRET_KEY);
    if (!raw) return '';
    try {
      return this.crypto.decrypt(raw);
    } catch {
      return '';
    }
  }

  /** Có đang ÉP xác minh không (flag bật + đủ key). */
  async isRequired(): Promise<boolean> {
    if (!this.flags.isEnabled('turnstile_captcha')) return false;
    return !!((await this.siteKey()) && (await this.secret()));
  }

  /** Cho trang login/register (public): bật không + site key để render widget. */
  async publicConfig(): Promise<{ enabled: boolean; siteKey: string }> {
    const enabled = await this.isRequired();
    return { enabled, siteKey: enabled ? await this.siteKey() : '' };
  }

  /** Ép kiểm token — gọi ở login/register khi isRequired(). Sai/thiếu → 400. */
  async assertValid(token: string | undefined, ip?: string): Promise<void> {
    if (!(await this.isRequired())) return;
    if (!token) throw new BadRequestException('Thiếu xác minh người thật — tải lại trang rồi thử lại');
    const body = new URLSearchParams({ secret: await this.secret(), response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }).catch((e) => {
      // Cloudflare không trả lời → KHÔNG khoá cửa đăng nhập (fail-open, có log)
      this.logger.warn(`Turnstile verify không gọi được: ${e}`);
      return null;
    });
    if (!res) return;
    const data = (await res.json().catch(() => ({}))) as { success?: boolean };
    if (!data.success) {
      throw new BadRequestException('Xác minh người thật thất bại — tải lại trang rồi thử lại');
    }
  }

  /** Admin xem cấu hình (không trả secret thật). */
  async adminView(): Promise<{ siteKey: string; hasSecret: boolean; enabled: boolean }> {
    return {
      siteKey: await this.siteKey(),
      hasSecret: !!(await this.secret()),
      enabled: this.flags.isEnabled('turnstile_captcha'),
    };
  }

  /** Admin lưu key. secretKey rỗng = giữ nguyên; clearSecret = xoá. */
  async save(patch: { siteKey?: string; secretKey?: string; clearSecret?: boolean }): Promise<void> {
    if (patch.siteKey !== undefined) {
      const v = patch.siteKey.trim();
      if (v) {
        await this.prisma.setting.upsert({
          where: { key: SITE_KEY },
          update: { value: v },
          create: { key: SITE_KEY, value: v },
        });
      } else {
        await this.prisma.setting.delete({ where: { key: SITE_KEY } }).catch(() => undefined);
      }
    }
    if (patch.clearSecret) {
      await this.prisma.setting.delete({ where: { key: SECRET_KEY } }).catch(() => undefined);
    } else if (patch.secretKey && patch.secretKey.trim()) {
      await this.prisma.setting.upsert({
        where: { key: SECRET_KEY },
        update: { value: this.crypto.encrypt(patch.secretKey.trim()) },
        create: { key: SECRET_KEY, value: this.crypto.encrypt(patch.secretKey.trim()) },
      });
    }
  }
}
