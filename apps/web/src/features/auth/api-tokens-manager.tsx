'use client';

import { useState } from 'react';
import type { ApiTokenDto } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/api/v1';

async function apiCall(path: string, method: string, body?: unknown) {
  const token = document.cookie
    .split('; ')
    .find((r) => r.startsWith('db_token='))
    ?.split('=')[1];
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(e.message ?? `Lỗi ${res.status}`);
  }
  return res.json();
}

export function ApiTokensManager({ initialTokens }: { initialTokens: ApiTokenDto[] }) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    setErr(null);
    setNewToken(null);
    try {
      const res = await apiCall('/auth/tokens', 'POST', { name: name.trim() }) as ApiTokenDto & { token: string };
      setTokens((prev) => [res, ...prev]);
      setNewToken(res.token);
      setName('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm('Thu hồi token này? Không thể hoàn tác.')) return;
    try {
      await apiCall(`/auth/tokens/${id}`, 'DELETE');
      setTokens((prev) => prev.filter((t) => t.id !== id));
      if (newToken) setNewToken(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lỗi');
    }
  }

  return (
    <div className="space-y-4">
      {newToken && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
          <p className="mb-1 text-xs font-medium text-emerald-400">
            Token được tạo — chỉ hiển thị một lần, hãy sao chép ngay:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-black/40 px-2 py-1 text-xs text-emerald-300">
              {newToken}
            </code>
            <Button
              variant="ghost"
              onClick={() => { void navigator.clipboard.writeText(newToken); }}
              className="shrink-0 text-xs"
            >
              Sao chép
            </Button>
          </div>
          <p className="mt-1 text-xs text-white/40">
            Dùng: <code>Authorization: Bearer {newToken.slice(0, 20)}…</code>
          </p>
        </div>
      )}

      {tokens.length === 0 ? (
        <p className="text-sm text-white/40">Chưa có token nào.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-white/40">
                  Tạo {new Date(t.createdAt).toLocaleDateString('vi-VN')}
                  {t.lastUsedAt && ` · Dùng lần cuối ${new Date(t.lastUsedAt).toLocaleDateString('vi-VN')}`}
                </p>
              </div>
              <Button variant="ghost" onClick={() => revoke(t.id)} className="text-red-400 hover:text-red-300 text-xs">
                Thu hồi
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-white/10 pt-4">
        <p className="mb-2 text-xs text-white/50">Tạo token mới</p>
        <div className="flex gap-2">
          <Input
            placeholder="Tên token (vd: github-actions)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            className="flex-1"
          />
          <Button onClick={create} disabled={creating || !name.trim()}>
            {creating ? 'Đang tạo…' : 'Tạo token'}
          </Button>
        </div>
        {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
      </div>
    </div>
  );
}
