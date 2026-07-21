'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cleanDiskAction } from './actions';

export interface DiskInfo {
  freeGb: number;
  totalGb: number;
  usedPct: number;
}

export function DiskPanel({ disk }: { disk: DiskInfo }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function clean() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await cleanDiskAction();
    setBusy(false);
    if (res.ok) {
      setMsg(
        res.data.freedMb > 0
          ? `✓ Giải phóng ~${res.data.freedMb >= 1000 ? (res.data.freedMb / 1000).toFixed(1) + 'GB' : res.data.freedMb + 'MB'} — còn trống ${res.data.freeGb}GB`
          : `✓ Đã dọn — không có gì nhiều để xoá. Còn trống ${res.data.freeGb}GB`,
      );
      router.refresh();
    } else setErr(res.error);
  }

  const usedColor =
    disk.usedPct >= 90 ? 'bg-red-500' : disk.usedPct >= 75 ? 'bg-amber-500' : 'bg-indigo-500';

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs text-white/40">Đĩa còn trống</p>
          <p className="mt-0.5 text-2xl font-bold">
            {disk.freeGb}
            <span className="text-sm font-normal text-white/40"> / {disk.totalGb} GB</span>
          </p>
        </div>
        <Button onClick={clean} disabled={busy}>
          {busy ? 'Đang dọn…' : '🧹 Dọn dung lượng ngay'}
        </Button>
      </div>

      {/* thanh dùng đĩa */}
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${usedColor}`} style={{ width: `${disk.usedPct}%` }} />
      </div>
      <p className="text-[11px] text-white/30">
        Đã dùng {disk.usedPct}%. Nút này dọn: build cache Docker + image/container cũ + thư mục
        build tạm + log rác — <b>KHÔNG đụng app đang chạy</b>. Hệ thống cũng tự dọn mỗi 6h.
      </p>
      {msg && <p className="text-xs text-emerald-400">{msg}</p>}
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
