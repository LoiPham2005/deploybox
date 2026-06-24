'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { AddDomainResponse, ProjectDomainDto } from '@deploybox/shared';
import {
  addDomainAction,
  deleteDomainAction,
  verifyDomainAction,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function DomainManager({
  projectId,
  domains,
}: {
  projectId: string;
  domains: ProjectDomainDto[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<AddDomainResponse | null>(
    null,
  );

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const hostname = (new FormData(form).get('hostname') as string)?.trim();
    if (!hostname) return;
    setBusy(true);
    setError(null);
    const res = await addDomainAction(projectId, hostname);
    setBusy(false);
    if (res.ok && res.data) {
      setInstructions(res.data);
      form.reset();
      router.refresh();
    } else if (!res.ok) {
      setError(res.error);
    }
  }

  async function onVerify(id: string) {
    setBusy(true);
    await verifyDomainAction(projectId, id);
    setBusy(false);
    router.refresh();
  }

  async function onDelete(id: string) {
    setBusy(true);
    await deleteDomainAction(projectId, id);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1 text-sm">
        {domains.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-2 rounded bg-white/[0.02] px-2 py-1.5"
          >
            <span>
              {d.hostname}
              {d.isPrimary && (
                <span className="ml-2 text-xs text-white/40">(chính)</span>
              )}
            </span>
            <span className="flex items-center gap-2 text-xs text-white/40">
              <span>{d.status}</span>
              {!d.isPrimary && (
                <>
                  <button
                    type="button"
                    onClick={() => onVerify(d.id)}
                    disabled={busy}
                    className="text-indigo-400 hover:underline"
                  >
                    verify
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(d.id)}
                    disabled={busy}
                    className="text-red-400 hover:underline"
                  >
                    xóa
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      <form onSubmit={onAdd} className="flex gap-2">
        <Input
          name="hostname"
          placeholder="vd: monan.localhost hoặc example.com"
          className="flex-1"
        />
        <Button type="submit" disabled={busy}>
          Thêm domain
        </Button>
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {instructions && (
        <div className="space-y-1 rounded border border-white/10 bg-white/[0.02] p-3 text-xs text-white/60">
          <p className="font-medium text-white/80">Trỏ DNS rồi bấm “verify”:</p>
          <p>
            • {instructions.dnsInstructions.type}{' '}
            <code className="text-white/80">
              {instructions.dnsInstructions.name}
            </code>{' '}
            → <code className="text-white/80">
              {instructions.dnsInstructions.value}
            </code>
          </p>
          {instructions.verification && (
            <p>
              • TXT{' '}
              <code className="text-white/80">
                {instructions.verification.name}
              </code>{' '}
              → <code className="text-white/80">
                {instructions.verification.value}
              </code>
            </p>
          )}
          <p className="text-white/40">
            Local: dùng <code>*.localhost</code> (Chrome tự trỏ về máy) — mở ngay
            tại <code>http://&lt;host&gt;:8080/</code>.
          </p>
        </div>
      )}
    </div>
  );
}
