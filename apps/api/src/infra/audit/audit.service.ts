import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

const RETENTION_DAYS = 90; // giữ nhật ký 90 ngày

/** Suy nhãn tiếng Việt từ method + path để đọc nhanh (không khớp thì hiện path). */
const ACTION_RULES: { re: RegExp; label: string }[] = [
  { re: /^POST \/api\/v1\/projects\/[^/]+\/deploy/, label: 'Deploy project' },
  { re: /^POST \/api\/v1\/projects\/[^/]+\/redeploy/, label: 'Redeploy project' },
  { re: /^POST \/api\/v1\/projects\/[^/]+\/stop/, label: 'Dừng project' },
  { re: /^POST \/api\/v1\/projects\/[^/]+\/sleep/, label: 'Cho project ngủ' },
  { re: /^POST \/api\/v1\/deployments\/[^/]+\/rollback/, label: 'Rollback deploy' },
  { re: /^(PUT|POST) \/api\/v1\/projects\/[^/]+\/env/, label: 'Sửa biến env' },
  { re: /^DELETE \/api\/v1\/projects\/[^/]+\/databases/, label: 'Xoá database' },
  { re: /^POST \/api\/v1\/projects\/[^/]+\/databases/, label: 'Tạo database' },
  { re: /^POST \/api\/v1\/projects\/[^/]+\/cron\/[^/]+\/run/, label: 'Chạy cron ngay' },
  { re: /^DELETE \/api\/v1\/projects\/[^/]+\/cron/, label: 'Xoá cron job' },
  { re: /^(POST|PATCH) \/api\/v1\/projects\/[^/]+\/cron/, label: 'Tạo/sửa cron job' },
  { re: /^POST \/api\/v1\/projects\/[^/]+\/domains/, label: 'Thêm domain' },
  { re: /^DELETE \/api\/v1\/projects\/[^/]+\/domains/, label: 'Xoá domain' },
  { re: /^DELETE \/api\/v1\/projects\/[^/]+\/members/, label: 'Bỏ quyền project' },
  { re: /^POST \/api\/v1\/projects\/[^/]+\/members/, label: 'Cấp quyền project' },
  { re: /^DELETE \/api\/v1\/projects/, label: 'XOÁ project' },
  { re: /^PATCH \/api\/v1\/projects/, label: 'Sửa cấu hình project' },
  { re: /^POST \/api\/v1\/teams\/[^/]+\/projects/, label: 'Tạo project' },
  { re: /^POST \/api\/v1\/teams\/[^/]+\/members/, label: 'Mời thành viên' },
  { re: /^DELETE \/api\/v1\/teams\/[^/]+\/members/, label: 'Xoá thành viên' },
  { re: /^PATCH \/api\/v1\/admin\/features/, label: 'Bật/tắt tính năng (Admin)' },
  { re: /^PATCH \/api\/v1\/admin\/teams\/[^/]+\/plan/, label: 'Đổi gói team (Admin)' },
  { re: /^PUT \/api\/v1\/admin\/ai/, label: 'Đổi cấu hình AI (Admin)' },
  { re: /^POST \/api\/v1\/auth\/me\/2fa/, label: 'Bật/tắt 2FA' },
  { re: /^POST \/api\/v1\/auth\/me\/password/, label: 'Đổi mật khẩu' },
  { re: /^POST \/api\/v1\/auth\/tokens/, label: 'Tạo API token' },
  { re: /^DELETE \/api\/v1\/auth\/tokens/, label: 'Thu hồi API token' },
  { re: /^POST \/api\/v1\/servers/, label: 'Thêm server' },
  { re: /^DELETE \/api\/v1\/servers/, label: 'Xoá server' },
];

export function actionLabel(method: string, path: string): string {
  const key = `${method} ${path}`;
  return ACTION_RULES.find((r) => r.re.test(key))?.label ?? `${method} ${path}`;
}

@Injectable()
export class AuditService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onApplicationBootstrap(): void {
    // Dọn log quá hạn lúc khởi động + mỗi 24h
    void this.prune();
    const t = setInterval(() => void this.prune(), 24 * 60 * 60_000);
    t.unref?.();
  }

  private async prune(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);
    await this.prisma.auditLog
      .deleteMany({ where: { createdAt: { lt: cutoff } } })
      .catch((e) => this.logger.warn(`Dọn audit log lỗi: ${e}`));
  }

  /** Ghi 1 dòng nhật ký — fire-and-forget, không được làm chậm/hỏng request. */
  record(entry: {
    userId?: string;
    userEmail?: string;
    method: string;
    path: string;
    status: number;
    ip?: string;
  }): void {
    if (!this.flags.isEnabled('audit_log')) return;
    void this.prisma.auditLog
      .create({
        data: {
          userId: entry.userId ?? null,
          userEmail: entry.userEmail ?? null,
          method: entry.method,
          path: entry.path.slice(0, 500),
          action: actionLabel(entry.method, entry.path),
          status: entry.status,
          ip: entry.ip ?? null,
        },
      })
      .catch(() => undefined);
  }

  /** Danh sách gần nhất cho trang Admin (lọc theo email nếu truyền). */
  async list(limit = 100, email?: string) {
    const rows = await this.prisma.auditLog.findMany({
      where: email ? { userEmail: { contains: email } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(1, limit), 500),
    });
    return rows.map((r) => ({
      id: r.id,
      userEmail: r.userEmail,
      method: r.method,
      path: r.path,
      action: r.action,
      status: r.status,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
