'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { CreateProjectDto, ProjectType } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

const TEMPLATES: Array<{
  label: string;
  type: ProjectType;
  buildCommand?: string;
  outputDir?: string;
  startCommand?: string;
  internalPort?: number;
  buildImage?: string;
  artifactPath?: string;
}> = [
  { label: 'React / Vite',      type: 'STATIC',  buildCommand: 'npm run build',           outputDir: 'dist' },
  { label: 'Next.js',           type: 'STATIC',  buildCommand: 'npm run build && npm run export', outputDir: 'out' },
  { label: 'Vue / Nuxt static', type: 'STATIC',  buildCommand: 'npm run generate',         outputDir: '.output/public' },
  { label: 'Node / Express',    type: 'BACKEND', buildCommand: 'npm run build',           startCommand: 'node dist/index.js', internalPort: 3000 },
  { label: 'Python / FastAPI',  type: 'BACKEND', startCommand: 'uvicorn main:app --host 0.0.0.0 --port 8000', internalPort: 8000 },
  { label: 'Flutter APK',       type: 'MOBILE',  buildCommand: 'flutter build apk --release', buildImage: 'cirrusci/flutter:stable', artifactPath: 'build/app/outputs/flutter-apk/app-release.apk' },
  { label: 'Flutter AAB',       type: 'MOBILE',  buildCommand: 'flutter build appbundle --release', buildImage: 'cirrusci/flutter:stable', artifactPath: 'build/app/outputs/bundle/release/app-release.aab' },
];

export function NewProjectForm({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [type, setType] = useState<ProjectType>('STATIC');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [templateApplied, setTemplateApplied] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

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
      gitToken: str('gitToken') || undefined,
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

  function applyTemplate(tpl: typeof TEMPLATES[0]) {
    setType(tpl.type);
    setTemplateApplied(tpl.label);
    setFields({
      buildCommand: tpl.buildCommand ?? '',
      outputDir: tpl.outputDir ?? '',
      startCommand: tpl.startCommand ?? '',
      internalPort: String(tpl.internalPort ?? 3000),
      buildImage: tpl.buildImage ?? '',
      artifactPath: tpl.artifactPath ?? '',
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <p className="mb-2 text-xs text-white/50">Bắt đầu nhanh từ template</p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => applyTemplate(t)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                templateApplied === t.label
                  ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                  : 'border-white/10 text-white/50 hover:border-white/30 hover:text-white/80'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

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

      <div>
        <Label htmlFor="gitToken">Git Access Token (để trống nếu repo public)</Label>
        <Input
          id="gitToken"
          name="gitToken"
          type="password"
          placeholder="ghp_xxxx hoặc gitlab-token…"
          autoComplete="off"
        />
        <p className="mt-1 text-xs text-white/30">
          GitHub: Settings → Developer settings → Personal access tokens (scope: repo)
        </p>
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
            value={fields.buildCommand ?? ''}
            onChange={(e) => setFields((f) => ({ ...f, buildCommand: e.target.value }))}
          />
        </div>
      )}

      {type === 'STATIC' && (
        <div>
          <Label htmlFor="outputDir">Thư mục output</Label>
          <Input
            id="outputDir"
            name="outputDir"
            placeholder="dist"
            value={fields.outputDir ?? ''}
            onChange={(e) => setFields((f) => ({ ...f, outputDir: e.target.value }))}
          />
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
              value={fields.startCommand ?? ''}
              onChange={(e) => setFields((f) => ({ ...f, startCommand: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="internalPort">Cổng app</Label>
            <Input
              id="internalPort"
              name="internalPort"
              type="number"
              value={fields.internalPort ?? '3000'}
              onChange={(e) => setFields((f) => ({ ...f, internalPort: e.target.value }))}
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
              value={fields.buildCommand ?? 'flutter build apk --release'}
              onChange={(e) => setFields((f) => ({ ...f, buildCommand: e.target.value }))}
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
              value={fields.buildImage ?? 'cirrusci/flutter:stable'}
              onChange={(e) => setFields((f) => ({ ...f, buildImage: e.target.value }))}
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
              value={fields.artifactPath ?? 'build/app/outputs/flutter-apk/app-release.apk'}
              onChange={(e) => setFields((f) => ({ ...f, artifactPath: e.target.value }))}
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
