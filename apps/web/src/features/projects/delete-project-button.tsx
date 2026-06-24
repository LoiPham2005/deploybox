'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { deleteProjectAction } from './actions';

export function DeleteProjectButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (!confirm('Xóa project này? Hành động không thể hoàn tác.')) return;
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
