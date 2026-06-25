'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const QUICK_ACCOUNTS = [
  { label: 'OWNER',  email: 'owner@deploybox.local',  cls: 'border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10' },
  { label: 'ADMIN',  email: 'admin@deploybox.local',   cls: 'border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10' },
  { label: 'MEMBER', email: 'member@deploybox.local',  cls: 'border-white/20 text-white/60 hover:bg-white/5' },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function doLogin(loginEmail: string, loginPassword: string) {
    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await authApi.login({ email: loginEmail, password: loginPassword });
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: accessToken }),
      });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại');
      setLoading(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await doLogin(email, password);
  }

  async function onQuickLogin(quickEmail: string) {
    setEmail(quickEmail);
    setPassword('changeme');
    await doLogin(quickEmail, 'changeme');
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Đăng nhập DeployBox</h1>
        <p className="mt-1 text-sm text-white/50">Dùng tài khoản nội bộ của bạn</p>
      </div>

      {/* Quick login panel */}
      <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs text-white/40">Đăng nhập nhanh (dev)</p>
        <div className="flex gap-2">
          {QUICK_ACCOUNTS.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={loading}
              onClick={() => onQuickLogin(a.email)}
              className={`flex-1 rounded border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${a.cls}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

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
          <Label htmlFor="password">Mật khẩu</Label>
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
