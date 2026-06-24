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
      buildImage: type === 'MOBILE' ? str('buildImage') : undefined,
      artifactPath: type === 'MOBILE' ? str('artifactPath') : undefined,
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
          <option value="MOBILE">App mobile (Flutter APK/AAB)</option>
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

      {type !== 'MOBILE' && (
        <div>
          <Label htmlFor="buildCommand">Lệnh build (tùy chọn)</Label>
          <Input
            id="buildCommand"
            name="buildCommand"
            placeholder={type === 'STATIC' ? 'npm run build' : 'npm run build'}
          />
        </div>
      )}

      {type === 'STATIC' && (
        <div>
          <Label htmlFor="outputDir">Thư mục output</Label>
          <Input id="outputDir" name="outputDir" placeholder="dist" />
        </div>
      )}

      {type === 'BACKEND' && (
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

      {type === 'MOBILE' && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="buildCommand">Lệnh build</Label>
            <Input
              id="buildCommand"
              name="buildCommand"
              placeholder="flutter build apk --release"
              defaultValue="flutter build apk --release"
            />
            <p className="mt-1 text-xs text-white/40">
              Dùng <code>flutter build appbundle --release</code> để tạo AAB lên Play Store
            </p>
          </div>
          <div>
            <Label htmlFor="buildImage">Docker image build</Label>
            <Input
              id="buildImage"
              name="buildImage"
              placeholder="cirrusci/flutter:stable"
              defaultValue="cirrusci/flutter:stable"
            />
            <p className="mt-1 text-xs text-white/40">
              Image chứa Flutter SDK — server sẽ tự pull lần đầu
            </p>
          </div>
          <div>
            <Label htmlFor="artifactPath">Đường dẫn file output</Label>
            <Input
              id="artifactPath"
              name="artifactPath"
              placeholder="build/app/outputs/flutter-apk/app-release.apk"
              defaultValue="build/app/outputs/flutter-apk/app-release.apk"
            />
            <p className="mt-1 text-xs text-white/40">
              AAB: <code>build/app/outputs/bundle/release/app-release.aab</code>
            </p>
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
