'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleFeatureAction } from './actions';

export type Feature = {
  key: string;
  enabled: boolean;
  label: string;
  description: string | null;
};

export function FeatureFlagsPanel({ features }: { features: Feature[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function toggle(f: Feature) {
    setErr(null);
    setBusyKey(f.key);
    startTransition(async () => {
      const res = await toggleFeatureAction(f.key, !f.enabled);
      setBusyKey(null);
      if (res.ok) router.refresh();
      else setErr(res.error);
    });
  }

  if (!features.length) {
    return <p className="text-xs text-white/40">Chưa có tính năng nào để cấu hình.</p>;
  }

  return (
    <div className="space-y-3">
      {err && <p className="text-xs text-red-400">{err}</p>}
      {features.map((f) => (
        <div key={f.key} className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-white/80">{f.label}</p>
            {f.description && <p className="text-xs text-white/40">{f.description}</p>}
          </div>
          {/* Toggle switch */}
          <button
            type="button"
            role="switch"
            aria-checked={f.enabled}
            disabled={pending && busyKey === f.key}
            onClick={() => toggle(f)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${
              f.enabled ? 'bg-emerald-500' : 'bg-white/15'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                f.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      ))}
    </div>
  );
}
