'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ProjectSummary } from '@deploybox/shared';
import { deleteProjectAction } from './actions';
import { ProjectCard } from './project-card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function ProjectsGrid({ projects }: { projects: ProjectSummary[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
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
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((p) => p.id)));
    }
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Xóa ${selected.size} project? Không thể hoàn tác.`)) return;
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
      <div className="flex flex-col items-center justify-center rounded-lg border border-white/10 py-16 text-center">
        <p className="text-white/70">Chưa có project nào.</p>
        <p className="mt-1 max-w-md text-sm text-white/40">
          Tạo project đầu tiên — kết nối Git, chọn loại app.
        </p>
        <Link href="/projects/new" className="mt-4">
          <Button>+ Tạo project</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Tìm project…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        {selected.size > 0 && (
          <Button
            variant="ghost"
            onClick={bulkDelete}
            disabled={deleting}
            className="text-red-400 hover:text-red-300"
          >
            {deleting ? 'Đang xóa…' : `Xóa ${selected.size} project`}
          </Button>
        )}
        {filtered.length > 1 && (
          <button
            onClick={toggleAll}
            className="text-xs text-white/40 hover:text-white/70"
          >
            {selected.size === filtered.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
          </button>
        )}
        {err && <span className="text-xs text-red-400">{err}</span>}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-white/40">Không tìm thấy project nào.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <div key={p.id} className="relative">
              <input
                type="checkbox"
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
                className="absolute right-3 top-3 z-10 h-4 w-4 cursor-pointer accent-indigo-500"
                onClick={(e) => e.stopPropagation()}
              />
              <div className={selected.has(p.id) ? 'ring-1 ring-indigo-500/50 rounded-lg' : ''}>
                <ProjectCard project={p} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
