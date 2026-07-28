'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BackupConfigDto } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setBackupConfigAction } from './actions';

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-white/60">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-white/30">{hint}</p>}
    </div>
  );
}

export function BackupConfigPanel({ config }: { config: BackupConfigDto }) {
  const router = useRouter();
  const [endpoint, setEndpoint] = useState(config.endpoint);
  const [region, setRegion] = useState(config.region);
  const [bucket, setBucket] = useState(config.bucket);
  const [pathStyle, setPathStyle] = useState(config.pathStyle);
  const [retention, setRetention] = useState(String(config.retentionDays));
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    const res = await setBackupConfigAction({
      endpoint,
      region,
      bucket,
      pathStyle,
      retentionDays: Number(retention) || undefined,
      accessKey: accessKey.trim() || undefined,
      secretKey: secretKey.trim() || undefined,
    });
    setSaving(false);
    if (res.ok) {
      setMsg('Đã lưu — hiệu lực ngay.');
      setAccessKey('');
      setSecretKey('');
      router.refresh();
    } else {
      setErr(res.error);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
        <p className="text-sm font-semibold text-white/70">
          S3 nơi lưu backup{' '}
          <span
            className={`ml-1 rounded px-1.5 py-0.5 text-[10px] ${
              config.configured ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
            }`}
          >
            {config.configured ? 'đã cấu hình' : 'chưa cấu hình'}
          </span>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Endpoint" hint="vd https://s3.vn-hcm-1.vietnix.cloud">
            <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://s3.vn-hcm-1.vietnix.cloud" />
          </Field>
          <Field label="Bucket">
            <Input value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="keytest" />
          </Field>
          <Field label="Region">
            <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="vn-hcm-1" />
          </Field>
          <Field label="Giữ backup (ngày)" hint="Bản cũ hơn sẽ tự xoá">
            <Input type="number" value={retention} onChange={(e) => setRetention(e.target.value)} />
          </Field>
          <Field label={<>Access Key {config.hasAccessKey && <span className="text-emerald-400">✓ đã lưu</span>}</>}>
            <Input type="password" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} placeholder={config.hasAccessKey ? '••••• (để trống = giữ)' : 'AWS_ACCESS_KEY_ID'} />
          </Field>
          <Field label={<>Secret Key {config.hasSecretKey && <span className="text-emerald-400">✓ đã lưu</span>}</>}>
            <Input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder={config.hasSecretKey ? '••••• (để trống = giữ)' : 'AWS_SECRET_ACCESS_KEY'} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-xs text-white/60">
          <input type="checkbox" checked={pathStyle} onChange={(e) => setPathStyle(e.target.checked)} className="h-3.5 w-3.5 accent-indigo-500" />
          Path-style endpoint (bật nếu S3 dùng path-style; Vietnix virtual-hosted thì để tắt)
        </label>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu cấu hình'}</Button>
        {msg && <span className="text-xs text-emerald-400">{msg}</span>}
        {err && <span className="text-xs text-red-400">{err}</span>}
      </div>
      <p className="text-[11px] text-white/30">
        Key mã hoá at-rest, ưu tiên hơn .env. Dùng chung cho backup CSDL của mọi project.
        Bật/tắt backup tự động ở từng database (tab Dịch vụ → Sao lưu) và ở Tính năng
        (<code>db_backup</code>).
      </p>
    </div>
  );
}
