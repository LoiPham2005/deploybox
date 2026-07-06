'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionDto } from '@deploybox/shared';
import { revokeOtherSessionsAction, revokeSessionAction } from './account-actions';

/** Rút gọn user-agent thành "Chrome · macOS" cho dễ đọc (không cần chính xác tuyệt đối). */
function deviceLabel(ua?: string | null): string {
  if (!ua) return 'Thiết bị không rõ';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /curl|node|axios|python/i.test(ua) ? 'CLI/Script'
    : 'Trình duyệt khác';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} · ${os}` : browser;
}

export function SessionsPanel({ initial }: { initial: SessionDto[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function revoke(s: SessionDto) {
    if (!confirm(`Đăng xuất thiết bị "${deviceLabel(s.userAgent)}"?`)) return;
    setErr(null); setMsg(null); setBusy(s.id);
    start(async () => {
      const res = await revokeSessionAction(s.id);
      setBusy(null);
      if (res.ok) { setMsg('Đã đăng xuất thiết bị đó (hiệu lực trong ~1 phút)'); router.refresh(); }
      else setErr(res.error);
    });
  }

  function revokeOthers() {
    if (!confirm('Đăng xuất TẤT CẢ thiết bị khác (giữ thiết bị này)?')) return;
    setErr(null); setMsg(null); setBusy('others');
    start(async () => {
      const res = await revokeOtherSessionsAction();
      setBusy(null);
      if (res.ok) { setMsg(`Đã đăng xuất ${res.revoked} thiết bị khác`); router.refresh(); }
      else setErr(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/40">
        Thấy thiết bị lạ → bấm <b>Đăng xuất</b> là token của nó bị vô hiệu (chậm nhất ~1 phút).
        Phiên đăng nhập trước bản cập nhật này không hiện ở đây — sẽ tự hết hạn trong ≤7 ngày.
      </p>

      {initial.length === 0 ? (
        <p className="text-xs text-white/30">Chưa ghi nhận phiên nào.</p>
      ) : (
        <div className="space-y-2">
          {initial.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium text-white/85">{deviceLabel(s.userAgent)}</span>
                {s.current && (
                  <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                    Thiết bị này
                  </span>
                )}
                <p className="mt-0.5 text-[11px] text-white/40">
                  IP {s.ip ?? '—'} · hoạt động{' '}
                  {new Date(s.lastSeenAt).toLocaleString('vi-VN', { hour12: false })}
                </p>
              </div>
              {!s.current && (
                <button
                  type="button"
                  onClick={() => revoke(s)}
                  disabled={pending && busy === s.id}
                  className="shrink-0 text-xs text-red-400 hover:underline disabled:opacity-40"
                >
                  {busy === s.id ? '…' : 'Đăng xuất'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {initial.some((s) => !s.current) && (
        <button
          type="button"
          onClick={revokeOthers}
          disabled={pending && busy === 'others'}
          className="text-xs text-red-400 hover:underline disabled:opacity-40"
        >
          {busy === 'others' ? 'Đang đăng xuất…' : 'Đăng xuất tất cả thiết bị khác'}
        </button>
      )}
      {msg && <p className="text-xs text-emerald-400">{msg}</p>}
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
