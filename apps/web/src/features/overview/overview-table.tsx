'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { OverviewItemDto } from '@deploybox/shared';
import { StatusBadge } from '@/components/ui/status-badge';
import { Globe, Server, Smartphone } from 'lucide-react';

const TYPE_ICON: Record<string, React.ReactNode> = {
  STATIC: <Globe size={13} className="text-sky-400" />,
  BACKEND: <Server size={13} className="text-violet-400" />,
  MOBILE: <Smartphone size={13} className="text-emerald-400" />,
};

/** Thanh RAM: xanh < 60%, hổ phách 60–80%, đỏ ≥ 80% (khớp ngưỡng cảnh báo). */
function RamBar({ memMb, memoryMb }: { memMb?: number | null; memoryMb: number }) {
  if (memMb == null || !memoryMb) return <span className="text-white/25">—</span>;
  const pct = Math.min(100, Math.round((memMb / memoryMb) * 100));
  const color = pct >= 80 ? 'bg-red-400' : pct >= 60 ? 'bg-amber-400' : 'bg-emerald-400';
  const text = pct >= 80 ? 'text-red-300' : 'text-white/60';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[11px] tabular-nums ${text}`}>
        {Math.round(memMb)}<span className="text-white/30">/{memoryMb}MB</span>
      </span>
    </div>
  );
}

export function OverviewTable({ initial }: { initial: OverviewItemDto[] }) {
  const [items, setItems] = useState<OverviewItemDto[]>(initial);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      fetch('/api/overview')
        .then((r) => (r.ok ? r.json() : null))
        .then((d: OverviewItemDto[] | null) => {
          if (alive && Array.isArray(d)) {
            setItems(d);
            setRefreshedAt(new Date());
          }
        })
        .catch(() => undefined);
    };
    const id = setInterval(tick, 15_000); // tự làm mới mỗi 15s
    return () => { alive = false; clearInterval(id); };
  }, []);

  const running = items.filter((i) => i.status === 'RUNNING').length;
  const down = items.filter((i) => i.isDown).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/45">
        <span>{items.length} app</span>
        <span className="text-emerald-400/80">● {running} đang chạy</span>
        {down > 0 && <span className="text-red-400">● {down} không trả lời</span>}
        <span className="ml-auto text-white/25">
          Tự làm mới 15s{refreshedAt ? ` · ${refreshedAt.toLocaleTimeString('vi-VN', { hour12: false })}` : ''}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
        <table className="w-full text-sm">
          <thead className="text-white/40">
            <tr className="border-b border-white/[0.06] text-left text-xs">
              <th className="px-3 py-2.5 font-medium">App</th>
              <th className="px-3 py-2.5 font-medium">Trạng thái</th>
              <th className="px-3 py-2.5 font-medium">RAM</th>
              <th className="px-3 py-2.5 font-medium">CPU</th>
              <th className="px-3 py-2.5 font-medium">Canh app</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {items.map((i) => (
              <tr key={i.id} className="transition-colors hover:bg-white/[0.02]">
                <td className="px-3 py-2.5">
                  <Link href={`/projects/${i.id}`} className="group flex items-center gap-2 min-w-0">
                    {TYPE_ICON[i.type] ?? <Server size={13} />}
                    <span className="truncate font-medium text-white/85 group-hover:text-white">{i.name}</span>
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  {i.status === 'NONE'
                    ? <span className="text-xs text-white/30">Chưa deploy</span>
                    : <StatusBadge status={i.status} />}
                </td>
                <td className="px-3 py-2.5">
                  {i.type === 'BACKEND' && i.status === 'RUNNING'
                    ? <RamBar memMb={i.memMb} memoryMb={i.memoryMb} />
                    : <span className="text-white/25">—</span>}
                </td>
                <td className="px-3 py-2.5 text-[11px] tabular-nums text-white/60">
                  {i.type === 'BACKEND' && i.status === 'RUNNING' && i.cpuPct != null
                    ? `${i.cpuPct.toFixed(1)}%`
                    : <span className="text-white/25">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  {i.type !== 'BACKEND' || i.status !== 'RUNNING' ? (
                    <span className="text-white/25">—</span>
                  ) : i.isDown ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" /> Không trả lời
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400/80">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> OK
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-white/30">
                  Chưa có app nào. <Link href="/projects/new" className="text-indigo-400 hover:underline">Tạo project</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
