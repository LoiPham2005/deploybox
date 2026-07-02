'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { rollbackAction } from '@/features/projects/actions';

export function RollbackButton({
  projectId,
  deploymentId,
  canRollback = true,
}: {
  projectId: string;
  deploymentId: string;
  canRollback?: boolean;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRollback() {
    const ok = await confirm({
      title: 'Rollback về bản deploy này?',
      message: 'App sẽ chạy lại đúng phiên bản của bản deploy này.',
      confirmText: 'Rollback',
    });
    if (!ok) return;
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

  if (!canRollback) {
    return (
      <span
        title="Cần quyền ADMIN để rollback"
        className="cursor-not-allowed px-2 py-1 text-xs text-white/20"
      >
        Rollback về bản này
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {dialog}
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
