import Link from 'next/link';

export default function DashboardNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <p className="text-6xl font-bold text-white/10">404</p>
      <h1 className="text-xl font-semibold">Không tìm thấy</h1>
      <p className="text-sm text-white/40">Project hoặc resource này không tồn tại.</p>
      <Link href="/dashboard" className="text-sm text-indigo-400 hover:underline">
        ← Về danh sách project
      </Link>
    </div>
  );
}
