import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full rounded-md border border-white/15 bg-transparent px-3 py-2 text-sm outline-none transition focus:border-indigo-500',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
