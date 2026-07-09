import { createHmac } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import type {
  PaymentProvider,
  PaymentOrder,
  ChargeResult,
  CallbackInput,
  CallbackResult,
  CallbackOutcome,
} from './payment-provider';
import { BillingConfigService } from '../billing-config.service';

/**
 * ZaloPay — cổng ví/thẻ (redirect).
 * Mô hình: gọi API /v2/create (ký mac HMAC-SHA256 với key1) → nhận order_url →
 * redirect khách → ZaloPay gọi callback (POST JSON, ký mac với key2) về
 * `…/billing/webhook/zalopay`. Trả {return_code:1} để ZaloPay ngừng gọi lại.
 *
 * Credential (appId/key1/key2/endpoint) đọc từ BillingConfigService (admin sửa ở UI).
 * Inert tới khi đủ credential. ⚠️ Test sandbox ZaloPay trước khi bật production.
 */
@Injectable()
export class ZalopayProvider implements PaymentProvider {
  readonly key = 'zalopay';
  private readonly log = new Logger(ZalopayProvider.name);

  constructor(private readonly cfg: BillingConfigService) {}

  ack(outcome: CallbackOutcome) {
    // return_code: 1 = đã nhận (ngừng retry); -1 = lỗi mac → ZaloPay gọi lại
    return outcome === 'invalid_sig'
      ? { return_code: -1, return_message: 'mac not equal' }
      : { return_code: 1, return_message: 'success' };
  }

  async isConfigured(): Promise<boolean> {
    const c = await this.cfg.getZalopay();
    return !!(c.appId && c.key1 && c.key2);
  }

  private mac(raw: string, key: string): string {
    return createHmac('sha256', key).update(raw, 'utf-8').digest('hex');
  }

  private yymmdd(): string {
    const d = new Date(Date.now() + 7 * 3600_000); // GMT+7
    const p = (n: number) => String(n).padStart(2, '0');
    return `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  }

  async createCharge(order: PaymentOrder): Promise<ChargeResult> {
    const c = await this.cfg.getZalopay();
    const appTransId = `${this.yymmdd()}_${order.orderCode}`;
    const appTime = Date.now();
    const appUser = 'deploybox';
    const item = '[]';
    const embedData = JSON.stringify({ redirecturl: c.redirectUrl });
    // mac tạo đơn: app_id|app_trans_id|app_user|amount|app_time|embed_data|item (key1)
    const raw = [
      c.appId,
      appTransId,
      appUser,
      order.amount,
      appTime,
      embedData,
      item,
    ].join('|');
    const mac = this.mac(raw, c.key1);

    const form = new URLSearchParams({
      app_id: String(c.appId),
      app_trans_id: appTransId,
      app_user: appUser,
      app_time: String(appTime),
      amount: String(order.amount),
      item,
      description: order.description,
      embed_data: embedData,
      bank_code: '',
      callback_url: c.callbackUrl,
      mac,
    });
    const res = await fetch(c.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as {
      return_code?: number;
      order_url?: string;
      return_message?: string;
    };
    if (data.return_code !== 1 || !data.order_url) {
      this.log.warn(`ZaloPay create thất bại: ${data.return_code} ${data.return_message}`);
      throw new Error(`ZaloPay: ${data.return_message ?? 'không tạo được đơn'}`);
    }
    return { kind: 'redirect', url: data.order_url };
  }

  parseCallback(input: CallbackInput): Promise<CallbackResult> {
    return this.cfg.getZalopay().then((c) => {
      const body = (input.body ?? {}) as { data?: string; mac?: string };
      const dataStr = String(body.data ?? '');
      const expected = this.mac(dataStr, c.key2);
      const ok = !!c.key2 && String(body.mac ?? '') === expected;
      if (!ok) {
        return {
          ok: false,
          paid: false,
          orderCode: null,
          rawContent: null,
          providerTxnId: null,
          amount: null,
        };
      }
      let d: Record<string, unknown> = {};
      try {
        d = JSON.parse(dataStr) as Record<string, unknown>;
      } catch {
        /* data không parse được */
      }
      const appTransId = String(d.app_trans_id ?? '');
      const orderCode = appTransId.includes('_')
        ? appTransId.slice(appTransId.indexOf('_') + 1)
        : appTransId;
      // ZaloPay chỉ gọi callback khi thanh toán THÀNH CÔNG → mac hợp lệ = đã trả.
      return {
        ok: true,
        paid: true,
        orderCode: orderCode || null,
        rawContent: null,
        providerTxnId: d.zp_trans_id != null ? String(d.zp_trans_id) : null,
        amount: d.amount != null ? Number(d.amount) : null,
      };
    });
  }
}
