import Link from 'next/link';
import { serverGet } from '@/lib/api-server';
import { getSelectedTeam } from '@/lib/team';
import { Button } from '@/components/ui/button';
import { ProjectsGrid } from '@/features/projects/projects-grid';

export default async function DashboardPage() {
  const me = await serverGet.me();
  const team = getSelectedTeam(me.teams);
  const teamId = team?.id;
  const projects = teamId ? (await serverGet.projects(teamId)).data : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <Link href="/projects/new">
          <Button>+ Tạo project</Button>
        </Link>
      </div>
      <ProjectsGrid projects={projects} />
    </div>
  );
}
