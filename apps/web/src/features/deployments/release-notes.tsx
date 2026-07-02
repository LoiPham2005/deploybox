'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { releaseNotesAction } from '@/features/projects/actions';

/** 📝 Nút "Release notes AI" — tóm tắt commit giữa 2 bản deploy. */
export function ReleaseNotes({ deploymentId }: { deploymentId: string }) {
  const [notes, setNotes] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    const res = await releaseNotesAction(deploymentId);
    setLoading(false);
    if (res.ok && res.data) setNotes(res.data.notes);
    else if (!res.ok) setError(res.error);
  }

  return (
    <div>
      <Button
        variant="ghost"
        onClick={run}
        disabled={loading}
        className="px-2 py-1 text-xs text-sky-300"
      >
        {loading ? 'Đang viết…' : notes ? '🔄 Viết lại' : '📝 Release notes AI'}
      </Button>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {notes && (
        <div className="mt-2 whitespace-pre-wrap rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-xs leading-relaxed text-white/75">
          {notes}
        </div>
      )}
    </div>
  );
}
