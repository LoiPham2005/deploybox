'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
        },
      ) => string;
    };
  }
}

/**
 * Cloudflare Turnstile — "check người hay robot" (admin bật ở Tính năng).
 * Render widget + gọi onToken(token) khi xác minh xong (đa số tự chạy, không cần bấm).
 */
export function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let cancelled = false;

    const render = () => {
      if (cancelled || !ref.current || !window.turnstile) return;
      ref.current.innerHTML = ''; // render lại sạch (StrictMode/remount)
      window.turnstile.render(ref.current, {
        sitekey: siteKey,
        theme: 'dark',
        callback: (t) => cb.current(t),
        'expired-callback': () => cb.current(''),
      });
    };

    if (window.turnstile) {
      render();
    } else {
      let s = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
      if (!s) {
        s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.dataset.turnstile = '1';
        document.head.appendChild(s);
      }
      s.addEventListener('load', render);
    }
    return () => {
      cancelled = true;
    };
  }, [siteKey]);

  return <div ref={ref} className="min-h-[65px]" />;
}
