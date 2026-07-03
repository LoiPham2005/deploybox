'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PreviewDto } from '@deploybox/shared';
import { StatusBadge } from '@/components/ui/status-badge';

export function PreviewPanel({
  enabled,
  initial,
}: {
  enabled: boolean;
  initial: PreviewDto[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/40">
        Mỗi Pull Request <b>cùng repo</b> mở ra sẽ tự deploy một bản preview riêng ở{' '}
        <code className="rounded bg-black/30 px-1">pr-&lt;số&gt;-{'{slug}'}.tên-miền</code>. PR đóng/merge
        → tự xoá. Bật/tắt ở mục <b>Sửa cấu hình → Preview mỗi Pull Request</b>.
      </p>

      {!enabled && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-200/80">
          Tính năng đang <b>tắt</b>. Bật ở “Sửa cấu hình” rồi mở Pull Request để tạo preview.
        </div>
      )}

      {enabled && initial.length === 0 && (
        <p className="text-xs text-white/30">Chưa có preview nào. Mở một Pull Request để thử.</p>
      )}

      {initial.length > 0 && (
        <div className="space-y-2">
          {initial.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium text-white/85">PR #{p.prNumber}</span>
                <span className="ml-2 text-[11px] text-white/40">
                  nhánh <code className="text-white/60">{p.branch}</code>
                </span>
                {p.url && (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 block truncate text-[11px] text-sky-300 hover:underline"
                  >
                    {p.url}
                  </a>
                )}
              </div>
              {p.status === 'NONE' ? (
                <span className="text-xs text-white/40">Chưa deploy</span>
              ) : (
                <StatusBadge status={p.status} />
              )}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => start(() => router.refresh())}
        disabled={pending}
        className="text-xs text-white/50 hover:underline disabled:opacity-40"
      >
        {pending ? 'Đang tải…' : 'Làm mới'}
      </button>
    </div>
  );
}
