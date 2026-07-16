'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  runBackupAction,
  setFailoverAction,
  getBackupStatusAction,
  setBackupTargetAction,
} from './actions';

export interface BackupStatusView {
  last: {
    at: string | null;
    ok: boolean;
    sizeBytes: number;
    replicated: boolean;
    error: string | null;
    durationMs: number;
  } | null;
  files: { name: string; sizeBytes: number }[];
  secondaryConfigured: boolean;
  usingBackupDb: boolean;
  running: boolean;
  target: { display: string; source: 'admin' | 'env' | 'none' };
}

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))}KB`;

export function BackupPanel({ status }: { status: BackupStatusView }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Đổi nơi nhận backup (URL DB phụ) — nhập mới thì mới gửi, trống = giữ nguyên
  const [targetUrl, setTargetUrl] = useState('');
  const [savingTarget, setSavingTarget] = useState(false);

  async function saveTarget(clear = false) {
    setSavingTarget(true);
    setErr(null);
    setMsg(null);
    const res = await setBackupTargetAction(clear ? undefined : targetUrl.trim(), clear);
    setSavingTarget(false);
    if (res.ok) {
      setMsg(clear ? 'Đã xoá cấu hình — quay về DB phụ trong .env (nếu có).' : 'Đã kiểm tra kết nối + lưu DB phụ mới ✓');
      setTargetUrl('');
      router.refresh();
    } else setErr(res.error);
  }

  async function backupNow() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await runBackupAction();
    setBusy(false);
    if (res.ok) {
      setMsg('Backup xong — đã lưu local' + (status.secondaryConfigured ? ' + đẩy sang DB phụ.' : '.'));
      router.refresh();
    } else setErr(res.error);
  }

  async function failover(useBackup: boolean) {
    const ok = await confirm({
      title: useBackup ? 'Chuyển sang DB DỰ PHÒNG?' : 'Chuyển VỀ DB chính?',
      message: useBackup
        ? 'Chỉ dùng khi DB chính gặp sự cố. DB phụ là BẢN SAO tại lần backup gần nhất — dữ liệu mới hơn có thể thiếu. Dữ liệu ghi trong lúc dùng DB phụ sẽ KHÔNG tự về DB chính. API sẽ restart (~10s).'
        : 'Quay về DB chính. Dữ liệu đã ghi vào DB phụ trong thời gian failover sẽ KHÔNG tự chuyển về. API sẽ restart (~10s).',
      confirmText: useBackup ? 'Chuyển sang DB phụ' : 'Về DB chính',
      danger: true,
    });
    if (!ok) return;
    setSwitching(true);
    setErr(null);
    const res = await setFailoverAction(useBackup);
    if (!res.ok) {
      setSwitching(false);
      setErr(res.error);
      return;
    }
    // API đang restart → poll tới khi trả lời lại rồi refresh trang
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const s = await getBackupStatusAction();
      if (s.ok) break;
    }
    setSwitching(false);
    router.refresh();
  }

  const last = status.last;
  return (
    <div className="space-y-5">
      {dialog}

      {/* DB đang dùng */}
      <div
        className={`rounded-lg border px-4 py-3 ${
          status.usingBackupDb
            ? 'border-amber-500/40 bg-amber-500/10'
            : 'border-emerald-500/20 bg-emerald-500/5'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">
              Đang dùng:{' '}
              {status.usingBackupDb ? (
                <span className="text-amber-300">DB DỰ PHÒNG (failover)</span>
              ) : (
                <span className="text-emerald-300">DB chính</span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-white/40">
              {status.secondaryConfigured
                ? 'DB phụ đã cấu hình (DATABASE_URL_BACKUP) — nhận bản sao mỗi lần backup.'
                : 'CHƯA cấu hình DB phụ — thêm DATABASE_URL_BACKUP vào .env để bật failover.'}
            </p>
          </div>
          {status.secondaryConfigured && (
            <Button
              variant="ghost"
              onClick={() => failover(!status.usingBackupDb)}
              disabled={switching}
              className={status.usingBackupDb ? 'text-emerald-300' : 'text-amber-300'}
            >
              {switching
                ? 'Đang chuyển (API restart)…'
                : status.usingBackupDb
                  ? '↩ Về DB chính'
                  : '⚠ Chuyển sang DB phụ'}
            </Button>
          )}
        </div>
        {status.usingBackupDb && (
          <p className="mt-2 text-xs text-amber-300/80">
            Đang chạy trên bản sao — backup định kỳ tạm dừng. Khắc phục DB chính xong hãy chuyển về.
          </p>
        )}
      </div>

      {/* Nơi nhận backup (DB phụ) — đổi động, không cần sửa .env */}
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 space-y-2">
        <p className="text-sm font-semibold text-white/70">
          Nơi nhận backup (DB phụ)
          {status.target.source !== 'none' && (
            <span
              className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                status.target.source === 'admin'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-white/10 text-white/50'
              }`}
            >
              {status.target.source === 'admin' ? 'Admin nhập' : '.env'}
            </span>
          )}
        </p>
        <p className="text-xs text-white/40">
          Đang trỏ tới:{' '}
          {status.target.display ? (
            <code className="text-white/60">{status.target.display}</code>
          ) : (
            <span className="text-amber-300">chưa có</span>
          )}
        </p>
        <div className="flex gap-2">
          <Input
            type="password"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="postgresql://user:pass@host/dbname (Neon/Supabase/PostgreSQL bất kỳ)"
            className="flex-1"
          />
          <Button onClick={() => saveTarget(false)} disabled={savingTarget || !targetUrl.trim() || status.usingBackupDb}>
            {savingTarget ? 'Đang kiểm tra…' : 'Kiểm tra & lưu'}
          </Button>
          {status.target.source === 'admin' && (
            <Button
              variant="ghost"
              onClick={() => saveTarget(true)}
              disabled={savingTarget || status.usingBackupDb}
              className="text-red-400 hover:text-red-300"
            >
              Xoá
            </Button>
          )}
        </div>
        <p className="text-[11px] text-white/30">
          Server tự <b>kiểm tra kết nối</b> trước khi lưu (URL sai sẽ báo lỗi, không lưu). Sau khi
          đổi, bấm &quot;Backup ngay&quot; để đẩy bản sao đầu tiên sang DB mới.
          {status.usingBackupDb && ' Đang chạy trên DB phụ — về DB chính trước khi đổi.'}
        </p>
      </div>

      {/* Backup gần nhất */}
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white/70">Backup gần nhất</p>
            {last ? (
              <p className="mt-1 text-sm">
                {last.ok ? '✅' : '🛑'}{' '}
                {last.at ? new Date(last.at).toLocaleString('vi-VN') : '—'} ·{' '}
                {kb(last.sizeBytes)}
                {last.replicated && (
                  <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                    đã sao sang DB phụ
                  </span>
                )}
              </p>
            ) : (
              <p className="mt-1 text-sm text-white/40">Chưa chạy lần nào (tự chạy mỗi 6h)</p>
            )}
            {last?.error && (
              <p className="mt-1 break-all text-xs text-red-400">{last.error}</p>
            )}
          </div>
          <Button onClick={backupNow} disabled={busy || status.running}>
            {busy || status.running ? 'Đang backup…' : '💾 Backup ngay'}
          </Button>
        </div>

        {status.files.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-white/[0.06] pt-3 text-xs text-white/50">
            {status.files.map((f) => (
              <li key={f.name} className="flex justify-between">
                <code>{f.name}</code>
                <span>{kb(f.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3">
        {msg && <span className="text-xs text-emerald-400">{msg}</span>}
        {err && <span className="text-xs text-red-400">{err}</span>}
      </div>

      <p className="text-[11px] text-white/30">
        Bật/tắt backup định kỳ ở tab Tính năng (&quot;Backup DB nền tảng&quot;). File local giữ 7 bản
        gần nhất; mỗi lần backup cũng đẩy nguyên bản sao sang DB phụ để failover được ngay.
      </p>
    </div>
  );
}
