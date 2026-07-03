'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Đăng ký 2 bước: (1) nhập thông tin → gửi OTP về email; (2) nhập OTP → tạo tài khoản.
 * Server chưa cấu hình SMTP → tự fallback đăng ký thẳng (không OTP).
 */
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

  // Đếm ngược nút "Gửi lại mã"
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

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
  });

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
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
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
