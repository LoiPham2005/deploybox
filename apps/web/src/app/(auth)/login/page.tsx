'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { OAuthProviderStatusDto } from '@deploybox/shared';
import { authApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/api/v1';

const QUICK_ACCOUNTS = [
  {
    label: '👑 Owner',
    desc: 'Team OWNER',
    email: 'owner@deploybox.local',
    cls: 'border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10',
  },
  {
    label: '👤 Member',
    desc: 'MEMBER + personal',
    email: 'member@deploybox.local',
    cls: 'border-white/15 text-white/60 hover:bg-white/5',
  },
  {
    label: '🛡️ Admin',
    desc: 'Platform admin',
    email: 'admin@deploybox.local',
    cls: 'border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10',
  },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // 2FA: đúng mật khẩu nhưng tài khoản bật 2FA → chuyển bước nhập OTP email
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState('');
  // OAuth: các nhà server đã cấu hình + flag bật (github/gitlab/bitbucket)
  const [oauthReady, setOauthReady] = useState<string[]>([]);

  useEffect(() => {
    // lỗi OAuth do API redirect về (?oauth_error=…)
    const err = new URLSearchParams(window.location.search).get('oauth_error');
    if (err) setError(err);
    fetch(`${API_BASE}/auth/oauth/providers`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: OAuthProviderStatusDto[]) => {
        if (Array.isArray(list)) {
          setOauthReady(list.filter((p) => p.configured && p.enabled).map((p) => p.provider));
        }
      })
      .catch(() => undefined);
  }, []);

  async function finishLogin(accessToken: string) {
    await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: accessToken }),
    });
    router.push('/dashboard');
    router.refresh();
  }

  async function doLogin(loginEmail: string, loginPassword: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.login({ email: loginEmail, password: loginPassword });
      if ('requires2fa' in res) {
        // Chưa có token — server đã gửi OTP về email
        setOtpStep(true);
        setOtp('');
        setLoading(false);
        return;
      }
      await finishLogin(res.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại');
      setLoading(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await doLogin(email, password);
  }

  async function onSubmitOtp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.verifyLoginOtp({ email, code: otp });
      await finishLogin(res.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xác thực thất bại');
      setLoading(false);
    }
  }

  async function onQuickLogin(quickEmail: string) {
    setEmail(quickEmail);
    setPassword('changeme');
    await doLogin(quickEmail, 'changeme');
  }

  // ── Bước 2 (2FA): nhập mã OTP đã gửi về email ──
  if (otpStep) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold">Xác thực 2 lớp</h1>
          <p className="mt-1 text-sm text-white/50">
            Đã gửi mã 6 số tới <b className="text-white/80">{email}</b> — nhập để hoàn tất đăng nhập.
          </p>
        </div>
        <form onSubmit={onSubmitOtp} className="space-y-4">
          <div>
            <Label htmlFor="otp">Mã OTP</Label>
            <Input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              autoFocus
              required
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" disabled={loading || otp.length !== 6} className="w-full">
            {loading ? 'Đang xác thực…' : 'Xác nhận'}
          </Button>
          <div className="flex justify-between text-sm">
            <button
              type="button"
              onClick={() => { setOtpStep(false); setError(null); }}
              className="text-white/50 hover:underline"
            >
              ← Quay lại
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => doLogin(email, password)}
              className="text-indigo-400 hover:underline disabled:opacity-40"
            >
              Gửi lại mã
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Đăng nhập DeployBox</h1>
        <p className="mt-1 text-sm text-white/50">Dùng tài khoản nội bộ của bạn</p>
      </div>

      {/* OAuth: chỉ hiện nhà server đã cấu hình + flag bật */}
      {oauthReady.length > 0 && (
        <>
          <div className="space-y-2">
            {oauthReady.includes('github') && (
              <a
                href={`${API_BASE}/auth/oauth/github/start`}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white/85 transition hover:bg-white/[0.08]"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                </svg>
                Đăng nhập với GitHub
              </a>
            )}
            {oauthReady.includes('gitlab') && (
              <a
                href={`${API_BASE}/auth/oauth/gitlab/start`}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white/85 transition hover:bg-white/[0.08]"
              >
                🦊 Đăng nhập với GitLab
              </a>
            )}
            {oauthReady.includes('bitbucket') && (
              <a
                href={`${API_BASE}/auth/oauth/bitbucket/start`}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white/85 transition hover:bg-white/[0.08]"
              >
                🪣 Đăng nhập với Bitbucket
              </a>
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-widest text-white/25">
            <span className="h-px flex-1 bg-white/10" /> hoặc <span className="h-px flex-1 bg-white/10" />
          </div>
        </>
      )}


      {/* Đăng nhập nhanh (dev) — ĐANG TẮT. Muốn bật lại: đổi false thành true. */}
      {false && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-white/25">
            Đăng nhập nhanh (dev)
          </p>
          <div className="flex gap-2">
            {QUICK_ACCOUNTS.map((a) => (
              <button
                key={a.label}
                type="button"
                disabled={loading}
                onClick={() => onQuickLogin(a.email)}
                className={`flex flex-1 flex-col items-center rounded-lg border px-2 py-2 text-center transition disabled:opacity-40 ${a.cls}`}
              >
                <span className="text-xs font-semibold">{a.label}</span>
                <span className="mt-0.5 text-[10px] opacity-60">{a.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Mật khẩu</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-indigo-400 hover:underline"
            >
              Quên mật khẩu?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </Button>
        <p className="text-center text-sm text-white/50">
          Chưa có tài khoản?{' '}
          <Link href="/register" className="text-indigo-400 hover:underline">
            Đăng ký
          </Link>
        </p>
      </form>
    </div>
  );
}
