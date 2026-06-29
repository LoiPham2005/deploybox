import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#09090b] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600">
            <span className="text-base font-black text-white">D</span>
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6 shadow-2xl">
          {children}
        </div>
      </div>
    </div>
  );
}
