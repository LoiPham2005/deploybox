import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  BillingStatusDto,
  CheckoutResponse,
  PaymentDto,
} from '@deploybox/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BillingConfigService } from './billing-config.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { MailService } from '../../infra/mail/mail.service';
import { NotifyService } from '../../infra/notify/notify.service';
import type { Payment } from '../../generated/prisma';
import {
  PAYMENT_PROVIDER,
  type CallbackInput,
  type CallbackResult,
  type PaymentProvider,
} from './providers/payment-provider';

const ALLOWED_MONTHS = [1, 3, 6, 12];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ ký tự dễ nhầm

@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);
  private readonly registry = new Map<string, PaymentProvider>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: BillingConfigService,
    private readonly flags: FeatureFlagsService,
    private readonly mail: MailService,
    private readonly notify: NotifyService,
    @Inject(PAYMENT_PROVIDER) providers: PaymentProvider[],
  ) {
    for (const p of providers) this.registry.set(p.key, p);
  }

  priceVnd(): Promise<number> {
    return this.cfg.getPrice();
  }

  private defaultProviderKey(): Promise<string> {
    return this.cfg.getDefaultProvider();
  }

  private provider(key: string): PaymentProvider {
    const p = this.registry.get(key);
    if (!p) throw new BadRequestException(`Cổng thanh toán không hỗ trợ: ${key}`);
    return p;
  }

  private async assertMember(userId: string, teamId: string) {
    const m = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!m) throw new ForbiddenException('Bạn không thuộc team này');
    return m;
  }

  private async assertOwner(userId: string, teamId: string) {
    const m = await this.assertMember(userId, teamId);
    if (m.role !== 'OWNER')
      throw new ForbiddenException('Chỉ chủ team mới nâng cấp gói');
  }

  // ─── Trạng thái gói ────────────────────────────────────────────────────
  async status(userId: string, teamId: string): Promise<BillingStatusDto> {
    await this.assertMember(userId, teamId);
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    const provider = this.registry.get(await this.defaultProviderKey());
    return {
      plan: team.plan as 'FREE' | 'PRO',
      planExpiresAt: team.planExpiresAt?.toISOString() ?? null,
      priceVnd: await this.priceVnd(),
      proUpgradeEnabled: this.flags.isEnabled('billing_pro_upgrade'),
      configured: provider ? await provider.isConfigured() : false,
    };
  }

  // ─── Tạo đơn (checkout) ────────────────────────────────────────────────
  async checkout(
    userId: string,
    teamId: string,
    months: number,
    providerKey?: string,
  ): Promise<CheckoutResponse> {
    await this.assertOwner(userId, teamId);
    if (!this.flags.isEnabled('billing_pro_upgrade')) {
      throw new ForbiddenException('Tính năng mua Pro đang tắt');
    }
    const provider = this.provider(providerKey || (await this.defaultProviderKey()));
    if (!(await provider.isConfigured())) {
      throw new ServiceUnavailableException(
        'Cổng thanh toán chưa được cấu hình. Liên hệ admin.',
      );
    }
    const m = ALLOWED_MONTHS.includes(months) ? months : 1;
    const amount = (await this.priceVnd()) * m;
    const orderCode = this.genOrderCode();

    await this.prisma.payment.create({
      data: { teamId, orderCode, amount, months: m, provider: provider.key },
    });

    const charge = await provider.createCharge({
      orderCode,
      amount,
      months: m,
      description: `DeployBox PRO ${m} thang ${orderCode}`,
    });

    const base = {
      orderCode,
      amount,
      months: m,
      transferContent: orderCode,
    };
    if (charge.kind === 'redirect') {
      return {
        ...base,
        qrUrl: '',
        bankName: '',
        bankAccount: '',
        holder: '',
        redirectUrl: charge.url,
      };
    }
    return {
      ...base,
      qrUrl: charge.qrUrl,
      bankName: charge.bankName,
      bankAccount: charge.bankAccount,
      holder: charge.holder,
      transferContent: charge.transferContent,
    };
  }

  async getOrder(userId: string, orderCode: string): Promise<PaymentDto> {
    const p = await this.prisma.payment.findUnique({ where: { orderCode } });
    if (!p) throw new NotFoundException('Không tìm thấy đơn');
    await this.assertMember(userId, p.teamId);
    return this.toDto(p);
  }

  async history(userId: string, teamId: string): Promise<PaymentDto[]> {
    await this.assertMember(userId, teamId);
    const rows = await this.prisma.payment.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => this.toDto(r));
  }

  // ─── Callback/webhook từ cổng ──────────────────────────────────────────
  async handleCallback(
    providerKey: string,
    input: CallbackInput,
  ): Promise<{ success: boolean }> {
    const provider = this.provider(providerKey);
    const res = await provider.parseCallback(input);
    if (!res.ok) throw new UnauthorizedException('Callback không hợp lệ');
    if (!res.paid) return { success: true }; // ack, bỏ qua (tiền ra / sai loại / lỗi)

    // Chống trùng theo id giao dịch cổng
    if (res.providerTxnId) {
      const dup = await this.prisma.payment.findUnique({
        where: { providerTxnId: res.providerTxnId },
      });
      if (dup) return { success: true };
    }

    const payment = await this.resolvePayment(res);
    if (!payment) {
      this.log.warn(`Giao dịch không khớp đơn nào (${providerKey}): ${res.rawContent ?? res.orderCode}`);
      return { success: true }; // giao dịch lạ → ack, không làm gì
    }
    if (payment.status === 'PAID') return { success: true };
    if (res.amount != null && res.amount < payment.amount) {
      this.log.warn(`Đơn ${payment.orderCode} trả thiếu: ${res.amount}/${payment.amount}`);
      return { success: true }; // trả thiếu → không kích hoạt
    }

    await this.activate(payment, res);
    return { success: true };
  }

  private async resolvePayment(res: CallbackResult): Promise<Payment | null> {
    if (res.orderCode) {
      return this.prisma.payment.findUnique({ where: { orderCode: res.orderCode } });
    }
    if (res.rawContent) {
      // Dò mã đơn trong nội dung CK (SePay): chuẩn hoá rồi tìm đơn PENDING khớp
      const norm = res.rawContent.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const pendings = await this.prisma.payment.findMany({
        where: {
          status: 'PENDING',
          createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return pendings.find((p) => norm.includes(p.orderCode)) ?? null;
    }
    return null;
  }

  private async activate(payment: Payment, res: CallbackResult) {
    const team = await this.prisma.team.findUniqueOrThrow({
      where: { id: payment.teamId },
    });
    // Cộng dồn: nếu còn hạn thì nối tiếp, hết hạn thì tính từ bây giờ
    const now = new Date();
    const base =
      team.planExpiresAt && team.planExpiresAt > now ? team.planExpiresAt : now;
    const end = new Date(base.getTime());
    end.setMonth(end.getMonth() + payment.months);

    try {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'PAID',
            providerTxnId: res.providerTxnId ?? undefined,
            content: res.rawContent ?? undefined,
            paidAt: now,
          },
        }),
        this.prisma.team.update({
          where: { id: team.id },
          data: { plan: 'PRO', planExpiresAt: end, renewRemindedAt: null },
        }),
      ]);
    } catch (e) {
      // Đụng unique providerTxnId (webhook gọi lại đồng thời) → coi như đã xử lý
      this.log.warn(`activate(${payment.orderCode}) bỏ qua: ${(e as Error).message}`);
      return;
    }

    this.log.log(`✓ PRO kích hoạt: team=${team.name} đơn=${payment.orderCode} đến ${end.toISOString()}`);
    await this.notifyPaid(team.id, team.name, payment, end).catch(() => undefined);
  }

  private async notifyPaid(
    teamId: string,
    teamName: string,
    payment: Payment,
    end: Date,
  ) {
    const amount = payment.amount.toLocaleString('vi-VN');
    const until = end.toLocaleDateString('vi-VN');
    if (this.mail.isConfigured()) {
      const owners = await this.prisma.teamMember.findMany({
        where: { teamId, role: 'OWNER' },
        include: { user: true },
      });
      const html = `<div style="font-family:sans-serif">
        <h2>Nâng cấp PRO thành công 🎉</h2>
        <p>Team <b>${teamName}</b> đã lên gói <b>PRO</b>.</p>
        <p>Số tiền: <b>${amount}₫</b> · Thời hạn: <b>${payment.months} tháng</b><br/>
        Hết hạn: <b>${until}</b></p>
      </div>`;
      for (const o of owners) {
        await this.mail
          .send(o.user.email, 'DeployBox — Nâng cấp PRO thành công', html)
          .catch(() => undefined);
      }
    }
    await this.notify
      .broadcast(
        `💰 <b>${teamName}</b> vừa nâng cấp PRO — ${amount}₫ (${payment.months} tháng), hết hạn ${until}.`,
      )
      .catch(() => undefined);
  }

  private genOrderCode(): string {
    const bytes = randomBytes(6);
    let s = '';
    for (let i = 0; i < 6; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return `DBPRO${s}`;
  }

  private toDto(p: Payment): PaymentDto {
    return {
      id: p.id,
      orderCode: p.orderCode,
      amount: p.amount,
      months: p.months,
      status: p.status as PaymentDto['status'],
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    };
  }
}
