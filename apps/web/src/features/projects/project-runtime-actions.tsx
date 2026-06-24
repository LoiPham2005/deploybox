'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { redeployProjectAction, stopProjectAction } from './actions';
import { Button } from '@/components/ui/button';

export function ProjectRuntimeActions({
  projectId,
  canDeploy,
}: {
  projectId: string;
  canDeploy: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onRedeploy() {
    setBusy('redeploy');
    setError(null);
    const res = await redeployProjectAction(projectId);
    setBusy(null);
    if (res.ok && res.data) {
      router.push(`/projects/${projectId}/deployments/${res.data.id}`);
      router.refresh();
    } else if (!res.ok) {
      setError(res.error);
    }
  }

  async function onStop() {
    setBusy('stop');
    setError(null);
    const res = await stopProjectAction(projectId);
    setBusy(null);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-400">{error}</span>}
      <Button
        variant="ghost"
        onClick={onRedeploy}
        disabled={!canDeploy || busy !== null}
        className="px-2 py-1 text-xs"
      >
        {busy === 'redeploy' ? '…' : 'Redeploy'}
      </Button>
      <Button
        variant="ghost"
        onClick={onStop}
        disabled={busy !== null}
        className="px-2 py-1 text-xs"
      >
        {busy === 'stop' ? '…' : 'Stop'}
      </Button>
    </div>
  );
}
