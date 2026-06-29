import type { DeploymentStatus } from '@deploybox/shared';
import { cn } from '@/lib/utils';

const CONFIG: Record<DeploymentStatus, { dot: string; text: string; label: string }> = {
  QUEUED:    { dot: 'bg-white/30',       text: 'text-white/50',    label: 'Chờ xử lý' },
  BUILDING:  { dot: 'bg-amber-400 animate-pulse',  text: 'text-amber-300',   label: 'Building' },
  DEPLOYING: { dot: 'bg-blue-400 animate-pulse',   text: 'text-blue-300',    label: 'Deploying' },
  RUNNING:   { dot: 'bg-emerald-400',    text: 'text-emerald-400', label: 'Đang chạy' },
  SLEEPING:  { dot: 'bg-violet-400',     text: 'text-violet-300',  label: 'Sleeping' },
  FAILED:    { dot: 'bg-red-400',        text: 'text-red-400',     label: 'Thất bại' },
  STOPPED:   { dot: 'bg-white/20',       text: 'text-white/40',    label: 'Đã dừng' },
  CANCELLED: { dot: 'bg-white/20',       text: 'text-white/40',    label: 'Đã hủy' },
};

export function StatusBadge({ status }: { status: DeploymentStatus }) {
  const c = CONFIG[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />
      <span className={cn('text-xs font-medium', c.text)}>{c.label}</span>
    </span>
  );
}
