import { notFound } from 'next/navigation';
import { LogoMark } from '@/components/logo';

export const dynamic = 'force-dynamic';

const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/api/v1';

interface PublicStatus {
  generatedAt: string;
  services: { name: string; type: string; status: string }[];
}

const STATUS_VIEW: Record<string, { label: string; dot: string; text: string }> = {
  RUNNING: { label: 'Hoạt động', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  SLEEPING: { label: 'Đang ngủ (tự thức khi có truy cập)', dot: 'bg-sky-400', text: 'text-sky-300' },
  BUILDING: { label: 'Đang triển khai', dot: 'bg-amber-400', text: 'text-amber-300' },
  DEPLOYING: { label: 'Đang triển khai', dot: 'bg-amber-400', text: 'text-amber-300' },
  QUEUED: { label: 'Đang triển khai', dot: 'bg-amber-400', text: 'text-amber-300' },
  STOPPED: { label: 'Tạm dừng', dot: 'bg-red-400', text: 'text-red-300' },
  FAILED: { label: 'Sự cố', dot: 'bg-red-400', text: 'text-red-300' },
  CRASHED: { label: 'Sự cố', dot: 'bg-red-400', text: 'text-red-300' },
};

/** 🌐 Trang trạng thái công khai — bật/tắt ở Admin (flag public_status_page). */
export default async function StatusPage() {
  const res = await fetch(`${API_BASE}/public/status`, { cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) notFound(); // flag tắt / API lỗi → 404
  const data = (await res.json()) as PublicStatus;

  const bad = data.services.filter((s) => ['STOPPED', 'FAILED', 'CRASHED'].includes(s.status));
  const allOk = bad.length === 0;

  return (
    <div className="min-h-screen bg-[#09090b] px-4 py-12 text-white">
      {/* tự tải lại mỗi 30s */}
      <meta httpEquiv="refresh" content="30" />
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex items-center gap-2.5">
          <LogoMark size={26} className="rounded-md" />
          <h1 className="text-lg font-bold tracking-tight">Trạng thái dịch vụ</h1>
        </div>

        <div
          className={`rounded-lg border px-4 py-3 text-sm font-medium ${
            allOk
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          {allOk ? '✅ Tất cả dịch vụ hoạt động bình thường' : `⚠️ ${bad.length} dịch vụ đang gặp sự cố`}
        </div>

        <ul className="divide-y divide-white/5 rounded-lg border border-white/[0.07] bg-white/[0.02]">
          {data.services.map((s) => {
            const v = STATUS_VIEW[s.status] ?? { label: s.status, dot: 'bg-white/30', text: 'text-white/50' };
            return (
              <li key={s.name} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="font-medium text-white/80">{s.name}</span>
                <span className={`flex items-center gap-2 text-xs ${v.text}`}>
                  <span className={`h-2 w-2 rounded-full ${v.dot}`} />
                  {v.label}
                </span>
              </li>
            );
          })}
          {data.services.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-white/40">Chưa có dịch vụ nào.</li>
          )}
        </ul>

        <p className="text-center text-xs text-white/30">
          Cập nhật {new Date(data.generatedAt).toLocaleTimeString('vi-VN')} · tự làm mới mỗi 30 giây
        </p>
      </div>
    </div>
  );
}
