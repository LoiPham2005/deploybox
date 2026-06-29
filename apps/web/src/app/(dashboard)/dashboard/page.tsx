import Link from 'next/link';
import { Plus } from 'lucide-react';
import { serverGet } from '@/lib/api-server';
import { getSelectedTeam } from '@/lib/team';
import { ProjectsGrid } from '@/features/projects/projects-grid';

export default async function DashboardPage() {
  const me = await serverGet.me();
  const team = getSelectedTeam(me.teams);
  const teamId = team?.id;
  const projects = teamId ? (await serverGet.projects(teamId)).data : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Projects</h1>
          <p className="mt-0.5 text-sm text-white/40">
            {projects.length} project{projects.length !== 1 ? 's' : ''} trong team này
          </p>
        </div>
        <Link
          href="/projects/new"
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          <Plus size={15} />
          Tạo project
        </Link>
      </div>
      <ProjectsGrid projects={projects} />
    </div>
  );
}
