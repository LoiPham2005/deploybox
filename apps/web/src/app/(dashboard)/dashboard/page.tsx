import Link from 'next/link';
import { serverGet } from '@/lib/api-server';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ProjectCard } from '@/features/projects/project-card';

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

      {projects.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-white/70">Chưa có project nào.</p>
          <p className="mt-1 max-w-md text-sm text-white/40">
            Tạo project đầu tiên — kết nối Git, chọn loại app. Việc build &amp;
            deploy sẽ bật khi ráp build engine.
          </p>
          <Link href="/projects/new" className="mt-4">
            <Button>+ Tạo project</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}
