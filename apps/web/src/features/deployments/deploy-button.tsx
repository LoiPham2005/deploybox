'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { deployProjectAction } from '@/features/projects/actions';

export function DeployButton({
  projectId,
  disabled,
  hint,
}: {
  projectId: string;
  disabled?: boolean;
  hint?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDeploy() {
    setLoading(true);
    setError(null);
    const res = await deployProjectAction(projectId);
    if (res.ok && res.data) {
      router.push(`/projects/${projectId}/deployments/${res.data.id}`);
      router.refresh();
    } else {
      setError(res.ok ? 'Deploy thất bại' : res.error);
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={onDeploy} disabled={disabled || loading} title={hint}>
        {loading ? 'Đang tạo…' : 'Deploy'}
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
