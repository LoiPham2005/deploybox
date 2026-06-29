'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPlanAction } from './actions';

export function PlanToggle({
  teamId,
  currentPlan,
}: {
  teamId: string;
  currentPlan: 'FREE' | 'PRO';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const newPlan = currentPlan === 'PRO' ? 'FREE' : 'PRO';

  function toggle() {
    setErr(null);
    startTransition(async () => {
      const res = await setPlanAction(teamId, newPlan);
      if (res.ok) router.refresh();
      else setErr(res.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-xs text-red-400">{err}</span>}
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
          currentPlan === 'PRO'
            ? 'bg-white/10 text-white/60 hover:bg-white/20'
            : 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30'
        }`}
      >
        {pending ? 'Đang đổi…' : currentPlan === 'PRO' ? 'Hạ về FREE' : 'Nâng lên PRO'}
      </button>
    </div>
  );
}
