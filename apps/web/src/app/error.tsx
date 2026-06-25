'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <p className="text-5xl font-bold text-white/10">500</p>
      <h1 className="text-xl font-semibold">Đã xảy ra lỗi</h1>
      <p className="max-w-sm text-sm text-white/40">
        {error.message || 'Lỗi không xác định. Vui lòng thử lại.'}
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500"
      >
        Thử lại
      </button>
    </div>
  );
}
