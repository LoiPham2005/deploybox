'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { deleteProjectAction } from './actions';

export function DeleteProjectButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function onDelete() {
    const ok = await confirm({
      title: 'Xóa project này?',
      message: 'Toàn bộ deployment, domain, env của project sẽ bị xóa. Không thể hoàn tác.',
      confirmText: 'Xóa project',
      danger: true,
    });
    if (!ok) return;
    setLoading(true);
    setError(null);
    const res = await deleteProjectAction(projectId);
    if (res.ok) {
      router.push('/dashboard');
      router.refresh();
    } else {
      setError(res.error);
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      {dialog}
      <Button
        type="button"
        onClick={onDelete}
        disabled={loading}
        className="bg-red-600 hover:bg-red-500"
      >
        {loading ? 'Đang xóa…' : 'Xóa project'}
      </Button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
