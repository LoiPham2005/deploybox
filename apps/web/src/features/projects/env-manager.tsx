'use client';

import { useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileText, X } from 'lucide-react';
import type { EnvTarget, EnvVarDto } from '@deploybox/shared';
import { deleteEnvAction, upsertEnvAction } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
const SECRET_RE = /SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_?KEY|_KEY$|DATABASE_URL|DSN/i;

type ParsedVar = { key: string; value: string; isSecret: boolean; valid: boolean };

/** Parse nội dung file .env → danh sách biến */
function parseEnv(text: string): ParsedVar[] {
  const out: ParsedVar[] = [];
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Bỏ ngoặc kép/đơn bao quanh value
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    out.push({
      key,
      value,
      isSecret: SECRET_RE.test(key),
      valid: KEY_RE.test(key),
    });
  }
  return out;
}

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

  // Bulk import state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkTarget, setBulkTarget] = useState<EnvTarget>('RUNTIME');
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);

  const parsed = useMemo(() => parseEnv(bulkText), [bulkText]);
  const validVars = parsed.filter((p) => p.valid);
  const invalidVars = parsed.filter((p) => !p.valid);

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

  async function readFiles(files: FileList | File[]) {
    const texts: string[] = [];
    for (const f of Array.from(files)) {
      texts.push(await f.text());
    }
    setBulkText((prev) => [prev, ...texts].filter(Boolean).join('\n'));
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) readFiles(e.dataTransfer.files);
  }

  async function onImport() {
    if (validVars.length === 0) return;
    setImporting(true);
    setError(null);
    const res = await upsertEnvAction(
      projectId,
      validVars.map((v) => ({
        key: v.key,
        value: v.value,
        isSecret: v.isSecret,
        target: bulkTarget,
      })),
    );
    setImporting(false);
    if (res.ok) {
      setBulkText('');
      setBulkOpen(false);
      router.refresh();
    } else {
      setError(res.error);
    }
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
                <span>{v.isSecret ? '••••• (secret)' : v.value || '(rỗng)'}</span>
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

      {/* Thêm 1 biến thủ công */}
      <form onSubmit={onAdd} className="flex flex-wrap items-center gap-2">
        <Input name="key" placeholder="KEY" className="w-40 font-mono" required />
        <Input name="value" placeholder="value" className="min-w-[8rem] flex-1" />
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

      {/* Toggle import hàng loạt */}
      {!bulkOpen ? (
        <button
          type="button"
          onClick={() => setBulkOpen(true)}
          className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300"
        >
          <Upload size={13} /> Import nhiều biến từ file .env (kéo-thả hoặc dán)
        </button>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-white/70">
              <FileText size={13} /> Import từ .env
            </p>
            <button
              type="button"
              onClick={() => { setBulkOpen(false); setBulkText(''); }}
              className="text-white/30 hover:text-white/60"
            >
              <X size={15} />
            </button>
          </div>

          {/* Drop zone + textarea */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`relative rounded-lg border border-dashed transition ${
              dragOver ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/15 bg-black/20'
            }`}
          >
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={6}
              placeholder={'Kéo-thả file .env vào đây, hoặc dán nội dung:\n\nDATABASE_URL=postgres://...\nAPI_KEY=ghp_xxxx\nNEXT_PUBLIC_URL=https://app.com'}
              className="w-full resize-y bg-transparent px-3 py-2 font-mono text-xs text-white placeholder-white/25 focus:outline-none"
            />
            {dragOver && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-indigo-500/10 text-sm font-medium text-indigo-300">
                Thả file .env để nạp
              </div>
            )}
          </div>

          {/* Nút chọn file thủ công */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-white/60 hover:border-white/30 hover:text-white">
              Chọn file…
              <input
                type="file"
                accept=".env,.txt,text/plain"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files?.length) readFiles(e.target.files); e.target.value = ''; }}
              />
            </label>
            <span className="text-xs text-white/30">Áp dụng cho:</span>
            <Select
              value={bulkTarget}
              onChange={(e) => setBulkTarget(e.target.value as EnvTarget)}
              className="w-24"
            >
              <option value="RUNTIME">runtime</option>
              <option value="BUILD">build</option>
              <option value="BOTH">both</option>
            </Select>
          </div>

          {/* Preview */}
          {parsed.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-white/40">
                <span className="text-emerald-400">{validVars.length} biến hợp lệ</span>
                {invalidVars.length > 0 && (
                  <span className="ml-2 text-amber-400">
                    · {invalidVars.length} bị bỏ qua (tên không hợp lệ)
                  </span>
                )}
              </p>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                {parsed.map((p, i) => (
                  <li
                    key={`${p.key}-${i}`}
                    className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                      p.valid ? 'bg-white/[0.03]' : 'bg-amber-500/5'
                    }`}
                  >
                    <span className={`font-mono ${p.valid ? 'text-white/80' : 'text-amber-400/70 line-through'}`}>
                      {p.key}
                    </span>
                    {p.isSecret && p.valid && (
                      <span className="rounded bg-violet-500/15 px-1 text-[10px] text-violet-300">secret</span>
                    )}
                    <span className="ml-auto max-w-[40%] truncate text-white/30">
                      {p.isSecret ? '•••••' : p.value || '(rỗng)'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button type="button" onClick={onImport} disabled={importing || validVars.length === 0}>
              {importing ? 'Đang import…' : `Import ${validVars.length} biến`}
            </Button>
            <button
              type="button"
              onClick={() => setBulkText('')}
              className="text-xs text-white/40 hover:text-white/70"
            >
              Xóa nội dung
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
