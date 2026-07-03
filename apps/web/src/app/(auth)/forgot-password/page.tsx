'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Quên mật khẩu: (1) nhập email → nhận OTP; (2) nhập OTP + mật khẩu mới. */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function onSendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setStep('reset');
      setCode('');
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gửi mã thất bại');
    }
    setLoading(false);
  }

  async function onReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.resetPassword({ email, code: code.trim(), newPassword });
      setDone(true);
      setTimeout(() => router.push('/login'), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đặt lại mật khẩu thất bại');
      setLoading(false);
    }
  }

  async function onResend() {
    if (cooldown > 0) return;
    setError(null);
    try {
      await authApi.forgotPassword(email);
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gửi lại mã thất bại');
    }
  }

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-3xl">✅</p>
        <h1 className="text-xl font-semibold">Đã đổi mật khẩu</h1>
        <p className="text-sm text-white/50">Đang chuyển về trang đăng nhập…</p>
      </div>
    );
  }

  if (step === 'reset') {
    return (
      <form onSubmit={onReset} className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Đặt lại mật khẩu</h1>
          <p className="mt-1 text-sm text-white/50">
            Nếu <span className="text-white/80">{email}</span> có tài khoản, mã 6 số đã
            được gửi tới (kiểm tra cả mục Spam).
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
        <div>
          <Label htmlFor="newPassword">Mật khẩu mới (≥ 8 ký tự)</Label>
          <Input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            autoComplete="new-password"
            required
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button
          type="submit"
          disabled={loading || code.length !== 6 || newPassword.length < 8}
          className="w-full"
        >
          {loading ? 'Đang đổi…' : 'Đổi mật khẩu'}
        </Button>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => { setStep('email'); setError(null); }}
            className="text-white/50 hover:underline"
          >
            ← Đổi email
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
    <form onSubmit={onSendCode} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Quên mật khẩu</h1>
        <p className="mt-1 text-sm text-white/50">
          Nhập email tài khoản — chúng tôi sẽ gửi mã xác thực để đặt lại mật khẩu
        </p>
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          required
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? 'Đang gửi…' : 'Gửi mã xác thực'}
      </Button>
      <p className="text-center text-sm text-white/50">
        Nhớ ra mật khẩu?{' '}
        <Link href="/login" className="text-indigo-400 hover:underline">
          Đăng nhập
        </Link>
      </p>
    </form>
  );
}
