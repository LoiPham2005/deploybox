import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { NotifyService } from '../../infra/notify/notify.service';

const CHECK_MS = 6 * 3600_000; // quét mỗi 6 giờ
const REMIND_BEFORE_MS = 3 * 86_400_000; // nhắc trước 3 ngày
const GRACE_MS = 3 * 86_400_000; // ân hạn 3 ngày sau khi hết hạn mới hạ FREE

/**
 * Job nền: nhắc gia hạn (trước 3 ngày) + tự hạ FREE khi PRO quá hạn + hết ân hạn.
 * Team do admin comp (planExpiresAt = null) KHÔNG bị đụng — filter theo mốc thời gian
 * đã tự loại null.
 */
@Injectable()
export class BillingExpiryService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly log = new Logger(BillingExpiryService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly notify: NotifyService,
  ) {}

  onApplicationBootstrap() {
    // Chạy lần đầu sau 1 phút (đợi app ổn định) rồi lặp mỗi 6 giờ
    setTimeout(() => void this.tick().catch((e) => this.log.warn(e)), 60_000);
    this.timer = setInterval(
      () => void this.tick().catch((e) => this.log.warn(e)),
      CHECK_MS,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    const now = new Date();

    // 1) Nhắc gia hạn: PRO, còn hạn, sắp hết trong 3 ngày, chưa nhắc kỳ này
    const soon = new Date(now.getTime() + REMIND_BEFORE_MS);
    const toRemind = await this.prisma.team.findMany({
      where: {
        plan: 'PRO',
        planExpiresAt: { gt: now, lte: soon }, // gt tự loại null
        renewRemindedAt: null,
      },
      include: { members: { where: { role: 'OWNER' }, include: { user: true } } },
    });
    for (const t of toRemind) {
      await this.remind(t.name, t.members.map((m) => m.user.email), t.planExpiresAt!).catch(
        () => undefined,
      );
      await this.prisma.team.update({
        where: { id: t.id },
        data: { renewRemindedAt: now },
      });
    }

    // 2) Hạ FREE: PRO, đã quá hạn + hết ân hạn
    const cutoff = new Date(now.getTime() - GRACE_MS);
    const toDowngrade = await this.prisma.team.findMany({
      where: { plan: 'PRO', planExpiresAt: { lt: cutoff } }, // lt tự loại null
      include: { members: { where: { role: 'OWNER' }, include: { user: true } } },
    });
    for (const t of toDowngrade) {
      await this.prisma.team.update({
        where: { id: t.id },
        data: { plan: 'FREE' },
      });
      this.log.log(`⤵ Hạ FREE (hết hạn): team=${t.name}`);
      await this.notifyDowngrade(t.name, t.members.map((m) => m.user.email)).catch(
        () => undefined,
      );
    }

    if (toRemind.length || toDowngrade.length) {
      this.log.log(`billing tick: nhắc ${toRemind.length}, hạ ${toDowngrade.length}`);
    }
  }

  private async remind(teamName: string, emails: string[], expiresAt: Date) {
    const until = expiresAt.toLocaleDateString('vi-VN');
    if (this.mail.isConfigured()) {
      const html = `<div style="font-family:sans-serif">
        <h2>Gói PRO sắp hết hạn</h2>
        <p>Team <b>${teamName}</b> sẽ hết hạn PRO vào <b>${until}</b>.</p>
        <p>Vào trang <b>Gói dịch vụ</b> để gia hạn, tránh bị hạ về FREE.</p>
      </div>`;
      for (const e of emails) {
        await this.mail.send(e, 'DeployBox — Gói PRO sắp hết hạn', html).catch(
          () => undefined,
        );
      }
    }
    await this.notify
      .broadcast(`⏰ <b>${teamName}</b> sắp hết hạn PRO (${until}). Đã gửi nhắc gia hạn.`)
      .catch(() => undefined);
  }

  private async notifyDowngrade(teamName: string, emails: string[]) {
    if (this.mail.isConfigured()) {
      const html = `<div style="font-family:sans-serif">
        <h2>Gói đã chuyển về FREE</h2>
        <p>Team <b>${teamName}</b> đã hết hạn PRO và chuyển về <b>FREE</b>.</p>
        <p>App đang chạy vẫn hoạt động bình thường; chỉ giới hạn khi tạo mới vượt hạn mức.
        Gia hạn PRO bất cứ lúc nào ở trang Gói dịch vụ.</p>
      </div>`;
      for (const e of emails) {
        await this.mail.send(e, 'DeployBox — Gói đã về FREE', html).catch(
          () => undefined,
        );
      }
    }
    await this.notify
      .broadcast(`⤵ <b>${teamName}</b> hết hạn PRO → đã hạ FREE.`)
      .catch(() => undefined);
  }
}
