import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Danh sách flag biết trước — THÊM tính năng bật/tắt mới = thêm 1 dòng ở đây.
// Flag AI: `ai_features` là NÚT TỔNG — tắt nó = tắt TOÀN BỘ flag ai_* bên dưới
// (trạng thái từng nút con vẫn giữ nguyên, bật tổng lại là về như cũ).
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
    label: '🤖 AI — NÚT TỔNG',
    description:
      'Tắt nút này = tắt TOÀN BỘ tính năng AI bên dưới (trạng thái từng nút vẫn giữ, bật lại là về như cũ).',
    default: true,
  },
  {
    key: 'ai_diagnosis',
    label: 'AI · Bác sĩ lỗi deploy',
    description:
      'Card "AI chẩn đoán lỗi" ở trang deployment fail + nút "Áp dụng & deploy lại".',
    default: true,
  },
  {
    key: 'ai_auto_diagnosis',
    label: 'AI · Chẩn đoán tự động khi fail',
    description:
      'Deploy fail → AI tự chẩn đoán nền + gửi tin Telegram bổ sung (nguyên nhân + cách sửa).',
    default: true,
  },
  {
    key: 'ai_repo_analyze',
    label: 'AI · Tự nhận diện cấu hình repo',
    description: 'Nút "✨ Tự nhận diện cấu hình (AI)" ở form tạo project.',
    default: true,
  },
  {
    key: 'ai_env_check',
    label: 'AI · Kiểm tra env trước deploy',
    description:
      'Card "🔍 Kiểm tra AI" ở trang project + cảnh báo "thiếu biến env" trong build log.',
    default: true,
  },
  {
    key: 'ai_secret_scan',
    label: 'AI · Quét secret lộ trong repo',
    description: 'Phát hiện .env commit nhầm, API key/token nằm trong code khi quét repo.',
    default: true,
  },
  {
    key: 'ai_log_summary',
    label: 'AI · Tóm tắt build log',
    description: 'Nút "✨ Tóm tắt AI" trên trang deployment (log dài → vài dòng).',
    default: true,
  },
  {
    key: 'ai_watchdog_diagnosis',
    label: 'AI · Chẩn đoán khi app crash',
    description:
      'App đang chạy bị crash → AI chẩn đoán + báo Telegram 🔥. (Watchdog vẫn LUÔN tự khởi động lại app dù tắt nút này.)',
    default: true,
  },
  {
    key: 'ai_smoke_test',
    label: 'AI · Smoke test sau deploy',
    description:
      'Deploy xong tự gọi thử app (~20s) — bắt ca "deploy thành công nhưng app hỏng" + AI chẩn đoán.',
    default: true,
  },
  {
    key: 'ai_auto_rollback',
    label: 'AI · Tự động rollback',
    description:
      'Bản Docker mới smoke test fail → tự rollback về image ổn định gần nhất. Tắt: chỉ cảnh báo.',
    default: true,
  },
  {
    key: 'ai_telegram_qa',
    label: 'AI · Hỏi đáp qua bot Telegram',
    description: 'Nhắn bot câu hỏi tự do về project → AI trả lời. (/status vẫn dùng được.)',
    default: true,
  },
  {
    key: 'ai_daily_report',
    label: 'AI · Báo cáo ngày/tuần',
    description:
      'Mỗi sáng (8h) gửi báo cáo deploy 24h qua Telegram; thứ 2 gửi báo cáo tuần + AI nhận xét.',
    default: true,
  },
  {
    key: 'ai_dockerfile_gen',
    label: 'AI · Sinh Dockerfile tự động',
    description:
      'Project Docker mà repo không có Dockerfile → AI tự sinh (multi-stage, đúng port) rồi build luôn.',
    default: true,
  },
  {
    key: 'ai_log_masking',
    label: 'AI · Che secret trong log',
    description:
      'Tự che giá trị env bí mật + token/key lỡ in ra build log (che cả trước khi gửi AI đọc).',
    default: true,
  },
  {
    key: 'ai_migration_guard',
    label: 'AI · Gác lệnh phá dữ liệu',
    description:
      'Chặn deploy nếu lệnh build/start chứa lệnh phá DB (prisma migrate reset, DROP TABLE…). Cố ý dùng thì tắt nút này.',
    default: true,
  },
  {
    key: 'ai_smart_autodeploy',
    label: 'AI · Auto-deploy có não',
    description:
      'Push chỉ đổi tài liệu/ảnh → bỏ qua không deploy; push đổi schema DB → vẫn deploy nhưng cảnh báo Telegram.',
    default: true,
  },
  {
    key: 'ai_early_warning',
    label: 'AI · Cảnh báo sớm trước crash',
    description:
      'App đang chạy mà log lỗi tăng vọt (≥8 dòng error/phút) → báo Telegram TRƯỚC khi app chết hẳn.',
    default: true,
  },
  {
    key: 'ai_ops_tips',
    label: 'AI · Gợi ý vận hành',
    description:
      'Kèm gợi ý xử lý theo loại lỗi khi crash/smoke fail: hết RAM → tăng memoryMb, cổng bận → đổi port…',
    default: true,
  },
  {
    key: 'ai_fix_memory',
    label: 'AI · Học từ lịch sử sửa lỗi',
    description:
      'Lỗi trùng với lỗi CŨ đã sửa thành công → trả lời ngay từ lịch sử (0 đồng, tức thì) kèm ghi chú "lần trước sửa bằng cách này".',
    default: true,
  },
  {
    key: 'ai_bot_actions',
    label: 'AI · Bot Telegram thao tác',
    description:
      'Cho phép nhắn bot /deploy /stop <tên app> — có nút xác nhận, đúng quyền của người nhắn. Tắt: bot chỉ đọc.',
    default: true,
  },
  {
    key: 'ai_usage_tracking',
    label: 'AI · Theo dõi chi phí',
    description:
      'Ghi lại token/lượt gọi của từng tính năng AI → card "Chi phí AI" ở Admin. Tắt: không ghi.',
    default: true,
  },
  {
    key: 'ai_metrics_anomaly',
    label: 'AI · Cảnh báo RAM bất thường',
    description:
      'Theo dõi RAM app đang chạy (host-run): tăng đều liên tục nghi memory leak → báo Telegram trước khi OOM.',
    default: true,
  },
  {
    key: 'ai_copilot',
    label: 'AI · Copilot trong dashboard',
    description:
      'Khung chat nổi trong web: hỏi về project + AI đề xuất hành động (deploy/stop — phải bấm xác nhận mới chạy).',
    default: true,
  },
  {
    key: 'ai_onboarding',
    label: 'AI · Onboarding người mới',
    description: 'Dashboard trống → copilot mở chế độ dẫn từng bước: nối repo → nhận diện → deploy đầu tiên.',
    default: true,
  },
  {
    key: 'ai_photo_diagnosis',
    label: 'AI · Đọc ảnh lỗi qua bot',
    description: 'Gửi ảnh chụp màn hình lỗi cho bot Telegram (kèm câu hỏi) → AI đọc ảnh chẩn đoán.',
    default: true,
  },
  {
    key: 'ai_dns_diagnosis',
    label: 'AI · Chẩn đoán domain/DNS',
    description: 'Domain kẹt PENDING_DNS/FAILED → nút chẩn đoán: tra DNS thật + hướng dẫn trỏ record từng bước.',
    default: true,
  },
  {
    key: 'ai_release_notes',
    label: 'AI · Release notes tự động',
    description: 'Nút ở trang deployment: tóm tắt commit giữa 2 bản deploy thành changelog tiếng Việt.',
    default: true,
  },
  {
    key: 'ai_ci_generator',
    label: 'AI · Sinh file CI',
    description: 'Sinh GitHub Actions workflow gọi API deploy của project (copy-paste là chạy).',
    default: true,
  },
  {
    key: 'ai_ops_advice',
    label: 'AI · Gợi ý giờ ngủ/chọn server',
    description: 'Đọc lịch sử truy cập (access log) → gợi ý bật sleep giờ nào, đặt app lên server nào.',
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
    // Dọn flag cũ không còn trong danh sách (vd auto_rollback → ai_auto_rollback)
    await this.prisma.featureFlag.deleteMany({
      where: { key: { notIn: KNOWN_FLAGS.map((f) => f.key) } },
    });
    const all = await this.prisma.featureFlag.findMany();
    this.cache = new Map(all.map((f) => [f.key, f.enabled]));
  }

  /** Tính năng có đang bật không (mặc định bật nếu chưa biết flag). */
  isEnabled(key: string): boolean {
    return this.cache.get(key) ?? true;
  }

  /**
   * Tính năng AI con có hiệu lực không = NÚT TỔNG `ai_features` bật VÀ nút con bật.
   * Dùng cho mọi tính năng ai_* — tắt tổng là tắt hết bất kể nút con.
   */
  aiEnabled(key: string): boolean {
    return this.isEnabled('ai_features') && this.isEnabled(key);
  }

  /** Danh sách flag — nút tổng AI đứng trước các nút ai_* con, nhóm chung lên đầu. */
  async list() {
    const all = await this.prisma.featureFlag.findMany();
    const order = new Map(KNOWN_FLAGS.map((f, i) => [f.key, i]));
    return all.sort(
      (a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999),
    );
  }

  async setEnabled(key: string, enabled: boolean) {
    const flag = await this.prisma.featureFlag.update({ where: { key }, data: { enabled } });
    this.cache.set(key, enabled);
    return flag;
  }
}
