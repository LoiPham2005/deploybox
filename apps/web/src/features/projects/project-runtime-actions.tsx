'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  redeployProjectAction,
  sleepProjectAction,
  stopProjectAction,
  wakeProjectAction,
} from './actions';
import { Button } from '@/components/ui/button';

type RunResult = {
  ok: boolean;
  error?: string;
  data?: { id: string };
};

export function ProjectRuntimeActions({
  projectId,
  canDeploy,
  canSleep,
  sleeping = false,
}: {
  projectId: string;
  canDeploy: boolean;
  canSleep: boolean;
  /** App đang SLEEPING → nút "Ngủ" đổi thành "Đánh thức". */
  sleeping?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(name: string, fn: () => Promise<RunResult>) {
    setBusy(name);
    setError(null);
    const res = await fn();
    setBusy(null);
    if (res.ok) {
      if (res.data) {
        router.push(`/projects/${projectId}/deployments/${res.data.id}`);
      }
      router.refresh();
    } else if (res.error) {
      setError(res.error);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-400">{error}</span>}
      <Button
        variant="ghost"
        onClick={() => run('redeploy', () => redeployProjectAction(projectId))}
        disabled={!canDeploy || busy !== null}
        className="px-2 py-1 text-xs"
      >
        {busy === 'redeploy' ? '…' : 'Redeploy'}
      </Button>
      {sleeping ? (
        <Button
          variant="ghost"
          onClick={() => run('wake', () => wakeProjectAction(projectId))}
          disabled={busy !== null}
          className="px-2 py-1 text-xs text-emerald-300"
        >
          {busy === 'wake' ? 'Đang đánh thức…' : '⏰ Đánh thức'}
        </Button>
      ) : (
        canSleep && (
          <Button
            variant="ghost"
            onClick={() => run('sleep', () => sleepProjectAction(projectId))}
            disabled={busy !== null}
            className="px-2 py-1 text-xs"
          >
            {busy === 'sleep' ? '…' : 'Ngủ'}
          </Button>
        )
      )}
      <Button
        variant="ghost"
        onClick={() => run('stop', () => stopProjectAction(projectId))}
        disabled={busy !== null}
        className="px-2 py-1 text-xs"
      >
        {busy === 'stop' ? '…' : 'Stop'}
      </Button>
    </div>
  );
}
