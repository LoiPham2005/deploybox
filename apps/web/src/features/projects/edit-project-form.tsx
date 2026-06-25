'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectDetailDto, UpdateProjectDto } from '@deploybox/shared';
import { updateProjectAction } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function EditProjectForm({ project }: { project: ProjectDetailDto }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string): string | undefined => {
      const v = (f.get(k) as string)?.trim();
      return v === '' ? undefined : v;
    };
    const dto: UpdateProjectDto = {
      name: s('name'),
      gitRepoUrl: s('gitRepoUrl') ?? '',
      gitBranch: s('gitBranch'),
      rootDir: s('rootDir'),
      buildCommand: s('buildCommand'),
      outputDir: project.type === 'STATIC' ? s('outputDir') : undefined,
      startCommand: project.type === 'BACKEND' ? s('startCommand') : undefined,
      internalPort:
        project.type === 'BACKEND' && s('internalPort')
          ? Number(s('internalPort'))
          : undefined,
      buildImage: project.type === 'MOBILE' ? (s('buildImage') ?? '') : undefined,
      artifactPath: project.type === 'MOBILE' ? (s('artifactPath') ?? '') : undefined,
      // gitToken: undefined = không đổi, '' = xóa, giá trị = cập nhật
      gitToken: f.has('gitToken') ? (s('gitToken') ?? '') : undefined,
      notifyUrl: s('notifyUrl') ?? '',
      autoDeploy: f.get('autoDeploy') === 'on',
      sleepEnabled: f.get('sleepEnabled') === 'on',
    };
    setSaving(true);
    setErr(null);
    setMsg(null);
    const res = await updateProjectAction(project.id, dto);
    setSaving(false);
    if (res.ok) {
      setMsg('Đã lưu');
      router.refresh();
    } else {
      setErr(res.error);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="name">Tên</Label>
        <Input id="name" name="name" defaultValue={project.name} />
      </div>
      <div>
        <Label htmlFor="gitRepoUrl">Git repo URL</Label>
        <Input
          id="gitRepoUrl"
          name="gitRepoUrl"
          defaultValue={project.gitRepoUrl ?? ''}
        />
      </div>
      <div>
        <Label htmlFor="gitToken">
          Git Access Token{' '}
          {project.hasGitToken && (
            <span className="ml-1 text-xs text-emerald-400">(đã thiết lập)</span>
          )}
        </Label>
        <Input
          id="gitToken"
          name="gitToken"
          type="password"
          placeholder={project.hasGitToken ? '••••••••  (để trống = giữ nguyên, nhập mới = cập nhật)' : 'ghp_xxxx hoặc gitlab-token…'}
          autoComplete="off"
        />
        {project.hasGitToken && (
          <p className="mt-1 text-xs text-white/30">Nhập khoảng trắng rồi xóa để clear token.</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="gitBranch">Branch</Label>
          <Input
            id="gitBranch"
            name="gitBranch"
            defaultValue={project.gitBranch}
          />
        </div>
        <div>
          <Label htmlFor="rootDir">Thư mục gốc</Label>
          <Input id="rootDir" name="rootDir" defaultValue={project.rootDir} />
        </div>
      </div>
      <div>
        <Label htmlFor="buildCommand">Lệnh build</Label>
        <Input
          id="buildCommand"
          name="buildCommand"
          defaultValue={project.buildCommand ?? ''}
        />
      </div>
      {project.type === 'STATIC' && (
        <div>
          <Label htmlFor="outputDir">Output dir</Label>
          <Input
            id="outputDir"
            name="outputDir"
            defaultValue={project.outputDir ?? ''}
          />
        </div>
      )}

      {project.type === 'BACKEND' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="startCommand">Lệnh chạy</Label>
            <Input
              id="startCommand"
              name="startCommand"
              defaultValue={project.startCommand ?? ''}
            />
          </div>
          <div>
            <Label htmlFor="internalPort">Cổng</Label>
            <Input
              id="internalPort"
              name="internalPort"
              type="number"
              defaultValue={project.internalPort}
            />
          </div>
        </div>
      )}

      {project.type === 'MOBILE' && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="buildImage">Docker image build</Label>
            <Input
              id="buildImage"
              name="buildImage"
              defaultValue={project.buildImage ?? 'cirrusci/flutter:3.41.9'}
              placeholder="cirrusci/flutter:3.41.9"
            />
          </div>
          <div>
            <Label htmlFor="artifactPath">Đường dẫn file output</Label>
            <Input
              id="artifactPath"
              name="artifactPath"
              defaultValue={project.artifactPath ?? 'build/app/outputs/flutter-apk/app-dev-release.apk'}
              placeholder="build/app/outputs/flutter-apk/app-dev-release.apk"
            />
          </div>
        </div>
      )}
      <div>
        <Label htmlFor="notifyUrl">Webhook thông báo khi build thất bại (tùy chọn)</Label>
        <Input
          id="notifyUrl"
          name="notifyUrl"
          type="url"
          defaultValue={project.notifyUrl ?? ''}
          placeholder="https://hooks.slack.com/services/…"
        />
        <p className="mt-1 text-xs text-white/30">
          POST JSON với trường <code>event</code>, <code>projectName</code>, <code>error</code> khi deploy lỗi.
        </p>
      </div>
      <div className="flex gap-4 text-sm text-white/70">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="autoDeploy"
            defaultChecked={project.autoDeploy}
          />
          Tự deploy khi push
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="sleepEnabled"
            defaultChecked={project.sleepEnabled}
          />
          Ngủ khi nhàn rỗi
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
        </Button>
        {msg && <span className="text-sm text-emerald-400">{msg}</span>}
        {err && <span className="text-sm text-red-400">{err}</span>}
      </div>
    </form>
  );
}
