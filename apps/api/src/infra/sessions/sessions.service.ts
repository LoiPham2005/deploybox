import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { SessionDto } from '@deploybox/shared';
import { PrismaService } from '../prisma/prisma.service';

// JWT sống 7 ngày → phiên không hoạt động quá 8 ngày chắc chắn chết, dọn được
const STALE_DAYS = 8;
// Cache kết quả "phiên còn sống?" để không query DB mỗi request.
// Hệ quả: bấm "Đăng xuất" có hiệu lực chậm nhất ~60 giây.
const CACHE_MS = 60_000;
// Cập nhật lastSeenAt tối đa 1 lần / 5 phút / phiên (đỡ ghi DB dồn dập)
const TOUCH_MS = 5 * 60_000;

@Injectable()
export class SessionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SessionsService.name);
  /** sid → {active, at} — cache kiểm tra phiên */
  private cache = new Map<string, { active: boolean; at: number }>();
  /** sid → lần cập nhật lastSeenAt gần nhất */
  private touched = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    void this.prune();
    const t = setInterval(() => void this.prune(), 24 * 60 * 60_000);
    t.unref?.();
  }

  private async prune(): Promise<void> {
    const stale = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60_000);
    await this.prisma.session
      .deleteMany({
        where: {
          OR: [{ lastSeenAt: { lt: stale } }, { revokedAt: { lt: stale } }],
        },
      })
      .catch((e) => this.logger.warn(`Dọn session lỗi: ${e}`));
  }

  /** Tạo phiên mới khi đăng nhập/đăng ký thành công. */
  async create(userId: string, userAgent?: string, ip?: string): Promise<{ id: string }> {
    const s = await this.prisma.session.create({
      data: {
        userId,
        userAgent: userAgent?.slice(0, 300) ?? null,
        ip: ip?.slice(0, 60) ?? null,
      },
      select: { id: true },
    });
    this.cache.set(s.id, { active: true, at: Date.now() });
    return s;
  }

  /** Guard gọi mỗi request: phiên còn hiệu lực không (cache 60s). */
  async isActive(sid: string): Promise<boolean> {
    const hit = this.cache.get(sid);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      if (hit.active) this.touch(sid);
      return hit.active;
    }
    const row = await this.prisma.session
      .findUnique({ where: { id: sid }, select: { revokedAt: true } })
      .catch(() => null);
    // Phiên không có trong DB (đã bị dọn) → coi như chết; lỗi DB thoáng qua thì
    // row=null cũng chặn — an toàn hơn là cho qua token có sid không xác minh được.
    const active = !!row && !row.revokedAt;
    this.cache.set(sid, { active, at: Date.now() });
    if (this.cache.size > 5000) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    if (active) this.touch(sid);
    return active;
  }

  /** Ghi lastSeenAt — nhiều nhất 1 lần / 5 phút / phiên, không chặn request. */
  private touch(sid: string): void {
    const last = this.touched.get(sid) ?? 0;
    if (Date.now() - last < TOUCH_MS) return;
    this.touched.set(sid, Date.now());
    void this.prisma.session
      .update({ where: { id: sid }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  /** Danh sách thiết bị đang đăng nhập của user (phiên còn sống, mới hoạt động). */
  async list(userId: string, currentSid?: string): Promise<SessionDto[]> {
    const stale = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60_000);
    const rows = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, lastSeenAt: { gte: stale } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      current: s.id === currentSid,
    }));
  }

  /** Đăng xuất 1 phiên (chỉ phiên của chính mình). */
  async revoke(userId: string, sid: string): Promise<{ ok: true }> {
    const row = await this.prisma.session.findUnique({ where: { id: sid } });
    if (!row || row.userId !== userId) {
      throw new NotFoundException('Không tìm thấy phiên đăng nhập');
    }
    await this.prisma.session.update({
      where: { id: sid },
      data: { revokedAt: new Date() },
    });
    this.cache.set(sid, { active: false, at: Date.now() });
    return { ok: true };
  }

  /** Đăng xuất mọi thiết bị KHÁC (giữ phiên hiện tại). */
  async revokeOthers(userId: string, currentSid?: string): Promise<{ revoked: number }> {
    const rows = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, id: { not: currentSid ?? '' } },
      select: { id: true },
    });
    await this.prisma.session.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { revokedAt: new Date() },
    });
    for (const r of rows) this.cache.set(r.id, { active: false, at: Date.now() });
    return { revoked: rows.length };
  }
}
