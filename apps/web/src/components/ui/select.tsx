import * as React from 'react';
import { cn } from '@/lib/utils';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'w-full rounded-md border border-white/15 bg-neutral-900 px-3 py-2 text-sm outline-none transition focus:border-indigo-500',
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = 'Select';
