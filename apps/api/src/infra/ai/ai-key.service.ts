import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

export type AiProvider = 'anthropic' | 'openai' | 'gemini';
export type KeySource = 'db' | 'env' | 'none';

const ENV_VAR: Record<AiProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};
const settingKey = (id: AiProvider) => `ai_key_${id}`;

/**
 * Quản lý API key AI: admin nhập ở UI → lưu Setting (mã hoá at-rest); ưu tiên key
 * DB, không có thì fallback biến .env. Khỏi phải SSH sửa .env + restart.
 */
@Injectable()
export class AiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  /** Key hiệu lực (DB trước, .env sau). Rỗng = chưa cấu hình. */
  async getKey(id: AiProvider): Promise<string> {
    const row = await this.prisma.setting
      .findUnique({ where: { key: settingKey(id) } })
      .catch(() => null);
    if (row?.value) {
      try {
        return this.crypto.decrypt(row.value).trim();
      } catch {
        /* giải mã lỗi (đổi ENCRYPTION_KEY?) → rơi xuống .env */
      }
    }
    return (this.config.get<string>(ENV_VAR[id]) ?? '').trim();
  }

  /** Key đang lấy từ đâu — để UI hiển thị. */
  async source(id: AiProvider): Promise<KeySource> {
    const row = await this.prisma.setting
      .findUnique({ where: { key: settingKey(id) } })
      .catch(() => null);
    if (row?.value) return 'db';
    if ((this.config.get<string>(ENV_VAR[id]) ?? '').trim()) return 'env';
    return 'none';
  }

  /** Admin đặt/sửa key (mã hoá). Chuỗi rỗng = xoá key DB (quay về .env). */
  async setKey(id: AiProvider, plain: string): Promise<void> {
    const key = settingKey(id);
    const value = (plain ?? '').trim();
    if (!value) {
      await this.prisma.setting.delete({ where: { key } }).catch(() => undefined);
      return;
    }
    const enc = this.crypto.encrypt(value);
    await this.prisma.setting.upsert({
      where: { key },
      update: { value: enc },
      create: { key, value: enc },
    });
  }
}
