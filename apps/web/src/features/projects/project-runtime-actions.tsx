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
  status,
}: {
  projectId: string;
  canDeploy: boolean;
  canSleep: boolean;
  /** Trạng thái bản deploy mới nhất — quyết định hiện nút gì. */
  status?: string;
}) {
  const sleeping = status === 'SLEEPING';
  // Đã dừng/thất bại/huỷ → app không chạy → nút chính là "Chạy lại"
  const stopped = status === 'STOPPED' || status === 'FAILED' || status === 'CANCELLED';
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

  // App đã dừng → chỉ cần 1 nút "Chạy lại" nổi bật (Redeploy = build lại + chạy)
  if (stopped) {
    return (
      <div className="flex items-center gap-2">
        {error && <span className="text-xs text-red-400">{error}</span>}
        <Button
          onClick={() => run('redeploy', () => redeployProjectAction(projectId))}
          disabled={!canDeploy || busy !== null}
          className="px-3 py-1 text-xs text-emerald-300"
        >
          {busy === 'redeploy' ? 'Đang chạy lại…' : '▶ Chạy lại'}
        </Button>
      </div>
    );
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
