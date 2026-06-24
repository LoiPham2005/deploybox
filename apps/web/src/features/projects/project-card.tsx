import Link from 'next/link';
import type { ProjectSummary } from '@deploybox/shared';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link href={`/projects/${project.id}`} className="block">
      <Card className="h-full transition hover:border-white/25">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate font-medium">{project.name}</h3>
          <span className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-xs text-white/60">
            {project.type}
          </span>
        </div>
        <p className="mt-1 truncate text-sm text-white/40">
          {project.primaryDomain ?? project.slug}
        </p>
        <div className="mt-4">
          {project.latestDeployment ? (
            <StatusBadge status={project.latestDeployment.status} />
          ) : (
            <span className="text-xs text-white/40">Chưa deploy</span>
          )}
        </div>
      </Card>
    </Link>
  );
}
