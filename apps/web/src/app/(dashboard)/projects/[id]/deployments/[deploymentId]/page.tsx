import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { DeploymentView } from '@deploybox/shared';
import { serverGet } from '@/lib/api-server';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { AutoRefresh } from '@/features/deployments/auto-refresh';
import { RollbackButton } from '@/features/deployments/rollback-button';

const TERMINAL = ['RUNNING', 'FAILED', 'STOPPED', 'CANCELLED'];

export default async function DeploymentPage({
  params,
}: {
  params: { id: string; deploymentId: string };
}) {
  let view: DeploymentView;
  try {
    view = await serverGet.deployment(params.deploymentId);
  } catch {
    notFound();
  }

  const { deployment, project, url, logs } = view;
  const isActive = !TERMINAL.includes(deployment.status);

  return (
    <div className="space-y-6">
      <AutoRefresh active={isActive} />

      <div>
        <Link
          href={`/projects/${params.id}`}
          className="text-sm text-white/50 hover:underline"
        >
          ← {project.name}
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">Deployment</h1>
            <StatusBadge status={deployment.status} />
            {isActive && (
              <span className="text-xs text-white/40">đang cập nhật…</span>
            )}
          </div>
          {!isActive && (
            <RollbackButton
              projectId={params.id}
              deploymentId={deployment.id}
            />
          )}
        </div>
      </div>

      {url && (
        <Card className="border-emerald-500/20">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-white/50">Site đang chạy tại</p>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-emerald-300 hover:underline"
              >
                {url}
              </a>
            </div>
            <a href={url} target="_blank" rel="noreferrer">
              <Button>Mở site</Button>
            </a>
          </div>
        </Card>
      )}

      {deployment.errorMessage && (
        <Card className="border-red-500/20">
          <p className="text-sm text-red-300">{deployment.errorMessage}</p>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-white/70">Build log</h2>
        <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded bg-black/40 p-3 text-xs leading-relaxed text-white/80">
          {logs || 'Chưa có log…'}
        </pre>
      </Card>
    </div>
  );
}
