'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BillingConfigDto } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setBillingConfigAction } from './actions';

function SrcBadge({ s }: { s: 'db' | 'env' | 'none' }) {
  const map = {
    db: { t: 'DB', c: 'bg-emerald-500/15 text-emerald-300' },
    env: { t: '.env', c: 'bg-white/10 text-white/50' },
    none: { t: 'chưa có', c: 'bg-amber-500/15 text-amber-300' },
  }[s];
  return (
    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${map.c}`}>
      {map.t}
    </span>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-white/60">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-white/30">{hint}</p>}
    </div>
  );
}

const PROVIDER_LABELS: { key: keyof BillingConfigDto['enabled']; label: string }[] = [
  { key: 'sepay', label: 'SePay (QR)' },
  { key: 'vnpay', label: 'VNPay' },
  { key: 'momo', label: 'MoMo' },
  { key: 'zalopay', label: 'ZaloPay' },
];

export function BillingConfigPanel({ config }: { config: BillingConfigDto }) {
  const router = useRouter();
  const [price, setPrice] = useState(String(config.priceVnd));
  const [enabled, setEnabled] = useState(config.enabled);
  // SePay
  const [account, setAccount] = useState(config.sepayAccount);
  const [bank, setBank] = useState(config.sepayBank);
  const [holder, setHolder] = useState(config.sepayHolder);
  const [qrBase, setQrBase] = useState(config.sepayQrBase);
  const [apikey, setApikey] = useState('');
  // VNPay
  const [vnpTmn, setVnpTmn] = useState(config.vnpayTmnCode);
  const [vnpPayUrl, setVnpPayUrl] = useState(config.vnpayPayUrl);
  const [vnpReturn, setVnpReturn] = useState(config.vnpayReturnUrl);
  const [vnpHash, setVnpHash] = useState('');
  // MoMo
  const [momoPartner, setMomoPartner] = useState(config.momoPartnerCode);
  const [momoAccess, setMomoAccess] = useState(config.momoAccessKey);
  const [momoEndpoint, setMomoEndpoint] = useState(config.momoEndpoint);
  const [momoSecret, setMomoSecret] = useState('');
  // ZaloPay
  const [zaloAppId, setZaloAppId] = useState(config.zalopayAppId);
  const [zaloEndpoint, setZaloEndpoint] = useState(config.zalopayEndpoint);
  const [zaloKey1, setZaloKey1] = useState('');
  const [zaloKey2, setZaloKey2] = useState('');

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    const res = await setBillingConfigAction({
      priceVnd: Number(price) || undefined,
      enabled,
      sepayAccount: account,
      sepayBank: bank,
      sepayHolder: holder,
      sepayQrBase: qrBase,
      sepayApikey: apikey.trim() || undefined,
      vnpayTmnCode: vnpTmn,
      vnpayPayUrl: vnpPayUrl,
      vnpayReturnUrl: vnpReturn,
      vnpayHashSecret: vnpHash.trim() || undefined,
      momoPartnerCode: momoPartner,
      momoAccessKey: momoAccess,
      momoEndpoint: momoEndpoint,
      momoSecretKey: momoSecret.trim() || undefined,
      zalopayAppId: zaloAppId,
      zalopayEndpoint: zaloEndpoint,
      zalopayKey1: zaloKey1.trim() || undefined,
      zalopayKey2: zaloKey2.trim() || undefined,
    });
    setSaving(false);
    if (res.ok) {
      setMsg('Đã lưu — có hiệu lực ngay, không cần restart.');
      setApikey('');
      setVnpHash('');
      setMomoSecret('');
      setZaloKey1('');
      setZaloKey2('');
      router.refresh();
    } else {
      setErr(res.error);
    }
  }

  async function clearSecret(patch: Parameters<typeof setBillingConfigAction>[0]) {
    setSaving(true);
    setErr(null);
    setMsg(null);
    const res = await setBillingConfigAction(patch);
    setSaving(false);
    if (res.ok) {
      setMsg('Đã xoá key trong DB — quay về dùng .env.');
      router.refresh();
    } else {
      setErr(res.error);
    }
  }

  return (
    <div className="space-y-5">
      <Field
        label={<>Giá 1 tháng (VND) <SrcBadge s={config.sources.price} /></>}
        hint="Khách trả để lên PRO. Vd 99000. Chọn 3/6/12 tháng thì nhân lên."
      >
        <Input
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="max-w-xs"
        />
      </Field>

      {/* Bật/tắt từng cổng */}
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
        <p className="mb-2 text-sm font-semibold text-white/70">Cổng thanh toán bật</p>
        <div className="flex flex-wrap gap-2">
          {PROVIDER_LABELS.map((p) => {
            const on = enabled[p.key];
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setEnabled((e) => ({ ...e, [p.key]: !e[p.key] }))}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  on
                    ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-300'
                    : 'border-white/10 bg-white/5 text-white/40'
                }`}
              >
                {on ? '● ' : '○ '}
                {p.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-white/30">
          Cổng chỉ hiện cho khách khi <b>BẬT</b> và <b>đã cấu hình đủ</b> credential bên dưới.
        </p>
      </div>

      {/* SePay */}
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
        <p className="text-sm font-semibold text-white/70">
          SePay — chuyển khoản QR <SrcBadge s={config.sources.account} />
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Số tài khoản">
            <Input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="00000406601" />
          </Field>
          <Field label="Ngân hàng (mã)">
            <Input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="TPBank" />
          </Field>
          <Field label="Chủ tài khoản">
            <Input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="PHAM DUC LOI" />
          </Field>
          <Field label="QR base (nâng cao)" hint="Mặc định qr.sepay.vn/img — không cần đổi">
            <Input value={qrBase} onChange={(e) => setQrBase(e.target.value)} />
          </Field>
        </div>
        <Field
          label={<>API Key webhook SePay <SrcBadge s={config.sources.apikey} /></>}
          hint="Đặt ở SePay → Tích hợp WebHooks (Bảo mật → API Key). Để trống = giữ nguyên."
        >
          <div className="flex gap-2">
            <Input
              type="password"
              value={apikey}
              onChange={(e) => setApikey(e.target.value)}
              placeholder={config.sepayHasApikey ? '••••••• (đã lưu)' : 'dán API key SePay'}
              className="flex-1"
            />
            {config.sepayHasApikey && config.sources.apikey === 'db' && (
              <Button variant="ghost" onClick={() => clearSecret({ clearApikey: true })} disabled={saving} className="text-red-400 hover:text-red-300">
                Xoá key
              </Button>
            )}
          </div>
        </Field>
        <p className="text-[11px] text-white/30">
          Webhook URL: <code className="text-white/50">https://api.sneakup.io.vn/api/v1/billing/webhook/sepay</code>
        </p>
      </div>

      {/* VNPay */}
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
        <p className="text-sm font-semibold text-white/70">
          VNPay — thẻ / ví <SrcBadge s={config.sources.vnpayTmn} />
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Terminal ID (vnp_TmnCode)">
            <Input value={vnpTmn} onChange={(e) => setVnpTmn(e.target.value)} placeholder="HSOAIX4V" />
          </Field>
          <Field label="URL thanh toán (vnp_Url)" hint="Sandbox mặc định — prod đổi sang vpcpay thật">
            <Input value={vnpPayUrl} onChange={(e) => setVnpPayUrl(e.target.value)} />
          </Field>
          <Field label="Return URL" hint="Trang khách quay về sau khi trả">
            <Input value={vnpReturn} onChange={(e) => setVnpReturn(e.target.value)} placeholder="https://sneakup.io.vn/settings/billing" />
          </Field>
          <Field label={<>Hash Secret (vnp_HashSecret) <SrcBadge s={config.sources.vnpayHash} /></>} hint="Chuỗi ký checksum VNPay cấp. Để trống = giữ nguyên.">
            <div className="flex gap-2">
              <Input
                type="password"
                value={vnpHash}
                onChange={(e) => setVnpHash(e.target.value)}
                placeholder={config.vnpayHasHashSecret ? '••••••• (đã lưu)' : 'dán HashSecret VNPay'}
                className="flex-1"
              />
              {config.vnpayHasHashSecret && config.sources.vnpayHash === 'db' && (
                <Button variant="ghost" onClick={() => clearSecret({ clearVnpayHashSecret: true })} disabled={saving} className="text-red-400 hover:text-red-300">
                  Xoá
                </Button>
              )}
            </div>
          </Field>
        </div>
        <p className="text-[11px] text-white/30">
          IPN URL: <code className="text-white/50">https://api.sneakup.io.vn/api/v1/billing/webhook/vnpay</code>
        </p>
      </div>

      {/* MoMo */}
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
        <p className="text-sm font-semibold text-white/70">
          MoMo — ví MoMo <SrcBadge s={config.sources.momoPartner} />
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Partner Code">
            <Input value={momoPartner} onChange={(e) => setMomoPartner(e.target.value)} placeholder="MOMOxxxx" />
          </Field>
          <Field label="Access Key">
            <Input value={momoAccess} onChange={(e) => setMomoAccess(e.target.value)} placeholder="accessKey" />
          </Field>
          <Field label="Endpoint (nâng cao)" hint="Mặc định sandbox — prod đổi sang payment.momo.vn">
            <Input value={momoEndpoint} onChange={(e) => setMomoEndpoint(e.target.value)} />
          </Field>
          <Field label={<>Secret Key <SrcBadge s={config.sources.momoSecret} /></>} hint="MoMo cấp. Để trống = giữ nguyên.">
            <div className="flex gap-2">
              <Input
                type="password"
                value={momoSecret}
                onChange={(e) => setMomoSecret(e.target.value)}
                placeholder={config.momoHasSecret ? '••••••• (đã lưu)' : 'dán Secret Key MoMo'}
                className="flex-1"
              />
              {config.momoHasSecret && config.sources.momoSecret === 'db' && (
                <Button variant="ghost" onClick={() => clearSecret({ clearMomoSecret: true })} disabled={saving} className="text-red-400 hover:text-red-300">
                  Xoá
                </Button>
              )}
            </div>
          </Field>
        </div>
        <p className="text-[11px] text-white/30">
          IPN URL: <code className="text-white/50">https://api.sneakup.io.vn/api/v1/billing/webhook/momo</code>
        </p>
      </div>

      {/* ZaloPay */}
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
        <p className="text-sm font-semibold text-white/70">
          ZaloPay <SrcBadge s={config.sources.zaloAppId} />
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="App ID">
            <Input value={zaloAppId} onChange={(e) => setZaloAppId(e.target.value)} placeholder="2553" />
          </Field>
          <Field label="Endpoint (nâng cao)" hint="Mặc định sandbox — prod đổi sang openapi.zalopay.vn">
            <Input value={zaloEndpoint} onChange={(e) => setZaloEndpoint(e.target.value)} />
          </Field>
          <Field label={<>Key1 (tạo đơn) <SrcBadge s={config.sources.zaloKey1} /></>} hint="Ký MAC tạo đơn. Để trống = giữ nguyên.">
            <div className="flex gap-2">
              <Input
                type="password"
                value={zaloKey1}
                onChange={(e) => setZaloKey1(e.target.value)}
                placeholder={config.zalopayHasKey1 ? '••••••• (đã lưu)' : 'dán Key1 ZaloPay'}
                className="flex-1"
              />
              {config.zalopayHasKey1 && config.sources.zaloKey1 === 'db' && (
                <Button variant="ghost" onClick={() => clearSecret({ clearZalopayKey1: true })} disabled={saving} className="text-red-400 hover:text-red-300">
                  Xoá
                </Button>
              )}
            </div>
          </Field>
          <Field label="Key2 (xác thực callback)" hint="Ký MAC callback. Để trống = giữ nguyên.">
            <div className="flex gap-2">
              <Input
                type="password"
                value={zaloKey2}
                onChange={(e) => setZaloKey2(e.target.value)}
                placeholder={config.zalopayHasKey2 ? '••••••• (đã lưu)' : 'dán Key2 ZaloPay'}
                className="flex-1"
              />
              {config.zalopayHasKey2 && (
                <Button variant="ghost" onClick={() => clearSecret({ clearZalopayKey2: true })} disabled={saving} className="text-red-400 hover:text-red-300">
                  Xoá
                </Button>
              )}
            </div>
          </Field>
        </div>
        <p className="text-[11px] text-white/30">
          Callback URL: <code className="text-white/50">https://api.sneakup.io.vn/api/v1/billing/webhook/zalopay</code>
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
        </Button>
        {msg && <span className="text-xs text-emerald-400">{msg}</span>}
        {err && <span className="text-xs text-red-400">{err}</span>}
      </div>

      <p className="text-[11px] text-white/30">
        Lưu vào DB (secret mã hoá), ưu tiên hơn .env, <b>có hiệu lực ngay không cần restart</b>.
        MoMo/VNPay/ZaloPay cần đăng ký merchant + test sandbox trước khi bật production.
      </p>
    </div>
  );
}
