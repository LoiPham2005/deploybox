'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { CreateProjectDto, ProjectType } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

export function NewProjectForm({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [type, setType] = useState<ProjectType>('STATIC');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!teamId) {
      setError('Không xác định được team. Thử đăng nhập lại.');
      return;
    }

    const form = new FormData(e.currentTarget);
    const str = (k: string) => (form.get(k) as string)?.trim() || undefined;
    const portRaw = str('internalPort');

    const dto: CreateProjectDto = {
      name: str('name') ?? '',
      type,
      gitRepoUrl: str('gitRepoUrl'),
      gitBranch: str('gitBranch') ?? 'main',
      rootDir: str('rootDir') ?? '.',
      buildCommand: str('buildCommand'),
      outputDir: type === 'STATIC' ? str('outputDir') : undefined,
      startCommand: type === 'BACKEND' ? str('startCommand') : undefined,
      internalPort:
        type === 'BACKEND' && portRaw ? Number(portRaw) : undefined,
    };

    setLoading(true);
    const { createProjectAction } = await import('./actions');
    const res = await createProjectAction(teamId, dto);
    if (res.ok && res.data) {
      router.push(`/projects/${res.data.id}`);
      router.refresh();
    } else {
      setError(res.ok ? 'Không tạo được project' : res.error);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Tên project</Label>
        <Input id="name" name="name" placeholder="my-app" required />
      </div>

      <div>
        <Label htmlFor="type">Loại</Label>
        <Select
          id="type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as ProjectType)}
        >
          <option value="STATIC">Web tĩnh (React/Vue/Flutter Web…)</option>
          <option value="BACKEND">Web có backend (Node/Python…)</option>
        </Select>
      </div>

      <div>
        <Label htmlFor="gitRepoUrl">Git repo URL (tùy chọn)</Label>
        <Input
          id="gitRepoUrl"
          name="gitRepoUrl"
          type="url"
          placeholder="https://github.com/user/repo"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="gitBranch">Branch</Label>
          <Input id="gitBranch" name="gitBranch" defaultValue="main" />
        </div>
        <div>
          <Label htmlFor="rootDir">Thư mục gốc</Label>
          <Input id="rootDir" name="rootDir" defaultValue="." />
        </div>
      </div>

      <div>
        <Label htmlFor="buildCommand">Lệnh build (tùy chọn)</Label>
        <Input
          id="buildCommand"
          name="buildCommand"
          placeholder={type === 'STATIC' ? 'npm run build' : 'npm run build'}
        />
      </div>

      {type === 'STATIC' ? (
        <div>
          <Label htmlFor="outputDir">Thư mục output</Label>
          <Input id="outputDir" name="outputDir" placeholder="dist" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="startCommand">Lệnh chạy</Label>
            <Input
              id="startCommand"
              name="startCommand"
              placeholder="node dist/main.js"
            />
          </div>
          <div>
            <Label htmlFor="internalPort">Cổng app</Label>
            <Input
              id="internalPort"
              name="internalPort"
              type="number"
              defaultValue={3000}
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={loading}>
          {loading ? 'Đang tạo…' : 'Tạo project'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
        >
          Hủy
        </Button>
      </div>
    </form>
  );
}
