import Link from 'next/link';
import type { ProjectSummary } from '@deploybox/shared';
import { StatusBadge } from '@/components/ui/status-badge';
import { Globe, Smartphone, Server, Package } from 'lucide-react';

// Nhãn theo CÁCH CHẠY: web tĩnh / server (backend hoặc frontend SSR) / mobile.
// Mỗi loại 1 màu + icon riêng để nhìn phát biết ngay, khỏi lẫn.
const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  STATIC:  { icon: <Globe size={14} />,      color: 'text-sky-400 bg-sky-400/10',      label: 'Web tĩnh' },
  BACKEND: { icon: <Server size={14} />,     color: 'text-violet-400 bg-violet-400/10', label: 'Server / SSR' },
  MOBILE:  { icon: <Smartphone size={14} />, color: 'text-emerald-400 bg-emerald-400/10', label: 'Mobile' },
  DOCKER:  { icon: <Package size={14} />,    color: 'text-orange-400 bg-orange-400/10', label: 'Docker' },
};

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const typeConf = TYPE_CONFIG[project.type] ?? TYPE_CONFIG.STATIC;

  return (
    <Link href={`/projects/${project.id}`} className="group block">
      <div className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 transition-all duration-200 hover:border-white/15 hover:bg-white/[0.035]">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${typeConf.color}`}>
              {typeConf.icon}
            </div>
            <h3 className="truncate text-sm font-semibold text-white/90 group-hover:text-white">
              {project.name}
            </h3>
          </div>
          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${typeConf.color}`}>
            {typeConf.label}
          </span>
        </div>

        {/* Domain */}
        <p className="mt-2.5 truncate text-xs text-white/35">
          {project.primaryDomain ?? `${project.slug}.localhost`}
        </p>

        {/* Divider */}
        <div className="my-3.5 border-t border-white/[0.05]" />

        {/* Status */}
        <div className="flex items-center justify-between">
          {project.latestDeployment ? (
            <StatusBadge status={project.latestDeployment.status} />
          ) : (
            <span className="text-xs text-white/30">Chưa deploy</span>
          )}
          <span className="text-[10px] text-white/20 group-hover:text-white/40 transition-colors">
            Xem chi tiết →
          </span>
        </div>
      </div>
    </Link>
  );
}
