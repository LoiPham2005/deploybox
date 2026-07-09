import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BillingConfigDto, BillingConfigPatch } from '@deploybox/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

type Field =
  | 'price'
  | 'provider'
  | 'account'
  | 'bank'
  | 'holder'
  | 'qrBase'
  | 'apikey'
  | 'vnpayTmn'
  | 'vnpayHash'
  | 'vnpayPayUrl'
  | 'vnpayReturn'
  | 'momoPartner'
  | 'momoAccess'
  | 'momoSecret'
  | 'momoEndpoint'
  | 'zaloAppId'
  | 'zaloKey1'
  | 'zaloKey2'
  | 'zaloEndpoint';

/** Các cổng có toggle bật/tắt (Setting billing_enabled_<key>, mặc định bật). */
export const PROVIDER_KEYS = ['sepay', 'vnpay', 'momo', 'zalopay'] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];

const SETTING: Record<Field, string> = {
  price: 'billing_price_vnd',
  provider: 'billing_default_provider',
  account: 'billing_sepay_account',
  bank: 'billing_sepay_bank',
  holder: 'billing_sepay_holder',
  qrBase: 'billing_sepay_qr_base',
  apikey: 'billing_sepay_apikey',
  vnpayTmn: 'billing_vnpay_tmn_code',
  vnpayHash: 'billing_vnpay_hash_secret',
  vnpayPayUrl: 'billing_vnpay_pay_url',
  vnpayReturn: 'billing_vnpay_return_url',
  momoPartner: 'billing_momo_partner_code',
  momoAccess: 'billing_momo_access_key',
  momoSecret: 'billing_momo_secret_key',
  momoEndpoint: 'billing_momo_endpoint',
  zaloAppId: 'billing_zalopay_app_id',
  zaloKey1: 'billing_zalopay_key1',
  zaloKey2: 'billing_zalopay_key2',
  zaloEndpoint: 'billing_zalopay_endpoint',
};
const ENV: Record<Field, string> = {
  price: 'PRO_PRICE_VND',
  provider: 'PAYMENT_PROVIDER_DEFAULT',
  account: 'SEPAY_ACCOUNT',
  bank: 'SEPAY_BANK',
  holder: 'SEPAY_HOLDER',
  qrBase: 'SEPAY_QR_BASE',
  apikey: 'SEPAY_WEBHOOK_APIKEY',
  vnpayTmn: 'VNPAY_TMN_CODE',
  vnpayHash: 'VNPAY_HASH_SECRET',
  vnpayPayUrl: 'VNPAY_PAY_URL',
  vnpayReturn: 'VNPAY_RETURN_URL',
  momoPartner: 'MOMO_PARTNER_CODE',
  momoAccess: 'MOMO_ACCESS_KEY',
  momoSecret: 'MOMO_SECRET_KEY',
  momoEndpoint: 'MOMO_ENDPOINT',
  zaloAppId: 'ZALOPAY_APP_ID',
  zaloKey1: 'ZALOPAY_KEY1',
  zaloKey2: 'ZALOPAY_KEY2',
  zaloEndpoint: 'ZALOPAY_ENDPOINT',
};
const SECRET: Field[] = ['apikey', 'vnpayHash', 'momoSecret', 'zaloKey1', 'zaloKey2'];
const DEFAULT_QR = 'https://qr.sepay.vn/img';
const DEFAULT_VNPAY_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const DEFAULT_MOMO_URL = 'https://test-payment.momo.vn/v2/gateway/api/create';
const DEFAULT_ZALO_URL = 'https://sb-openapi.zalopay.vn/v2/create';

/**
 * Cấu hình billing (giá + tài khoản nhận tiền + key cổng): admin sửa ở UI → lưu
 * Setting (secret mã hoá at-rest); ưu tiên DB, fallback .env. Không cần SSH sửa
 * .env + restart. (Cùng pattern với AiKeyService.)
 */
@Injectable()
export class BillingConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  /** Giá trị hiệu lực + nguồn (db/env/none) cho 1 field. */
  private async resolve(f: Field): Promise<{ value: string; source: 'db' | 'env' | 'none' }> {
    const row = await this.prisma.setting
      .findUnique({ where: { key: SETTING[f] } })
      .catch(() => null);
    if (row?.value) {
      if (SECRET.includes(f)) {
        try {
          return { value: this.crypto.decrypt(row.value).trim(), source: 'db' };
        } catch {
          /* giải mã lỗi → rơi xuống env */
        }
      } else {
        return { value: row.value.trim(), source: 'db' };
      }
    }
    const env = String(this.config.get(ENV[f]) ?? '').trim();
    return { value: env, source: env ? 'env' : 'none' };
  }

  private async val(f: Field): Promise<string> {
    return (await this.resolve(f)).value;
  }

  async getPrice(): Promise<number> {
    const n = Number(await this.val('price'));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 99000;
  }

  async getDefaultProvider(): Promise<string> {
    return (await this.val('provider')) || 'sepay';
  }

  async getSepay(): Promise<{
    account: string;
    bank: string;
    holder: string;
    qrBase: string;
    apikey: string;
  }> {
    const [account, bank, holder, qrBase, apikey] = await Promise.all([
      this.val('account'),
      this.val('bank'),
      this.val('holder'),
      this.val('qrBase'),
      this.val('apikey'),
    ]);
    return { account, bank, holder, qrBase: qrBase || DEFAULT_QR, apikey };
  }

  async getVnpay(): Promise<{
    tmnCode: string;
    hashSecret: string;
    payUrl: string;
    returnUrl: string;
  }> {
    const [tmnCode, hashSecret, payUrl, returnUrl] = await Promise.all([
      this.val('vnpayTmn'),
      this.val('vnpayHash'),
      this.val('vnpayPayUrl'),
      this.val('vnpayReturn'),
    ]);
    return {
      tmnCode,
      hashSecret,
      payUrl: payUrl || DEFAULT_VNPAY_URL,
      returnUrl,
    };
  }

  /** URL công khai (để cổng redirect gọi ngược về). */
  private apiBase(): string {
    return (this.config.get<string>('PUBLIC_API_URL') || 'http://localhost:4000').replace(/\/$/, '');
  }
  private webBase(): string {
    return (this.config.get<string>('PUBLIC_WEB_URL') || 'http://localhost:3000').replace(/\/$/, '');
  }

  async getMomo(): Promise<{
    partnerCode: string;
    accessKey: string;
    secretKey: string;
    endpoint: string;
    ipnUrl: string;
    redirectUrl: string;
  }> {
    const [partnerCode, accessKey, secretKey, endpoint] = await Promise.all([
      this.val('momoPartner'),
      this.val('momoAccess'),
      this.val('momoSecret'),
      this.val('momoEndpoint'),
    ]);
    return {
      partnerCode,
      accessKey,
      secretKey,
      endpoint: endpoint || DEFAULT_MOMO_URL,
      ipnUrl: `${this.apiBase()}/api/v1/billing/webhook/momo`,
      redirectUrl: `${this.webBase()}/settings/billing`,
    };
  }

  async getZalopay(): Promise<{
    appId: string;
    key1: string;
    key2: string;
    endpoint: string;
    callbackUrl: string;
    redirectUrl: string;
  }> {
    const [appId, key1, key2, endpoint] = await Promise.all([
      this.val('zaloAppId'),
      this.val('zaloKey1'),
      this.val('zaloKey2'),
      this.val('zaloEndpoint'),
    ]);
    return {
      appId,
      key1,
      key2,
      endpoint: endpoint || DEFAULT_ZALO_URL,
      callbackUrl: `${this.apiBase()}/api/v1/billing/webhook/zalopay`,
      redirectUrl: `${this.webBase()}/settings/billing`,
    };
  }

  // ─── Bật/tắt từng cổng (Setting billing_enabled_<key>, mặc định BẬT) ──────
  private enabledKey(key: string): string {
    return `billing_enabled_${key}`;
  }

  async isProviderEnabled(key: string): Promise<boolean> {
    const row = await this.prisma.setting
      .findUnique({ where: { key: this.enabledKey(key) } })
      .catch(() => null);
    return row?.value !== 'false'; // chưa set = mặc định BẬT
  }

  async enabledMap(): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    await Promise.all(
      PROVIDER_KEYS.map(async (k) => {
        out[k] = await this.isProviderEnabled(k);
      }),
    );
    return out;
  }

  private async setEnabled(key: string, on: boolean): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key: this.enabledKey(key) },
      update: { value: on ? 'true' : 'false' },
      create: { key: this.enabledKey(key), value: on ? 'true' : 'false' },
    });
  }

  /** Cho admin UI — trả giá trị không bí mật + cờ đã có secret + nguồn. */
  async adminView(): Promise<BillingConfigDto> {
    const [
      price, provider, account, bank, holder, qrBase, apikey,
      vnpayTmn, vnpayHash, vnpayPayUrl, vnpayReturn,
      momoPartner, momoAccess, momoSecret, momoEndpoint,
      zaloAppId, zaloKey1, zaloKey2, zaloEndpoint,
      enabled,
    ] = await Promise.all([
      this.resolve('price'),
      this.resolve('provider'),
      this.resolve('account'),
      this.resolve('bank'),
      this.resolve('holder'),
      this.resolve('qrBase'),
      this.resolve('apikey'),
      this.resolve('vnpayTmn'),
      this.resolve('vnpayHash'),
      this.resolve('vnpayPayUrl'),
      this.resolve('vnpayReturn'),
      this.resolve('momoPartner'),
      this.resolve('momoAccess'),
      this.resolve('momoSecret'),
      this.resolve('momoEndpoint'),
      this.resolve('zaloAppId'),
      this.resolve('zaloKey1'),
      this.resolve('zaloKey2'),
      this.resolve('zaloEndpoint'),
      this.enabledMap(),
    ]);
    return {
      priceVnd: Number(price.value) || 99000,
      defaultProvider: provider.value || 'sepay',
      enabled: {
        sepay: enabled.sepay,
        vnpay: enabled.vnpay,
        momo: enabled.momo,
        zalopay: enabled.zalopay,
      },
      sepayAccount: account.value,
      sepayBank: bank.value,
      sepayHolder: holder.value,
      sepayQrBase: qrBase.value || DEFAULT_QR,
      sepayHasApikey: !!apikey.value,
      vnpayTmnCode: vnpayTmn.value,
      vnpayPayUrl: vnpayPayUrl.value || DEFAULT_VNPAY_URL,
      vnpayReturnUrl: vnpayReturn.value,
      vnpayHasHashSecret: !!vnpayHash.value,
      momoPartnerCode: momoPartner.value,
      momoAccessKey: momoAccess.value,
      momoEndpoint: momoEndpoint.value || DEFAULT_MOMO_URL,
      momoHasSecret: !!momoSecret.value,
      zalopayAppId: zaloAppId.value,
      zalopayEndpoint: zaloEndpoint.value || DEFAULT_ZALO_URL,
      zalopayHasKey1: !!zaloKey1.value,
      zalopayHasKey2: !!zaloKey2.value,
      sources: {
        price: price.source === 'none' ? 'env' : price.source,
        account: account.source,
        apikey: apikey.source,
        vnpayTmn: vnpayTmn.source,
        vnpayHash: vnpayHash.source,
        momoPartner: momoPartner.source,
        momoSecret: momoSecret.source,
        zaloAppId: zaloAppId.source,
        zaloKey1: zaloKey1.source,
      },
    };
  }

  /** Admin lưu — field nào có mặt thì cập nhật; apikey rỗng = giữ nguyên. */
  async save(patch: BillingConfigPatch): Promise<void> {
    const set = async (f: Field, value: string | undefined) => {
      if (value === undefined) return; // không đụng
      const v = value.trim();
      if (!v) {
        await this.prisma.setting.delete({ where: { key: SETTING[f] } }).catch(() => undefined);
        return;
      }
      const stored = SECRET.includes(f) ? this.crypto.encrypt(v) : v;
      await this.prisma.setting.upsert({
        where: { key: SETTING[f] },
        update: { value: stored },
        create: { key: SETTING[f], value: stored },
      });
    };

    await set('price', patch.priceVnd != null ? String(patch.priceVnd) : undefined);
    await set('provider', patch.defaultProvider);
    await set('account', patch.sepayAccount);
    await set('bank', patch.sepayBank);
    await set('holder', patch.sepayHolder);
    await set('qrBase', patch.sepayQrBase);
    await set('vnpayTmn', patch.vnpayTmnCode);
    await set('vnpayPayUrl', patch.vnpayPayUrl);
    await set('vnpayReturn', patch.vnpayReturnUrl);
    await set('momoPartner', patch.momoPartnerCode);
    await set('momoAccess', patch.momoAccessKey);
    await set('momoEndpoint', patch.momoEndpoint);
    await set('zaloAppId', patch.zalopayAppId);
    await set('zaloEndpoint', patch.zalopayEndpoint);

    // secret: chỉ đặt khi có chuỗi mới; xoá khi clear* = true
    const secret = async (
      f: Field,
      value: string | undefined,
      clear: boolean | undefined,
    ) => {
      if (clear) {
        await this.prisma.setting.delete({ where: { key: SETTING[f] } }).catch(() => undefined);
      } else if (value && value.trim()) {
        await set(f, value);
      }
    };
    await secret('apikey', patch.sepayApikey, patch.clearApikey);
    await secret('vnpayHash', patch.vnpayHashSecret, patch.clearVnpayHashSecret);
    await secret('momoSecret', patch.momoSecretKey, patch.clearMomoSecret);
    await secret('zaloKey1', patch.zalopayKey1, patch.clearZalopayKey1);
    await secret('zaloKey2', patch.zalopayKey2, patch.clearZalopayKey2);

    // bật/tắt từng cổng
    if (patch.enabled) {
      for (const [k, on] of Object.entries(patch.enabled)) {
        await this.setEnabled(k, !!on);
      }
    }
  }
}
