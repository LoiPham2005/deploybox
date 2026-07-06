import * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // Viền dịu (không trắng gắt) + nền rất nhẹ — đỡ chói khi lồng nhiều lớp
        'rounded-xl border border-white/[0.06] bg-white/[0.02] p-6',
        className,
      )}
      {...props}
    />
  );
}
