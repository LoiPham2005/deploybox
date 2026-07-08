import { createHmac } from 'crypto';
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
 * VNPay — cổng thanh toán redirect (thẻ ATM/QR/ví).
 * Mô hình: ký tham số (HMAC-SHA512) → redirect khách sang VNPay trả tiền →
 * VNPay gọi IPN (GET, có chữ ký) về `…/billing/webhook/vnpay` để xác nhận.
 *
 * ⚠️ Thuật toán ký theo chuẩn VNPay 2.1.0. Inert cho tới khi đặt VNPAY_TMN_CODE +
 *    VNPAY_HASH_SECRET. HÃY test ở sandbox VNPay trước khi bật thật.
 *    (Đây là ví dụ minh hoạ "thêm cổng mới" — SePay mới là cổng đang dùng.)
 */
@Injectable()
export class VnpayProvider implements PaymentProvider {
  readonly key = 'vnpay';

  constructor(private readonly config: ConfigService) {}

  private cfg() {
    return {
      tmnCode: this.config.get<string>('VNPAY_TMN_CODE', ''),
      secret: this.config.get<string>('VNPAY_HASH_SECRET', ''),
      payUrl: this.config.get<string>(
        'VNPAY_PAY_URL',
        'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
      ),
      returnUrl: this.config.get<string>('VNPAY_RETURN_URL', ''),
    };
  }

  isConfigured(): boolean {
    const c = this.cfg();
    return !!(c.tmnCode && c.secret);
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

  createCharge(order: PaymentOrder): Promise<ChargeResult> {
    const c = this.cfg();
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
    const { query, secureHash } = this.buildSigned(params, c.secret);
    return Promise.resolve({
      kind: 'redirect',
      url: `${c.payUrl}?${query}&vnp_SecureHash=${secureHash}`,
    });
  }

  parseCallback(input: CallbackInput): Promise<CallbackResult> {
    const c = this.cfg();
    const q = (input.query ?? {}) as Record<string, string>;
    const received = String(q.vnp_SecureHash ?? '');
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(q)) {
      if (k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType') params[k] = String(v);
    }
    const { secureHash } = this.buildSigned(params, c.secret);
    const ok = !!c.secret && received.toLowerCase() === secureHash.toLowerCase();
    const paid =
      ok && q.vnp_ResponseCode === '00' && q.vnp_TransactionStatus === '00';
    return Promise.resolve({
      ok,
      paid,
      orderCode: q.vnp_TxnRef ? String(q.vnp_TxnRef) : null,
      rawContent: null,
      providerTxnId: q.vnp_TransactionNo ? String(q.vnp_TransactionNo) : null,
      amount: q.vnp_Amount ? Number(q.vnp_Amount) / 100 : null,
    });
  }
}
