import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PaymentProvider,
  PaymentOrder,
  ChargeResult,
  CallbackInput,
  CallbackResult,
} from './payment-provider';

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

  constructor(private readonly config: ConfigService) {}

  private cfg() {
    return {
      account: this.config.get<string>('SEPAY_ACCOUNT', ''),
      bank: this.config.get<string>('SEPAY_BANK', ''),
      holder: this.config.get<string>('SEPAY_HOLDER', ''),
      qrBase: this.config.get<string>('SEPAY_QR_BASE', 'https://qr.sepay.vn/img'),
      apiKey: this.config.get<string>('SEPAY_WEBHOOK_APIKEY', ''),
    };
  }

  isConfigured(): boolean {
    const c = this.cfg();
    return !!(c.account && c.bank && c.apiKey);
  }

  createCharge(order: PaymentOrder): Promise<ChargeResult> {
    const c = this.cfg();
    const qs = new URLSearchParams({
      acc: c.account,
      bank: c.bank,
      amount: String(order.amount),
      des: order.orderCode, // nội dung CK = mã đơn
    });
    return Promise.resolve({
      kind: 'qr',
      qrUrl: `${c.qrBase}?${qs.toString()}`,
      transferContent: order.orderCode,
      bankName: c.bank,
      bankAccount: c.account,
      holder: c.holder,
    });
  }

  parseCallback(input: CallbackInput): Promise<CallbackResult> {
    const c = this.cfg();
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
    if (!c.apiKey || auth !== `Apikey ${c.apiKey}`) {
      return Promise.resolve(miss('sai apikey'));
    }

    const b = (input.body ?? {}) as Record<string, unknown>;
    const txnId = b.id != null ? String(b.id) : null;

    // Chỉ xử lý TIỀN VÀO
    if (String(b.transferType) !== 'in') {
      return Promise.resolve({
        ok: true,
        paid: false,
        orderCode: null,
        rawContent: null,
        providerTxnId: txnId,
        amount: null,
        note: 'không phải tiền vào',
      });
    }

    const content = String(b.content ?? b.code ?? '');
    const amount = Number(b.transferAmount ?? 0) || null;
    return Promise.resolve({
      ok: true,
      paid: true,
      orderCode: null, // SePay không biết mã đơn → để lõi tự dò trong rawContent
      rawContent: content,
      providerTxnId: txnId,
      amount,
    });
  }
}
