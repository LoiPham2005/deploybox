import type { WebhookEventDto } from '@deploybox/shared';

const STATUS_STYLE: Record<string, string> = {
  deployed: 'text-emerald-400',
  skipped: 'text-yellow-400',
  rejected: 'text-red-400',
};

const STATUS_LABEL: Record<string, string> = {
  deployed: '✓ deployed',
  skipped: '~ skipped',
  rejected: '✗ rejected',
};

export function WebhookHistory({ events }: { events: WebhookEventDto[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-white/40">Chưa có webhook nào được nhận.</p>;
  }

  return (
    <ul className="divide-y divide-white/5 text-sm">
      {events.map((e) => (
        <li key={e.id} className="flex items-start justify-between gap-4 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/60">
                {e.source}
              </span>
              {e.branch && (
                <code className="text-xs text-white/50">{e.branch}</code>
              )}
              {e.commitSha && (
                <code className="text-xs text-white/30">{e.commitSha.slice(0, 7)}</code>
              )}
            </div>
            {e.reason && (
              <p className="mt-0.5 text-xs text-white/30">{e.reason}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span className={`text-xs font-medium ${STATUS_STYLE[e.status] ?? 'text-white/60'}`}>
              {STATUS_LABEL[e.status] ?? e.status}
            </span>
            <span className="text-xs text-white/30">
              {new Date(e.createdAt).toLocaleString('vi-VN')}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
