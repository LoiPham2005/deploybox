'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, Trash2, FolderOpen, Plus } from 'lucide-react';
import type { ProjectSummary } from '@deploybox/shared';
import { deleteProjectAction } from './actions';
import { ProjectCard } from './project-card';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';

export function ProjectsGrid({ projects }: { projects: ProjectSummary[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const { confirm, dialog } = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const filtered = query.trim()
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(query.toLowerCase()) ||
          p.slug.toLowerCase().includes(query.toLowerCase()),
      )
    : projects;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => p.id)));
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    const ok = await confirm({
      title: `Xóa ${selected.size} project?`,
      message: 'Toàn bộ deployment, domain, env của các project này sẽ bị xóa. Không thể hoàn tác.',
      confirmText: `Xóa ${selected.size} project`,
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    setErr(null);
    for (const id of selected) {
      const res = await deleteProjectAction(id);
      if (!res.ok) { setErr(res.error); break; }
    }
    setSelected(new Set());
    setDeleting(false);
    router.refresh();
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-20 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5">
          <FolderOpen size={22} className="text-white/30" />
        </div>
        <p className="mt-4 text-sm font-medium text-white/60">Chưa có project nào</p>
        <p className="mt-1 max-w-xs text-xs text-white/30">
          Kết nối Git repo và chọn loại ứng dụng để bắt đầu deploy.
        </p>
        <Link href="/projects/new" className="mt-5">
          <Button className="gap-1.5">
            <Plus size={14} /> Tạo project đầu tiên
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {dialog}
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            placeholder="Tìm project…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-3 text-xs text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
          />
        </div>

        {filtered.length > 1 && (
          <button onClick={toggleAll} className="text-xs text-white/35 hover:text-white/60 transition-colors">
            {selected.size === filtered.length ? 'Bỏ chọn' : 'Chọn tất cả'}
          </button>
        )}

        {selected.size > 0 && (
          <button
            onClick={bulkDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
          >
            <Trash2 size={12} />
            {deleting ? 'Đang xóa…' : `Xóa ${selected.size} project`}
          </button>
        )}

        {err && <span className="text-xs text-red-400">{err}</span>}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-white/30">Không tìm thấy project nào.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <div key={p.id} className="relative">
              <input
                type="checkbox"
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
                className="absolute right-3 top-3 z-10 h-3.5 w-3.5 cursor-pointer accent-indigo-500 opacity-0 group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              />
              <div className={selected.has(p.id) ? 'ring-1 ring-indigo-500/60 rounded-xl' : ''}>
                <ProjectCard project={p} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
