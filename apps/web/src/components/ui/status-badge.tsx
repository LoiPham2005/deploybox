import type { DeploymentStatus } from '@deploybox/shared';
import { cn } from '@/lib/utils';

const STYLES: Record<DeploymentStatus, string> = {
  QUEUED: 'bg-white/10 text-white/70',
  BUILDING: 'bg-amber-500/15 text-amber-300',
  DEPLOYING: 'bg-blue-500/15 text-blue-300',
  RUNNING: 'bg-emerald-500/15 text-emerald-300',
  SLEEPING: 'bg-violet-500/15 text-violet-300',
  FAILED: 'bg-red-500/15 text-red-300',
  STOPPED: 'bg-white/10 text-white/50',
  CANCELLED: 'bg-white/10 text-white/50',
};

const LABELS: Record<DeploymentStatus, string> = {
  QUEUED: 'Đang chờ',
  BUILDING: 'Đang build',
  DEPLOYING: 'Đang deploy',
  RUNNING: 'Đang chạy',
  SLEEPING: 'Đang ngủ',
  FAILED: 'Thất bại',
  STOPPED: 'Đã dừng',
  CANCELLED: 'Đã hủy',
};

export function StatusBadge({ status }: { status: DeploymentStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        STYLES[status],
      )}
    >
      {LABELS[status]}
    </span>
  );
}
