'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ManagedDatabaseDto } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createDatabaseAction, deleteDatabaseAction } from './database-actions';

export function DatabasePanel({
  projectId,
  initial,
}: {
  projectId: string;
  initial: ManagedDatabaseDto[];
}) {
  const router = useRouter();
  const [dbs, setDbs] = useState<ManagedDatabaseDto[]>(initial);
  const [engine, setEngine] = useState<'POSTGRES' | 'REDIS'>('POSTGRES');
  const [name, setName] = useState('');
  const [envKey, setEnvKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  // connection string vừa tạo (chỉ hiện 1 lần)
  const [justCreated, setJustCreated] = useState<ManagedDatabaseDto | null>(null);

  function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setJustCreated(null);
    start(async () => {
      const res = await createDatabaseAction(projectId, {
        engine,
        name,
        envKey: envKey.trim() || undefined,
      });
      if (res.ok && res.data) {
        setDbs((d) => [...d, res.data!]);
        setJustCreated(res.data);
        setName('');
        setEnvKey('');
      } else if (!res.ok) setErr(res.error);
    });
  }

  function del(db: ManagedDatabaseDto) {
    if (!confirm(`Xoá database "${db.name}"? Container + dữ liệu sẽ mất.`)) return;
    setBusy(db.id);
    start(async () => {
      const res = await deleteDatabaseAction(projectId, db.id);
      setBusy(null);
      if (res.ok) {
        setDbs((d) => d.filter((x) => x.id !== db.id));
        router.refresh();
      } else setErr(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-white/40">
        Tạo Postgres/Redis bằng 1 nút — connection string tự bơm vào biến env của project. Nhớ{' '}
        <b>Deploy lại</b> để app nhận env mới.
      </p>

      {/* connection string vừa tạo */}
      {justCreated?.connectionString && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="text-xs text-emerald-300">
            ✓ Đã tạo. Đã bơm vào env{' '}
            <code className="rounded bg-black/30 px-1">{justCreated.envKey}</code>. Connection
            string (lưu lại nếu cần — chỉ hiện lần này):
          </p>
          <pre className="mt-1 overflow-x-auto rounded bg-black/40 p-2 text-[11px] text-white/80">
            {justCreated.connectionString}
          </pre>
        </div>
      )}

      {/* danh sách */}
      {dbs.length > 0 && (
        <div className="space-y-2">
          {dbs.map((db) => (
            <div
              key={db.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium text-white/85">{db.name}</span>
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${
                    db.engine === 'POSTGRES'
                      ? 'bg-sky-500/15 text-sky-300'
                      : 'bg-red-500/15 text-red-300'
                  }`}
                >
                  {db.engine}
                </span>
                <span className="ml-2 text-[11px] text-white/40">
                  env <code className="text-white/60">{db.envKey}</code> · cổng {db.hostPort}
                </span>
              </div>
              <button
                type="button"
                onClick={() => del(db)}
                disabled={pending && busy === db.id}
                className="shrink-0 text-xs text-red-400 hover:underline disabled:opacity-40"
              >
                {busy === db.id ? '…' : 'Xoá'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* tạo mới */}
      <form onSubmit={add} className="space-y-2 rounded-lg border border-white/[0.06] p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <Label htmlFor="dbEngine">Loại</Label>
            <select
              id="dbEngine"
              value={engine}
              onChange={(e) => setEngine(e.target.value as 'POSTGRES' | 'REDIS')}
              className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white/85 outline-none focus:border-sky-400/50"
            >
              <option value="POSTGRES">PostgreSQL 16</option>
              <option value="REDIS">Redis 7</option>
            </select>
          </div>
          <div>
            <Label htmlFor="dbName">Tên</Label>
            <Input
              id="dbName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="db chính"
              required
            />
          </div>
          <div>
            <Label htmlFor="dbEnvKey">Biến env (tuỳ chọn)</Label>
            <Input
              id="dbEnvKey"
              value={envKey}
              onChange={(e) => setEnvKey(e.target.value.toUpperCase())}
              placeholder={engine === 'POSTGRES' ? 'DATABASE_URL' : 'REDIS_URL'}
            />
          </div>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <Button type="submit" disabled={pending || !name}>
          {pending ? 'Đang tạo…' : 'Tạo database'}
        </Button>
      </form>
    </div>
  );
}
