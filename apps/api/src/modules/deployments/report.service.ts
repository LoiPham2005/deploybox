import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotifyService } from '../../infra/notify/notify.service';
import { AiService } from '../../infra/ai/ai.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';

const REPORT_HOUR = 8; // gửi sau 8h sáng (giờ máy chủ)
const SWEEP_MS = 10 * 60_000; // kiểm tra mỗi 10 phút
const LAST_SENT_KEY = 'report_last_sent'; // Setting: YYYY-MM-DD đã gửi

/**
 * 📊 Báo cáo ngày/tuần qua Telegram:
 * - Mỗi ngày sau 8h sáng gửi 1 bản (chống trùng bằng Setting `report_last_sent`).
 * - Thứ 2 → báo cáo TUẦN (7 ngày); ngày thường → báo cáo NGÀY (24h).
 * - Số liệu từ bảng Deployment; AI viết 3–5 dòng nhận xét (best-effort, lỗi thì bỏ qua).
 */
@Injectable()
export class ReportService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReportService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
    private readonly ai: AiService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => void this.sweep().catch((e) => this.warn(e)),
      SWEEP_MS,
    );
    this.timer.unref?.();
    // Quét ngay 1 lần lúc boot (trường hợp máy bật sau 8h)
    void this.sweep().catch((e) => this.warn(e));
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private warn(e: unknown): void {
    this.logger.warn(`Report lỗi: ${e instanceof Error ? e.message : e}`);
  }

  private today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private async sweep(): Promise<void> {
    if (!this.flags.aiEnabled('ai_daily_report')) return; // tắt ở Admin → không gửi
    if (new Date().getHours() < REPORT_HOUR) return;
    const sent = await this.prisma.setting.findUnique({ where: { key: LAST_SENT_KEY } });
    const today = this.today();
    if (sent?.value === today) return; // hôm nay gửi rồi

    const isMonday = new Date().getDay() === 1;
    const days = isMonday ? 7 : 1;
    const text = await this.buildReport(days);
    if (!text) {
      // Không có hoạt động → vẫn đánh dấu đã xử lý hôm nay, không nhắn phiền
      await this.saveSent(today);
      return;
    }

    const recipients = await this.allRecipients();
    await this.notify.broadcast(text, recipients);
    await this.saveSent(today);
    this.logger.log(`Đã gửi báo cáo ${days === 7 ? 'tuần' : 'ngày'}.`);
  }

  private async saveSent(today: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key: LAST_SENT_KEY },
      update: { value: today },
      create: { key: LAST_SENT_KEY, value: today },
    });
  }

  private async allRecipients(): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { telegramChatId: { not: null } },
      select: { telegramChatId: true },
    });
    return users.map((u) => u.telegramChatId).filter((x): x is string => !!x);
  }

  /** Dựng nội dung báo cáo. Trả '' nếu không có hoạt động nào trong kỳ. */
  async buildReport(days: number): Promise<string> {
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);

    const deployments = await this.prisma.deployment.findMany({
      where: { queuedAt: { gte: since } },
      select: {
        status: true,
        errorMessage: true,
        trigger: true,
        project: { select: { name: true } },
      },
    });
    const running = await this.prisma.deployment.count({ where: { status: 'RUNNING' } });

    if (!deployments.length && running === 0) return '';

    const total = deployments.length;
    const failed = deployments.filter((d) => d.status === 'FAILED').length;
    const crashes = deployments.filter(
      (d) => d.errorMessage && /crash|smoke test/i.test(d.errorMessage),
    ).length;
    const byProject = new Map<string, { total: number; failed: number }>();
    for (const d of deployments) {
      const cur = byProject.get(d.project.name) ?? { total: 0, failed: 0 };
      cur.total++;
      if (d.status === 'FAILED') cur.failed++;
      byProject.set(d.project.name, cur);
    }

    const period = days === 7 ? '7 ngày qua' : '24 giờ qua';
    const lines = [
      `📊 <b>Báo cáo ${days === 7 ? 'TUẦN' : 'NGÀY'}</b> (${period})`,
      `• Deploy: ${total} lần — ✅ ${total - failed} thành công · ❌ ${failed} thất bại`,
      crashes ? `• 🔥 Crash/smoke fail: ${crashes} lần` : null,
      `• 🟢 App đang chạy: ${running}`,
    ].filter(Boolean) as string[];

    if (byProject.size) {
      lines.push('');
      lines.push('<b>Theo project:</b>');
      for (const [name, s] of [...byProject.entries()].slice(0, 10)) {
        lines.push(`  📦 ${name}: ${s.total} deploy${s.failed ? ` (❌ ${s.failed})` : ''}`);
      }
    }

    // AI nhận xét (best-effort)
    try {
      const stats = lines.join('\n').replace(/<[^>]+>/g, '');
      const comment = await this.ai.answer(
        'Viết 2–4 dòng nhận xét ngắn về tình hình deploy dưới đây và 1 gợi ý hành động nếu có vấn đề. Plain text.',
        stats,
      );
      lines.push('');
      lines.push(`🤖 ${comment}`);
    } catch {
      /* AI tắt/lỗi → báo cáo không có nhận xét */
    }

    return lines.join('\n');
  }
}
