import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, variant = 'primary', ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
          variant === 'primary' && 'bg-indigo-600 text-white hover:bg-indigo-500',
          variant === 'ghost' && 'bg-transparent hover:bg-white/10',
          className,
        )}
        {...props}
      />
    );
  },
);
