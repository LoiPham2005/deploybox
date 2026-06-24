'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { rollbackAction } from '@/features/projects/actions';

export function RollbackButton({
  projectId,
  deploymentId,
}: {
  projectId: string;
  deploymentId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRollback() {
    if (!confirm('Rollback về bản deploy này?')) return;
    setLoading(true);
    setError(null);
    const res = await rollbackAction(deploymentId);
    setLoading(false);
    if (res.ok && res.data) {
      router.push(`/projects/${projectId}/deployments/${res.data.id}`);
      router.refresh();
    } else if (!res.ok) {
      setError(res.error);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        onClick={onRollback}
        disabled={loading}
        className="px-2 py-1 text-xs"
      >
        {loading ? '…' : 'Rollback về bản này'}
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
