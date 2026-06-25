'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch('/api/session', { method: 'DELETE' });
    router.push('/login');
    router.refresh();
  }
  return (
    <button
      onClick={logout}
      title="Đăng xuất"
      className="flex h-6 w-6 items-center justify-center rounded-md text-white/25 transition-colors hover:bg-white/8 hover:text-white/60"
    >
      <LogOut size={13} />
    </button>
  );
}
