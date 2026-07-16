'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TurnstileWidget } from '@/components/turnstile-widget';

const API_BASE_CAPTCHA =
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/api/v1';

/**
 * Đăng ký 2 bước: (1) nhập thông tin → gửi OTP về email; (2) nhập OTP → tạo tài khoản.
 * Server chưa cấu hình SMTP → tự fallback đăng ký thẳng (không OTP).
 */
const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/api/v1';

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<'info' | 'otp'>('info');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signupCode, setSignupCode] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  // Đăng ký qua OAuth (GitHub/GitLab/Bitbucket) đang chờ mã mời — API redirect về ?oauth_pending=
  const [oauthPending, setOauthPending] = useState<{
    id: string; login: string; email: string; provider: string;
  } | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const pid = q.get('oauth_pending');
    if (pid) {
      setOauthPending({
        id: pid,
        login: q.get('login') ?? '',
        email: q.get('email') ?? '',
        provider: q.get('provider') ?? 'github',
      });
    }
  }, []);

  // Đếm ngược nút "Gửi lại mã"
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Turnstile (check người/robot) — admin bật ở Tính năng + có key
  const [captcha, setCaptcha] = useState<{ enabled: boolean; siteKey: string }>({ enabled: false, siteKey: '' });
  const [captchaToken, setCaptchaToken] = useState('');
  useEffect(() => {
    fetch(`${API_BASE_CAPTCHA}/auth/captcha`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { enabled: boolean; siteKey: string } | null) => {
        if (c?.enabled) setCaptcha(c);
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

  const registerDto = () => ({
    name: name || undefined,
    email,
    password,
    signupCode: signupCode || undefined,
    captchaToken: captchaToken || undefined,
  });

  /** Hoàn tất đăng ký OAuth: chỉ cần mã mời (danh tính đã do GitHub xác thực). */
  async function onCompleteOauth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!oauthPending) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/oauth/complete-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingId: oauthPending.id, signupCode }),
      });
      const body = (await res.json().catch(() => ({}))) as { accessToken?: string; message?: string };
      if (!res.ok || !body.accessToken) {
        // "Mã mời không đúng|<retryId>" → giữ pendingId mới để gõ lại, khỏi OAuth lại
        const [msg, retryId] = (body.message ?? 'Đăng ký thất bại').split('|');
        if (retryId) setOauthPending({ ...oauthPending, id: retryId });
        setError(msg);
        setLoading(false);
        return;
      }
      await finishLogin(body.accessToken);
    } catch {
      setError('Không gọi được API');
      setLoading(false);
    }
  }

  /** B1: gửi OTP (fallback đăng ký thẳng nếu server chưa có SMTP). */
  async function onRequestOtp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.requestRegisterOtp(registerDto());
      setStep('otp');
      setCode('');
      setCooldown(60);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gửi mã thất bại';
      // Server không bật email → đăng ký thẳng như cũ
      if (msg.includes('chưa cấu hình email')) {
        try {
          const { accessToken } = await authApi.register(registerDto());
          await finishLogin(accessToken);
          return;
        } catch (e2) {
          setError(e2 instanceof Error ? e2.message : 'Đăng ký thất bại');
        }
      } else {
        setError(msg);
      }
    }
    setLoading(false);
  }

  /** B2: xác thực OTP → tạo tài khoản + vào dashboard. */
  async function onVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await authApi.verifyRegister({ email, code: code.trim() });
      await finishLogin(accessToken);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xác thực thất bại');
    }
    setLoading(false);
  }

  async function onResend() {
    if (cooldown > 0) return;
    setError(null);
    try {
      await authApi.requestRegisterOtp(registerDto());
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gửi lại mã thất bại');
    }
  }

  // ── Hoàn tất đăng ký qua GitHub: chỉ hỏi mã mời ──
  if (oauthPending) {
    return (
      <form onSubmit={onCompleteOauth} className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Gần xong! 🎉</h1>
          <p className="mt-1 text-sm text-white/50">
            Tài khoản {({ github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket' } as Record<string, string>)[oauthPending.provider] ?? oauthPending.provider}{' '}
            <b className="text-white/80">@{oauthPending.login}</b>
            {oauthPending.email && <> ({oauthPending.email})</>} đã xác thực. Instance này yêu cầu{' '}
            <b>mã mời</b> để tạo tài khoản mới.
          </p>
        </div>
        <div>
          <Label htmlFor="oauthSignupCode">Mã mời</Label>
          <Input
            id="oauthSignupCode"
            value={signupCode}
            onChange={(e) => setSignupCode(e.target.value)}
            placeholder="Liên hệ admin để được cấp"
            autoFocus
            required
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={loading || !signupCode} className="w-full">
          {loading ? 'Đang tạo tài khoản…' : 'Hoàn tất đăng ký'}
        </Button>
        <p className="text-center text-sm text-white/50">
          <Link href="/login" className="text-indigo-400 hover:underline">← Quay lại đăng nhập</Link>
        </p>
      </form>
    );
  }

  if (step === 'otp') {
    return (
      <form onSubmit={onVerify} className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Nhập mã xác thực</h1>
          <p className="mt-1 text-sm text-white/50">
            Mã 6 số đã gửi tới <span className="text-white/80">{email}</span> (kiểm tra cả
            mục Spam). Mã có hiệu lực 10 phút.
          </p>
        </div>
        <div>
          <Label htmlFor="otp">Mã OTP</Label>
          <Input
            id="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="••••••"
            className="text-center text-xl tracking-[0.5em]"
            autoFocus
            required
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={loading || code.length !== 6} className="w-full">
          {loading ? 'Đang xác thực…' : 'Xác nhận & tạo tài khoản'}
        </Button>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => { setStep('info'); setError(null); }}
            className="text-white/50 hover:underline"
          >
            ← Sửa thông tin
          </button>
          <button
            type="button"
            onClick={onResend}
            disabled={cooldown > 0}
            className="text-indigo-400 hover:underline disabled:cursor-not-allowed disabled:text-white/30 disabled:no-underline"
          >
            {cooldown > 0 ? `Gửi lại mã (${cooldown}s)` : 'Gửi lại mã'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onRequestOtp} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Tạo tài khoản</h1>
        <p className="mt-1 text-sm text-white/50">
          Bạn sẽ nhận mã xác thực qua email để hoàn tất đăng ký
        </p>
      </div>
      <div>
        <Label htmlFor="name">Tên (tùy chọn)</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
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
        <Label htmlFor="password">Mật khẩu (≥ 8 ký tự)</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
      </div>
      <div>
        <Label htmlFor="signupCode">Mã mời (nếu được cấp)</Label>
        <Input
          id="signupCode"
          value={signupCode}
          onChange={(e) => setSignupCode(e.target.value)}
          placeholder="Để trống nếu instance không yêu cầu"
        />
      </div>
      {captcha.enabled && (
        <TurnstileWidget siteKey={captcha.siteKey} onToken={setCaptchaToken} />
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button
        type="submit"
        disabled={loading || (captcha.enabled && !captchaToken)}
        className="w-full"
      >
        {loading ? 'Đang gửi mã…' : 'Tiếp tục — nhận mã qua email'}
      </Button>
      <p className="text-center text-sm text-white/50">
        Đã có tài khoản?{' '}
        <Link href="/login" className="text-indigo-400 hover:underline">
          Đăng nhập
        </Link>
      </p>
    </form>
  );
}
