'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { opsAdviceAction } from './actions';

/** 💡 Gợi ý vận hành từ lịch sử truy cập (giờ sleep, chọn server). */
export function OpsAdvice({ projectId }: { projectId: string }) {
  const [advice, setAdvice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    const res = await opsAdviceAction(projectId);
    setLoading(false);
    if (res.ok && res.data) setAdvice(res.data.advice);
    else if (!res.ok) setError(res.error);
  }

  return (
    <div className="mt-3 border-t border-white/5 pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-white/40">
          💡 Giờ nào vắng nên bật sleep? App nên đặt server nào?
        </p>
        <Button variant="ghost" onClick={run} disabled={loading} className="shrink-0 px-2 py-1 text-xs text-sky-300">
          {loading ? 'Đang phân tích…' : 'Gợi ý vận hành (AI)'}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {advice && (
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/5 p-2.5 text-xs leading-relaxed text-white/70">
          {advice}
        </p>
      )}
    </div>
  );
}
