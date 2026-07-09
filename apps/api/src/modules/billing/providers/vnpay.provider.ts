import { createHmac } from 'crypto';
import { Injectable } from '@nestjs/common';
import type {
  PaymentProvider,
  PaymentOrder,
  ChargeResult,
  CallbackInput,
  CallbackResult,
  CallbackOutcome,
} from './payment-provider';
import { BillingConfigService } from '../billing-config.service';

// Mã phản hồi IPN theo chuẩn VNPay (merchant phải trả đúng để VNPay ngừng retry).
const VNPAY_ACK: Record<CallbackOutcome, { RspCode: string; Message: string }> = {
  success: { RspCode: '00', Message: 'Confirm Success' },
  already_paid: { RspCode: '02', Message: 'Order already confirmed' },
  not_found: { RspCode: '01', Message: 'Order not found' },
  invalid_amount: { RspCode: '04', Message: 'Invalid amount' },
  invalid_sig: { RspCode: '97', Message: 'Invalid signature' },
  ignored: { RspCode: '00', Message: 'Confirm Success' }, // đã nhận IPN (GD thất bại)
};

/**
 * VNPay — cổng thanh toán redirect (thẻ ATM/QR/ví).
 * Mô hình: ký tham số (HMAC-SHA512) → redirect khách sang VNPay trả tiền →
 * VNPay gọi IPN (GET, có chữ ký) về `…/billing/webhook/vnpay` để xác nhận.
 *
 * Credential (TmnCode + HashSecret + payUrl + returnUrl) đọc từ BillingConfigService
 * (admin sửa ở UI, DB ưu tiên hơn .env). Inert cho tới khi có TmnCode + HashSecret.
 * Thuật toán ký theo chuẩn VNPay 2.1.0 — test sandbox trước khi bật thật.
 */
@Injectable()
export class VnpayProvider implements PaymentProvider {
  readonly key = 'vnpay';

  constructor(private readonly cfg: BillingConfigService) {}

  ack(outcome: CallbackOutcome) {
    return VNPAY_ACK[outcome];
  }

  async isConfigured(): Promise<boolean> {
    const c = await this.cfg.getVnpay();
    return !!(c.tmnCode && c.hashSecret);
  }

  /** Sắp xếp key tăng dần, encode giá trị kiểu x-www-form-urlencoded (space → +). */
  private buildSigned(params: Record<string, string>, secret: string) {
    const sorted = Object.keys(params)
      .filter((k) => params[k] !== '' && params[k] != null)
      .sort();
    const signData = sorted
      .map((k) => `${k}=${encodeURIComponent(params[k]).replace(/%20/g, '+')}`)
      .join('&');
    const secureHash = createHmac('sha512', secret)
      .update(Buffer.from(signData, 'utf-8'))
      .digest('hex');
    return { query: signData, secureHash };
  }

  private now(): string {
    // yyyyMMddHHmmss theo giờ VN (GMT+7)
    const d = new Date(Date.now() + 7 * 3600_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
      `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
    );
  }

  async createCharge(order: PaymentOrder): Promise<ChargeResult> {
    const c = await this.cfg.getVnpay();
    const params: Record<string, string> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: c.tmnCode,
      vnp_Amount: String(order.amount * 100), // VNPay tính bằng xu
      vnp_CurrCode: 'VND',
      vnp_TxnRef: order.orderCode,
      vnp_OrderInfo: order.description,
      vnp_OrderType: 'other',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: c.returnUrl,
      vnp_IpAddr: '127.0.0.1',
      vnp_CreateDate: this.now(),
    };
    const { query, secureHash } = this.buildSigned(params, c.hashSecret);
    return {
      kind: 'redirect',
      url: `${c.payUrl}?${query}&vnp_SecureHash=${secureHash}`,
    };
  }

  async parseCallback(input: CallbackInput): Promise<CallbackResult> {
    const c = await this.cfg.getVnpay();
    const q = (input.query ?? {}) as Record<string, string>;
    const received = String(q.vnp_SecureHash ?? '');
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(q)) {
      if (k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType') params[k] = String(v);
    }
    const { secureHash } = this.buildSigned(params, c.hashSecret);
    const ok = !!c.hashSecret && received.toLowerCase() === secureHash.toLowerCase();
    const paid =
      ok && q.vnp_ResponseCode === '00' && q.vnp_TransactionStatus === '00';
    return {
      ok,
      paid,
      orderCode: q.vnp_TxnRef ? String(q.vnp_TxnRef) : null,
      rawContent: null,
      providerTxnId: q.vnp_TransactionNo ? String(q.vnp_TransactionNo) : null,
      amount: q.vnp_Amount ? Number(q.vnp_Amount) / 100 : null,
    };
  }
}
