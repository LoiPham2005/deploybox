import { createHmac } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import type {
  PaymentProvider,
  PaymentOrder,
  ChargeResult,
  CallbackInput,
  CallbackResult,
} from './payment-provider';
import { BillingConfigService } from '../billing-config.service';

/**
 * MoMo — cổng ví/thẻ (redirect).
 * Mô hình: gọi API create (ký HMAC-SHA256) → nhận payUrl → redirect khách →
 * MoMo gọi IPN (POST JSON, có chữ ký) về `…/billing/webhook/momo` để xác nhận.
 *
 * Credential (partnerCode/accessKey/secretKey/endpoint) đọc từ BillingConfigService
 * (admin sửa ở UI, DB ưu tiên hơn .env). Inert tới khi đủ credential.
 * ⚠️ Thuật toán ký theo chuẩn MoMo v2 — test sandbox trước khi bật production.
 */
@Injectable()
export class MomoProvider implements PaymentProvider {
  readonly key = 'momo';
  private readonly log = new Logger(MomoProvider.name);

  constructor(private readonly cfg: BillingConfigService) {}

  async isConfigured(): Promise<boolean> {
    const c = await this.cfg.getMomo();
    return !!(c.partnerCode && c.accessKey && c.secretKey);
  }

  private sign(raw: string, secret: string): string {
    return createHmac('sha256', secret).update(raw, 'utf-8').digest('hex');
  }

  async createCharge(order: PaymentOrder): Promise<ChargeResult> {
    const c = await this.cfg.getMomo();
    const requestId = order.orderCode;
    const orderId = order.orderCode;
    const amount = String(order.amount);
    const orderInfo = order.description;
    const extraData = '';
    // payWithMethod = cổng hiện đầy đủ phương thức cho khách CHỌN (ví MoMo / thẻ
    // ATM nội địa / thẻ quốc tế / QR) — giống VNPay. captureWallet thì vào thẳng QR ví.
    const requestType = 'payWithMethod';
    // Chuỗi ký theo thứ tự alphabet MoMo quy định
    const raw =
      `accessKey=${c.accessKey}&amount=${amount}&extraData=${extraData}` +
      `&ipnUrl=${c.ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}` +
      `&partnerCode=${c.partnerCode}&redirectUrl=${c.redirectUrl}` +
      `&requestId=${requestId}&requestType=${requestType}`;
    const signature = this.sign(raw, c.secretKey);

    const body = {
      partnerCode: c.partnerCode,
      accessKey: c.accessKey,
      requestId,
      amount,
      orderId,
      orderInfo,
      redirectUrl: c.redirectUrl,
      ipnUrl: c.ipnUrl,
      extraData,
      requestType,
      signature,
      lang: 'vi',
    };
    const res = await fetch(c.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      payUrl?: string;
      resultCode?: number;
      message?: string;
    };
    if (!data.payUrl) {
      this.log.warn(`MoMo create thất bại: ${data.resultCode} ${data.message}`);
      throw new Error(`MoMo: ${data.message ?? 'không tạo được đơn'}`);
    }
    return { kind: 'redirect', url: data.payUrl };
  }

  parseCallback(input: CallbackInput): Promise<CallbackResult> {
    return this.cfg.getMomo().then((c) => {
      const b = (input.body ?? {}) as Record<string, unknown>;
      const g = (k: string) => String(b[k] ?? '');
      // Chuỗi ký IPN theo thứ tự alphabet
      const raw =
        `accessKey=${c.accessKey}&amount=${g('amount')}&extraData=${g('extraData')}` +
        `&message=${g('message')}&orderId=${g('orderId')}&orderInfo=${g('orderInfo')}` +
        `&orderType=${g('orderType')}&partnerCode=${g('partnerCode')}&payType=${g('payType')}` +
        `&requestId=${g('requestId')}&responseTime=${g('responseTime')}` +
        `&resultCode=${g('resultCode')}&transId=${g('transId')}`;
      const expected = this.sign(raw, c.secretKey);
      const ok = !!c.secretKey && g('signature') === expected;
      const paid = ok && Number(b.resultCode) === 0;
      return {
        ok,
        paid,
        orderCode: g('orderId') || null,
        rawContent: null,
        providerTxnId: b.transId != null ? String(b.transId) : null,
        amount: b.amount != null ? Number(b.amount) : null,
      };
    });
  }
}
