'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch('/api/session', { method: 'DELETE' });
    router.push('/login');
    router.refresh();
  }
  return (
    <Button variant="ghost" onClick={logout} className="px-2 py-1 text-xs">
      Đăng xuất
    </Button>
  );
}
