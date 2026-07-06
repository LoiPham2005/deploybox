import { serverGet } from '@/lib/api-server';
import { OverviewTable } from '@/features/overview/overview-table';

export default async function OverviewPage() {
  const items = await serverGet.overview().catch(() => []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Tổng quan</h1>
        <p className="mt-0.5 text-sm text-white/40">
          Tất cả app của bạn — trạng thái, RAM, CPU, canh uptime cùng một màn.
        </p>
      </div>
      <OverviewTable initial={items} />
    </div>
  );
}
