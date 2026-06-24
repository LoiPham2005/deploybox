import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ProjectDetailDto } from '@deploybox/shared';
import { serverGet } from '@/lib/api-server';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { DeleteProjectButton } from '@/features/projects/delete-project-button';
import { DeployButton } from '@/features/deployments/deploy-button';
import { EnvManager } from '@/features/projects/env-manager';
import { EditProjectForm } from '@/features/projects/edit-project-form';
import { ProjectRuntimeActions } from '@/features/projects/project-runtime-actions';
import { DomainManager } from '@/features/projects/domain-manager';

export default async function ProjectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  let project: ProjectDetailDto;
  try {
    project = await serverGet.project(params.id);
  } catch {
    notFound();
  }

  const primary =
    project.domains.find((d) => d.isPrimary) ?? project.domains[0];
  const env = await serverGet.env(project.id).catch(() => []);
  const deployable = !!project.gitRepoUrl;
  const deployHint = deployable
    ? undefined
    : 'Thêm Git repo URL trước khi deploy';

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-white/50 hover:underline"
        >
          ← Projects
        </Link>
        <div className="mt-2 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{project.name}</h1>
            <p className="mt-1 text-sm text-white/40">
              {primary ? `https://${primary.hostname}` : project.slug}
            </p>
          </div>
          <DeployButton
            projectId={project.id}
            disabled={!deployable}
            hint={deployHint}
          />
        </div>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-white/70">Cấu hình</h2>
        <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          <Row label="Loại" value={project.type} />
          <Row label="Git repo" value={project.gitRepoUrl ?? '—'} />
          <Row label="Branch" value={project.gitBranch} />
          <Row label="Thư mục gốc" value={project.rootDir} />
          <Row label="Lệnh build" value={project.buildCommand ?? '—'} />
          {project.type === 'STATIC' && (
            <Row label="Output dir" value={project.outputDir ?? '—'} />
          )}
          {project.type === 'BACKEND' && (
            <>
              <Row label="Lệnh chạy" value={project.startCommand ?? '—'} />
              <Row label="Cổng" value={String(project.internalPort)} />
            </>
          )}
          {project.type === 'MOBILE' && (
            <>
              <Row label="Docker image" value={project.buildImage ?? '—'} />
              <Row label="Artifact path" value={project.artifactPath ?? '—'} />
            </>
          )}
        </dl>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-white/70">Domains</h2>
        <DomainManager projectId={project.id} domains={project.domains} />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-white/70">
          Webhook — tự deploy khi git push
        </h2>
        <div className="space-y-2 text-sm">
          <div>
            <p className="text-white/40">URL</p>
            <code className="block break-all rounded bg-black/40 px-2 py-1 text-xs">
              {project.webhookUrl}
            </code>
          </div>
          <div>
            <p className="text-white/40">Secret</p>
            <code className="block break-all rounded bg-black/40 px-2 py-1 text-xs">
              {project.webhookSecret ?? '—'}
            </code>
          </div>
          <p className="text-xs text-white/40">
            GitHub → repo Settings → Webhooks → Add webhook: dán URL, Content type{' '}
            <code>application/json</code>, điền Secret như trên, chọn{' '}
            <em>Just the push event</em>. Push lên branch{' '}
            <code>{project.gitBranch}</code> sẽ tự deploy (cần bật “Tự deploy”).
          </p>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/70">Lần deploy</h2>
          <ProjectRuntimeActions
            projectId={project.id}
            canDeploy={deployable}
            canSleep={project.type === 'BACKEND'}
          />
        </div>
        {project.deployments.length === 0 ? (
          <p className="text-sm text-white/40">
            Chưa có lần deploy nào. Nút Deploy sẽ hoạt động khi build engine sẵn
            sàng.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {project.deployments.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/projects/${project.id}/deployments/${d.id}`}
                  className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-white/5"
                >
                  <span className="text-white/60">
                    {d.id.slice(0, 8)} ·{' '}
                    {new Date(d.queuedAt).toLocaleString('vi-VN')}
                  </span>
                  <StatusBadge status={d.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-white/70">
          Biến môi trường
        </h2>
        <EnvManager projectId={project.id} vars={env} />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-white/70">
          Sửa cấu hình
        </h2>
        <EditProjectForm project={project} />
      </Card>

      <Card className="border-red-500/20">
        <h2 className="mb-3 text-sm font-semibold text-red-300">
          Vùng nguy hiểm
        </h2>
        <DeleteProjectButton projectId={project.id} />
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/5 py-1">
      <dt className="text-white/40">{label}</dt>
      <dd className="truncate text-right">{value}</dd>
    </div>
  );
}
