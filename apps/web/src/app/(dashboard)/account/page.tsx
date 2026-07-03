import { redirect } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { AccountForm } from '@/features/auth/account-form';
import { TelegramConnect } from '@/features/auth/telegram-connect';

export default async function AccountPage() {
  const token = getToken();
  if (!token) redirect('/login');

  const me = await authApi.me(token).catch(() => redirect('/api/session/clear'));

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-xl font-semibold">Tài khoản</h1>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-white/70">Thông tin cá nhân</h2>
        <AccountForm user={me.user} />
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-white/70">Thông báo</h2>
        <TelegramConnect />
      </Card>
    </div>
  );
}
