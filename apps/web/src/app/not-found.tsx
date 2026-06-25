import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <p className="text-6xl font-bold text-white/10">404</p>
      <h1 className="text-xl font-semibold">Không tìm thấy trang</h1>
      <p className="text-sm text-white/40">Trang này không tồn tại hoặc đã bị xóa.</p>
      <Link href="/dashboard" className="text-sm text-indigo-400 hover:underline">
        ← Về trang chủ
      </Link>
    </div>
  );
}
