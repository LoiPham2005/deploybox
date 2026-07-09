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
  | 'apikey';

const SETTING: Record<Field, string> = {
  price: 'billing_price_vnd',
  provider: 'billing_default_provider',
  account: 'billing_sepay_account',
  bank: 'billing_sepay_bank',
  holder: 'billing_sepay_holder',
  qrBase: 'billing_sepay_qr_base',
  apikey: 'billing_sepay_apikey',
};
const ENV: Record<Field, string> = {
  price: 'PRO_PRICE_VND',
  provider: 'PAYMENT_PROVIDER_DEFAULT',
  account: 'SEPAY_ACCOUNT',
  bank: 'SEPAY_BANK',
  holder: 'SEPAY_HOLDER',
  qrBase: 'SEPAY_QR_BASE',
  apikey: 'SEPAY_WEBHOOK_APIKEY',
};
const SECRET: Field[] = ['apikey'];
const DEFAULT_QR = 'https://qr.sepay.vn/img';

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

  /** Cho admin UI — trả giá trị không bí mật + cờ đã có apikey + nguồn. */
  async adminView(): Promise<BillingConfigDto> {
    const [price, provider, account, bank, holder, qrBase, apikey] = await Promise.all([
      this.resolve('price'),
      this.resolve('provider'),
      this.resolve('account'),
      this.resolve('bank'),
      this.resolve('holder'),
      this.resolve('qrBase'),
      this.resolve('apikey'),
    ]);
    return {
      priceVnd: Number(price.value) || 99000,
      defaultProvider: provider.value || 'sepay',
      sepayAccount: account.value,
      sepayBank: bank.value,
      sepayHolder: holder.value,
      sepayQrBase: qrBase.value || DEFAULT_QR,
      sepayHasApikey: !!apikey.value,
      sources: {
        price: price.source === 'none' ? 'env' : price.source,
        account: account.source,
        apikey: apikey.source,
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
    // apikey: chỉ đặt khi có chuỗi mới; xoá khi clearApikey = true
    if (patch.clearApikey) {
      await this.prisma.setting.delete({ where: { key: SETTING.apikey } }).catch(() => undefined);
    } else if (patch.sepayApikey && patch.sepayApikey.trim()) {
      await set('apikey', patch.sepayApikey);
    }
  }
}
