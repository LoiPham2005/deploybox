import Link from 'next/link';
import { serverGet } from '@/lib/api-server';
import { NewProjectForm } from '@/features/projects/new-project-form';

export default async function NewProjectPage() {
  const me = await serverGet.me();
  const teamId = me.teams[0]?.id ?? '';

  const [servers, identities] = await Promise.all([
    teamId ? serverGet.servers(teamId).catch(() => []) : Promise.resolve([]),
    serverGet.oauthIdentities().catch(() => []),
  ]);
  const githubConnected = identities.some((i) => i.provider === 'github');

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-white/50 hover:underline"
        >
          ← Quay lại
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Tạo project mới</h1>
        <p className="mt-1 text-sm text-white/40">
          Mỗi project sẽ được cấp sẵn một subdomain. Bước build &amp; deploy thật
          sự sẽ có khi build engine sẵn sàng.
        </p>
      </div>
      <NewProjectForm teamId={teamId} servers={servers} githubConnected={githubConnected} />
    </div>
  );
}
