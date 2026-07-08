import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import NextTopLoader from 'nextjs-toploader';
import './globals.css';
import { QueryProvider } from '@/lib/query-provider';

export const metadata: Metadata = {
  title: 'DeployBox',
  description: 'PaaS tự host — deploy app + gắn domain',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className="dark">
      <body>
        {/* Thanh loading chạy ngang trên đầu trang khi chuyển trang (kiểu GitHub/YouTube) */}
        <NextTopLoader
          color="#6366f1"
          height={2.5}
          showSpinner={false}
          shadow="0 0 8px #6366f1,0 0 4px #6366f1"
        />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
