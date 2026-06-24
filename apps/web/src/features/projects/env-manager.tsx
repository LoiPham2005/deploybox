'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { EnvTarget, EnvVarDto } from '@deploybox/shared';
import { deleteEnvAction, upsertEnvAction } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export function EnvManager({
  projectId,
  vars,
}: {
  projectId: string;
  vars: EnvVarDto[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const key = (data.get('key') as string)?.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    const res = await upsertEnvAction(projectId, [
      {
        key,
        value: (data.get('value') as string) ?? '',
        isSecret: data.get('isSecret') === 'on',
        target: (data.get('target') as EnvTarget) ?? 'RUNTIME',
      },
    ]);
    setBusy(false);
    if (res.ok) {
      form.reset();
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  async function onDelete(key: string) {
    setBusy(true);
    await deleteEnvAction(projectId, key);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {vars.length === 0 ? (
        <p className="text-sm text-white/40">Chưa có biến môi trường.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {vars.map((v) => (
            <li
              key={v.key}
              className="flex items-center justify-between gap-2 rounded bg-white/[0.02] px-2 py-1.5"
            >
              <span className="font-mono text-white/80">{v.key}</span>
              <span className="flex items-center gap-2 text-xs text-white/40">
                <span>
                  {v.isSecret ? '••••• (secret)' : v.value || '(rỗng)'}
                </span>
                <span className="rounded bg-white/10 px-1.5">{v.target}</span>
                <button
                  type="button"
                  onClick={() => onDelete(v.key)}
                  disabled={busy}
                  className="text-red-400 hover:underline"
                >
                  xóa
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onAdd} className="flex flex-wrap items-center gap-2">
        <Input
          name="key"
          placeholder="KEY"
          className="w-40 font-mono"
          required
        />
        <Input
          name="value"
          placeholder="value"
          className="min-w-[8rem] flex-1"
        />
        <Select name="target" defaultValue="RUNTIME" className="w-28">
          <option value="RUNTIME">runtime</option>
          <option value="BUILD">build</option>
          <option value="BOTH">both</option>
        </Select>
        <label className="flex items-center gap-1 text-xs text-white/60">
          <input type="checkbox" name="isSecret" /> secret
        </label>
        <Button type="submit" disabled={busy}>
          Thêm
        </Button>
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
