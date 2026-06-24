'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Tự gọi router.refresh() theo chu kỳ khi deployment còn đang chạy →
 * Server Component fetch lại trạng thái + log (dùng cookie httpOnly, không lộ token).
 * Khi xong (terminal) thì ngừng.
 */
export function AutoRefresh({
  active,
  intervalMs = 1500,
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
