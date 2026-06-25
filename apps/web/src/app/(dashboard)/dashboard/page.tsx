import Link from 'next/link';
import { serverGet } from '@/lib/api-server';
import { Button } from '@/components/ui/button';
import { ProjectsGrid } from '@/features/projects/projects-grid';

export default async function DashboardPage() {
  const me = await serverGet.me();
  const teamId = me.teams[0]?.id;
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
