import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Danh sách flag biết trước — THÊM tính năng bật/tắt mới = thêm 1 dòng ở đây.
export const KNOWN_FLAGS: {
  key: string;
  label: string;
  description: string;
  default: boolean;
}[] = [
  {
    key: 'telegram_notifications',
    label: 'Thông báo Telegram',
    description: 'Gửi thông báo deploy (thành công/thất bại) qua Telegram.',
    default: true,
  },
  {
    key: 'plan_limits_enabled',
    label: 'Giới hạn theo gói',
    description:
      'Bật: giới hạn số project/thành viên/server theo gói FREE/PRO (cần mua PRO để vượt). Tắt: không giới hạn, miễn phí toàn bộ.',
    default: true,
  },
  {
    key: 'ai_features',
    label: 'AI bác sĩ lỗi deploy',
    description:
      'Bật: khi deploy thất bại, AI đọc log và gợi ý nguyên nhân + cách sửa (cần ANTHROPIC_API_KEY). Tắt: không gọi AI.',
    default: true,
  },
];

/**
 * Cờ bật/tắt tính năng toàn hệ thống. Seed flag biết trước lúc khởi động,
 * cache trong RAM để check nhanh (isEnabled), admin bật/tắt qua setEnabled.
 */
@Injectable()
export class FeatureFlagsService implements OnApplicationBootstrap {
  private cache = new Map<string, boolean>();

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    for (const f of KNOWN_FLAGS) {
      await this.prisma.featureFlag.upsert({
        where: { key: f.key },
        update: { label: f.label, description: f.description }, // cập nhật nhãn, GIỮ enabled
        create: { key: f.key, enabled: f.default, label: f.label, description: f.description },
      });
    }
    const all = await this.prisma.featureFlag.findMany();
    this.cache = new Map(all.map((f) => [f.key, f.enabled]));
  }

  /** Tính năng có đang bật không (mặc định bật nếu chưa biết flag). */
  isEnabled(key: string): boolean {
    return this.cache.get(key) ?? true;
  }

  list() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async setEnabled(key: string, enabled: boolean) {
    const flag = await this.prisma.featureFlag.update({ where: { key }, data: { enabled } });
    this.cache.set(key, enabled);
    return flag;
  }
}
