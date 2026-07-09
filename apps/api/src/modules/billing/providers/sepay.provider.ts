import { Injectable } from '@nestjs/common';
import type {
  PaymentProvider,
  PaymentOrder,
  ChargeResult,
  CallbackInput,
  CallbackResult,
} from './payment-provider';
import { BillingConfigService } from '../billing-config.service';

/**
 * SePay — chuyển khoản VietQR.
 * Mô hình: sinh VietQR (số tiền + nội dung = mã đơn) → khách quét chuyển khoản →
 * SePay đọc biến động số dư TK ngân hàng → bắn webhook POST kèm nội dung CK.
 * Xác thực webhook bằng header `Authorization: Apikey <SEPAY_WEBHOOK_APIKEY>`.
 * SePay gửi webhook cho MỌI khoản tiền vào → lõi tự dò mã đơn trong nội dung.
 */
@Injectable()
export class SepayProvider implements PaymentProvider {
  readonly key = 'sepay';

  constructor(private readonly cfg: BillingConfigService) {}

  async isConfigured(): Promise<boolean> {
    const c = await this.cfg.getSepay();
    return !!(c.account && c.bank && c.apikey);
  }

  async createCharge(order: PaymentOrder): Promise<ChargeResult> {
    const c = await this.cfg.getSepay();
    const qs = new URLSearchParams({
      acc: c.account,
      bank: c.bank,
      amount: String(order.amount),
      des: order.orderCode, // nội dung CK = mã đơn
    });
    return {
      kind: 'qr',
      qrUrl: `${c.qrBase}?${qs.toString()}`,
      transferContent: order.orderCode,
      bankName: c.bank,
      bankAccount: c.account,
      holder: c.holder,
    };
  }

  async parseCallback(input: CallbackInput): Promise<CallbackResult> {
    const c = await this.cfg.getSepay();
    const miss = (note: string): CallbackResult => ({
      ok: false,
      paid: false,
      orderCode: null,
      rawContent: null,
      providerTxnId: null,
      amount: null,
      note,
    });

    // Xác thực: SePay gửi "Authorization: Apikey <key>"
    const auth = String(input.headers['authorization'] ?? '');
    if (!c.apikey || auth !== `Apikey ${c.apikey}`) {
      return miss('sai apikey');
    }

    const b = (input.body ?? {}) as Record<string, unknown>;
    const txnId = b.id != null ? String(b.id) : null;

    // Chỉ xử lý TIỀN VÀO
    if (String(b.transferType) !== 'in') {
      return {
        ok: true,
        paid: false,
        orderCode: null,
        rawContent: null,
        providerTxnId: txnId,
        amount: null,
        note: 'không phải tiền vào',
      };
    }

    const content = String(b.content ?? b.code ?? '');
    const amount = Number(b.transferAmount ?? 0) || null;
    return {
      ok: true,
      paid: true,
      orderCode: null, // SePay không biết mã đơn → để lõi tự dò trong rawContent
      rawContent: content,
      providerTxnId: txnId,
      amount,
    };
  }
}
