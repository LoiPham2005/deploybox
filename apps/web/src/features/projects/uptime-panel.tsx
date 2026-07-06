'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { UptimeStatusDto } from '@deploybox/shared';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', { hour12: false });
}

function durationMin(a: string, b?: string | null): number {
  const end = b ? new Date(b).getTime() : Date.now();
  return Math.max(1, Math.round((end - new Date(a).getTime()) / 60_000));
}

export function UptimePanel({ initial }: { initial: UptimeStatusDto }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        {initial.isDown ? (
          <span className="inline-flex items-center gap-2 text-sm text-red-400">
            <span className="h-2 w-2 rounded-full bg-red-400" /> 🔴 Đang KHÔNG trả lời
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 text-sm text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> App đang trả lời bình thường
          </span>
        )}
        <button
          type="button"
          onClick={() => start(() => router.refresh())}
          disabled={pending}
          className="text-xs text-white/40 hover:underline disabled:opacity-40"
        >
          {pending ? 'Đang tải…' : 'Làm mới'}
        </button>
      </div>
      <p className="text-xs text-white/40">
        DeployBox gọi thử app mỗi phút; 3 phút liền không trả lời → báo Telegram + ghi sự cố ở đây.
      </p>

      {initial.incidents.length === 0 ? (
        <p className="text-xs text-white/30">Chưa ghi nhận sự cố nào. 🎉</p>
      ) : (
        <div className="space-y-1.5">
          {initial.incidents.map((i) => (
            <div
              key={i.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <span className={i.endedAt ? 'text-white/70' : 'font-medium text-red-400'}>
                  {i.endedAt ? 'Đã hồi phục' : 'ĐANG DOWN'}
                </span>
                <span className="ml-2 text-white/40">
                  {fmt(i.startedAt)} · kéo dài ~{durationMin(i.startedAt, i.endedAt)} phút
                </span>
                {i.reason && <span className="ml-2 text-white/30">({i.reason})</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
