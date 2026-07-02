import type { ReactNode } from 'react';
import { LogoMark } from '@/components/logo';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#09090b] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex justify-center">
            <LogoMark size={44} />
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6 shadow-2xl">
          {children}
        </div>
      </div>
    </div>
  );
}
