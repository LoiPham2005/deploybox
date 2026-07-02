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
import { MetricsCard } from '@/features/projects/metrics-card';
import { RollbackButton } from '@/features/deployments/rollback-button';
import { WebhookHistory } from '@/features/projects/webhook-history';
import { DeployApiSnippet } from '@/features/projects/deploy-api-snippet';
import { WebhookGuide } from '@/features/projects/webhook-guide';
import { AiCheckPanel } from '@/features/projects/ai-check-panel';
import { GenerateCi } from '@/features/projects/generate-ci';
import { OpsAdvice } from '@/features/projects/ops-advice';

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

  const [me, env, webhookEvents] = await Promise.all([
    serverGet.me().catch(() => null),
    serverGet.env(project.id).catch(() => []),
    serverGet.webhookEvents(project.id).catch(() => []),
  ]);

  const userRole = me?.teams.find((t) => t.id === project.teamId)?.role ?? 'MEMBER';
  const canRollback = userRole === 'OWNER';

  const primary =
    project.domains.find((d) => d.isPrimary) ?? project.domains[0];
  const latestRunning =
    project.type === 'BACKEND' &&
    project.deployments[0]?.status === 'RUNNING';
  const deployable = !!project.gitRepoUrl;
  const deployHint = deployable
    ? undefined
    : 'Thêm Git repo URL trước khi deploy';
  const isSleeping = project.deployments[0]?.status === 'SLEEPING';

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-white/50 hover:underline"
        >
          ← Projects
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
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

      {isSleeping && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-300">
          <span className="font-medium">Project đang ngủ (SLEEPING).</span>{' '}
          Gửi bất kỳ request HTTP nào tới URL của project để tự động wake up.
        </div>
      )}

      {latestRunning && <MetricsCard projectId={project.id} />}

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

      <Card className="border-sky-500/15">
        <AiCheckPanel
          projectId={project.id}
          requiredEnvKeys={project.requiredEnvKeys ?? []}
          envVars={env}
          hasRepo={!!project.gitRepoUrl}
        />
        <OpsAdvice projectId={project.id} />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-white/70">Domains</h2>
        <DomainManager projectId={project.id} domains={project.domains} />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-white/70">
          Webhook — tự deploy khi git push
        </h2>
        <WebhookGuide
          webhookUrl={project.webhookUrl}
          webhookSecret={project.webhookSecret ?? null}
          gitBranch={project.gitBranch}
        />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-white/70">
          Deploy qua API / CI-CD
        </h2>
        <DeployApiSnippet projectId={project.id} />
        <GenerateCi projectId={project.id} />
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/70">
            Lần deploy
            {project.deployments.length >= 30 && (
              <Link
                href={`/projects/${project.id}/deployments`}
                className="ml-3 text-xs font-normal text-indigo-400 hover:underline"
              >
                Xem tất cả →
              </Link>
            )}
          </h2>
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
            {project.deployments.map((d, i) => (
              <li key={d.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-white/5">
                <Link
                  href={`/projects/${project.id}/deployments/${d.id}`}
                  className="flex flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-white/60">
                    {d.id.slice(0, 8)}
                    {d.commitSha && (
                      <code className="ml-2 text-xs text-white/30">{d.commitSha.slice(0, 7)}</code>
                    )}
                    {d.commitMsg && (
                      <span className="ml-2 hidden max-w-[200px] truncate text-xs text-white/40 sm:inline">{d.commitMsg}</span>
                    )}
                    <span className="ml-2 text-white/30">
                      {new Date(d.queuedAt).toLocaleString('vi-VN')}
                    </span>
                  </span>
                  <StatusBadge status={d.status} />
                </Link>
                {i > 0 && (
                  <RollbackButton
                    projectId={project.id}
                    deploymentId={d.id}
                    canRollback={canRollback}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-white/70">Webhook history</h2>
        <WebhookHistory events={webhookEvents} />
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
