'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { summarizeDeploymentAction } from '@/features/projects/actions';

/** Nút "Tóm tắt AI" cạnh tiêu đề Build log — 2000 dòng thành vài dòng. */
export function LogSummary({ deploymentId }: { deploymentId: string }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    const res = await summarizeDeploymentAction(deploymentId);
    setLoading(false);
    if (res.ok && res.data) setSummary(res.data.summary);
    else if (!res.ok) setError(res.error);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white/70">Build log</h2>
        <Button
          variant="ghost"
          onClick={run}
          disabled={loading}
          className="px-2 py-1 text-xs text-sky-300"
        >
          {loading ? 'Đang tóm tắt…' : summary ? '🔄 Tóm tắt lại' : '✨ Tóm tắt AI'}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {summary && (
        <div className="mb-3 mt-2 whitespace-pre-wrap rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-xs leading-relaxed text-white/75">
          {summary}
        </div>
      )}
    </div>
  );
}
