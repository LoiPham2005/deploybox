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

const AI_MASTER = 'ai_features';

function Toggle({
  on,
  disabled,
  onClick,
}: {
  on: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${
        on ? 'bg-emerald-500' : 'bg-white/15'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
          on ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

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

  const general = features.filter((f) => !f.key.startsWith('ai_'));
  const master = features.find((f) => f.key === AI_MASTER);
  const aiChildren = features.filter(
    (f) => f.key.startsWith('ai_') && f.key !== AI_MASTER,
  );
  const masterOn = master?.enabled ?? true;

  const row = (f: Feature, dimmed = false) => (
    <div
      key={f.key}
      className={`flex items-center justify-between gap-4 transition-opacity ${
        dimmed ? 'opacity-40' : ''
      }`}
    >
      <div>
        <p className="text-sm font-medium text-white/80">{f.label}</p>
        {f.description && <p className="text-xs text-white/40">{f.description}</p>}
      </div>
      <Toggle
        on={f.enabled}
        disabled={pending && busyKey === f.key}
        onClick={() => toggle(f)}
      />
    </div>
  );

  return (
    <div className="space-y-3">
      {err && <p className="text-xs text-red-400">{err}</p>}

      {general.map((f) => row(f))}

      {master && (
        <div className="mt-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
          {/* Nút tổng AI */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-sky-300">{master.label}</p>
              {master.description && (
                <p className="text-xs text-white/40">{master.description}</p>
              )}
            </div>
            <Toggle
              on={master.enabled}
              disabled={pending && busyKey === master.key}
              onClick={() => toggle(master)}
            />
          </div>

          {/* Các nút AI con — mờ đi khi tắt nút tổng (trạng thái vẫn giữ) */}
          {aiChildren.length > 0 && (
            <div className="mt-3 space-y-3 border-l border-white/10 pl-3">
              {!masterOn && (
                <p className="text-[11px] text-amber-300/80">
                  Nút tổng đang TẮT — mọi tính năng AI bên dưới đều không chạy (trạng
                  thái từng nút vẫn được giữ).
                </p>
              )}
              {aiChildren.map((f) => row(f, !masterOn))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
