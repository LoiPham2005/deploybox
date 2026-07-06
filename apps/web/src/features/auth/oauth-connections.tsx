'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { OAuthIdentityDto, OAuthProviderStatusDto } from '@deploybox/shared';
import { unlinkOauthAction } from './account-actions';

const LABELS: Record<string, { name: string; emoji: string }> = {
  github: { name: 'GitHub', emoji: '🐙' },
  gitlab: { name: 'GitLab', emoji: '🦊' },
  bitbucket: { name: 'Bitbucket', emoji: '🪣' },
};

export function OauthConnections({
  identities,
  providers,
}: {
  identities: OAuthIdentityDto[];
  providers: OAuthProviderStatusDto[];
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const connected = q.get('connected');
    if (connected) setMsg(`✓ Đã kết nối ${LABELS[connected]?.name ?? connected}`);
    const e = q.get('oauth_error');
    if (e) setErr(e);
  }, []);

  function unlink(provider: string) {
    if (!confirm(`Gỡ liên kết ${LABELS[provider]?.name ?? provider}?`)) return;
    setErr(null); setMsg(null);
    start(async () => {
      const res = await unlinkOauthAction(provider);
      if (res.ok) { setMsg('Đã gỡ liên kết'); router.refresh(); }
      else setErr(res.error);
    });
  }

  // Chỉ hiện các nhà server ĐÃ cấu hình (không dụ bấm vào nhà chưa sẵn sàng)
  const available = providers.filter((p) => p.configured && p.enabled);
  if (available.length === 0 && identities.length === 0) {
    return (
      <p className="text-xs text-white/30">
        Server chưa cấu hình OAuth (GITHUB_OAUTH_CLIENT_ID/SECRET trong .env) — xem docs.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {available.map((p) => {
        const id = identities.find((i) => i.provider === p.provider);
        const label = LABELS[p.provider] ?? { name: p.provider, emoji: '🔗' };
        return (
          <div
            key={p.provider}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm"
          >
            <div className="min-w-0">
              <span className="font-medium text-white/85">
                {label.emoji} {label.name}
              </span>
              {id ? (
                <span className="ml-2 text-[11px] text-emerald-300">
                  @{id.login} · nối {new Date(id.connectedAt).toLocaleDateString('vi-VN')}
                </span>
              ) : (
                <span className="ml-2 text-[11px] text-white/40">chưa kết nối</span>
              )}
            </div>
            {id ? (
              <button
                type="button"
                onClick={() => unlink(p.provider)}
                disabled={pending}
                className="shrink-0 text-xs text-red-400 hover:underline disabled:opacity-40"
              >
                Gỡ liên kết
              </button>
            ) : (
              <a
                href={`/api/oauth/connect/${p.provider}`}
                className="shrink-0 text-xs text-indigo-400 hover:underline"
              >
                Kết nối
              </a>
            )}
          </div>
        );
      })}
      <p className="text-xs text-white/40">
        Kết nối để đăng nhập 1 chạm + chọn repo từ danh sách khi tạo project (tự gắn webhook).
      </p>
      {msg && <p className="text-xs text-emerald-400">{msg}</p>}
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
