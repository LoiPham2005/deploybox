'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setCaptchaAction } from './actions';

export interface TurnstileConfigView {
  siteKey: string;
  hasSecret: boolean;
  enabled: boolean;
}

/** Cấu hình Cloudflare Turnstile — key lấy ở dash.cloudflare.com → Turnstile. */
export function TurnstilePanel({ config }: { config: TurnstileConfigView }) {
  const router = useRouter();
  const [siteKey, setSiteKey] = useState(config.siteKey);
  const [secretKey, setSecretKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ready = config.siteKey && config.hasSecret;

  async function save() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    const res = await setCaptchaAction({
      siteKey,
      secretKey: secretKey.trim() || undefined,
    });
    setSaving(false);
    if (res.ok) {
      setMsg('Đã lưu. Bật flag "Check người/robot" ở trên là chạy.');
      setSecretKey('');
      router.refresh();
    } else setErr(res.error);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/40">
        Chống bot dò mật khẩu / spam đăng ký. Tạo widget miễn phí tại{' '}
        <code className="text-white/60">dash.cloudflare.com → Turnstile</code> (domain:
        sneakup.io.vn) → dán 2 key vào đây. Chỉ ép kiểm khi flag{' '}
        <b>&quot;Check người/robot&quot;</b> bật VÀ đủ key.{' '}
        {ready ? (
          <span className="text-emerald-400">Key đã đủ ✓{config.enabled ? ' — ĐANG BẬT' : ' — flag đang tắt'}</span>
        ) : (
          <span className="text-amber-300">Chưa đủ key.</span>
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-white/60">Site key (public)</label>
          <Input value={siteKey} onChange={(e) => setSiteKey(e.target.value)} placeholder="0x4AAA…" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-white/60">Secret key</label>
          <Input
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder={config.hasSecret ? '••••••• (đã lưu)' : 'dán Secret key'}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Đang lưu…' : 'Lưu key Turnstile'}
        </Button>
        {msg && <span className="text-xs text-emerald-400">{msg}</span>}
        {err && <span className="text-xs text-red-400">{err}</span>}
      </div>
    </div>
  );
}
