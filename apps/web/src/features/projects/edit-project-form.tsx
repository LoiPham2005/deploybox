'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectDetailDto, UpdateProjectDto } from '@deploybox/shared';
import { updateProjectAction, fetchProjectBranchesAction, type RemoteBranch } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

/** "2 ngày trước"… từ ISO date */
function relativeVi(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  const min = Math.floor(diff / 60_000);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  const mon = Math.floor(day / 30);
  const yr = Math.floor(day / 365);
  if (yr > 0) return `${yr} năm trước`;
  if (mon > 0) return `${mon} tháng trước`;
  if (day > 0) return `${day} ngày trước`;
  if (hr > 0) return `${hr} giờ trước`;
  if (min > 0) return `${min} phút trước`;
  return 'vừa xong';
}

export function EditProjectForm({ project }: { project: ProjectDetailDto }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Loại project — đổi được để hiện đúng field (STATIC: output dir; BACKEND: cổng + lệnh chạy)
  const [type, setType] = useState(project.type);

  // Git token: CHỈ gửi khi user thật sự gõ vào ô (touched) — nếu không, lần Lưu
  // nào cũng gửi chuỗi rỗng và backend hiểu nhầm là "xoá token" (bug đã gặp).
  const [gitTokenVal, setGitTokenVal] = useState('');
  const [gitTokenTouched, setGitTokenTouched] = useState(false);

  // Branch picker — dùng token đã lưu của project
  const [selectedBranch, setSelectedBranch] = useState(project.gitBranch);
  const [branches, setBranches] = useState<RemoteBranch[] | null>(null);
  const [fetchingBranches, setFetchingBranches] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);

  async function fetchBranches() {
    setFetchingBranches(true);
    setBranchError(null);
    setBranches(null);
    const res = await fetchProjectBranchesAction(project.id);
    setFetchingBranches(false);
    if (res.ok && res.data) {
      setBranches(res.data);
      // Giữ nhánh hiện tại nếu còn tồn tại, không thì chọn nhánh mới nhất
      if (!res.data.some((b) => b.name === selectedBranch) && res.data[0]) {
        setSelectedBranch(res.data[0].name);
      }
    } else if (!res.ok) {
      setBranchError(res.error);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string): string | undefined => {
      const v = (f.get(k) as string)?.trim();
      return v === '' ? undefined : v;
    };
    const dto: UpdateProjectDto = {
      name: s('name'),
      type,
      gitRepoUrl: s('gitRepoUrl') ?? '',
      gitBranch: s('gitBranch'),
      rootDir: s('rootDir'),
      buildCommand: s('buildCommand'),
      outputDir: type === 'STATIC' ? s('outputDir') : undefined,
      startCommand: type === 'BACKEND' ? s('startCommand') : undefined,
      preDeployCommand: type === 'BACKEND' ? (s('preDeployCommand') ?? '') : undefined,
      postDeployCommand: type === 'BACKEND' ? (s('postDeployCommand') ?? '') : undefined,
      internalPort:
        type === 'BACKEND' && s('internalPort')
          ? Number(s('internalPort'))
          : undefined,
      buildImage: type === 'MOBILE' ? (s('buildImage') ?? '') : undefined,
      artifactPath: type === 'MOBILE' ? (s('artifactPath') ?? '') : undefined,
      // gitToken: undefined = không đổi (chưa đụng ô), '' = xóa (gõ rồi xoá), giá trị = cập nhật
      gitToken: gitTokenTouched ? gitTokenVal.trim() : undefined,
      notifyUrl: s('notifyUrl') ?? '',
      autoDeploy: f.get('autoDeploy') === 'on',
      sleepEnabled: f.get('sleepEnabled') === 'on',
      previewEnabled: type !== 'MOBILE' ? f.get('previewEnabled') === 'on' : undefined,
      useDocker: type === 'BACKEND' ? f.get('useDocker') === 'on' : undefined,
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
        <Label htmlFor="type">Loại project</Label>
        <Select
          id="type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
        >
          <option value="STATIC">STATIC — web tĩnh (build ra file, serve qua Caddy)</option>
          <option value="BACKEND">BACKEND — chạy server có cổng (API, Next.js SSR…)</option>
        </Select>
        <p className="mt-1 text-xs text-white/30">
          Next.js/Nuxt SSR hoặc API → chọn <code>BACKEND</code> để có Lệnh chạy + Cổng. SPA (Vite/CRA)
          build ra <code>dist</code> → <code>STATIC</code>.
        </p>
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
          type="password"
          value={gitTokenVal}
          onChange={(e) => { setGitTokenVal(e.target.value); setGitTokenTouched(true); }}
          placeholder={project.hasGitToken ? '••••••••  (để trống = giữ nguyên, nhập mới = cập nhật)' : 'ghp_xxxx hoặc gitlab-token…'}
          autoComplete="off"
        />
        {project.hasGitToken && (
          <p className="mt-1 text-xs text-white/30">Nhập khoảng trắng rồi xóa để clear token.</p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="gitBranch">Branch</Label>
          {branches && branches.length > 0 ? (
            <div className="flex gap-2">
              <Select
                id="gitBranch"
                name="gitBranch"
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="flex-1"
              >
                {/* Nhánh hiện tại nếu không có trong list vẫn cho chọn */}
                {!branches.some((b) => b.name === selectedBranch) && (
                  <option value={selectedBranch}>{selectedBranch} (hiện tại)</option>
                )}
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                    {b.lastCommitAt ? ` — ${relativeVi(b.lastCommitAt)}` : ''}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                onClick={() => { setBranches(null); setBranchError(null); }}
                className="text-xs text-white/30 hover:text-white/60"
                title="Nhập tay"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                id="gitBranch"
                name="gitBranch"
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="flex-1"
              />
              <button
                type="button"
                onClick={fetchBranches}
                disabled={fetchingBranches}
                className="shrink-0 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-white/60 hover:border-white/30 hover:text-white disabled:opacity-40"
              >
                {fetchingBranches ? '…' : 'Lấy branches'}
              </button>
            </div>
          )}
          {branchError && <p className="mt-1 text-xs text-red-400">{branchError}</p>}
          {branches && branches.length > 0 && branches[0].lastCommitAt && (
            <p className="mt-1 text-xs text-emerald-400">
              {branches.length} nhánh · mới nhất: {branches[0].name} ({relativeVi(branches[0].lastCommitAt)})
            </p>
          )}
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
      {type === 'STATIC' && (
        <div>
          <Label htmlFor="outputDir">Output dir</Label>
          <Input
            id="outputDir"
            name="outputDir"
            defaultValue={project.outputDir ?? ''}
          />
        </div>
      )}

      {type === 'BACKEND' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          {/* Toggle: dùng Docker hay chạy thẳng node trên máy */}
          <div className="sm:col-span-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                name="useDocker"
                defaultChecked={project.useDocker}
                className="mt-0.5 h-4 w-4 accent-indigo-500"
              />
              <span>
                <span className="font-medium text-white/80">Dùng Docker (build từ Dockerfile)</span>
                <span className="mt-0.5 block text-xs text-white/40">
                  Bật: cần Dockerfile ở repo + Docker đang chạy. Tắt: DeployBox chạy thẳng{' '}
                  <code className="text-white/60">node</code> trên máy bằng Lệnh build + Lệnh chạy
                  (không cần Docker, nhưng không cô lập RAM/CPU).
                </span>
              </span>
            </label>
          </div>

          {/* Hooks: pre/post deploy */}
          <div className="sm:col-span-2">
            <Label htmlFor="preDeployCommand">Lệnh trước khi chạy (tuỳ chọn)</Label>
            <Input
              id="preDeployCommand"
              name="preDeployCommand"
              defaultValue={project.preDeployCommand ?? ''}
              placeholder="npx prisma migrate deploy"
            />
            <p className="mt-1 text-xs text-white/40">
              Chạy sau khi build, TRƯỚC khi start app. Hợp để migrate DB. Lỗi ở đây = deploy thất bại.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="postDeployCommand">Lệnh sau khi chạy (tuỳ chọn)</Label>
            <Input
              id="postDeployCommand"
              name="postDeployCommand"
              defaultValue={project.postDeployCommand ?? ''}
              placeholder="curl -s http://localhost:$PORT/warmup"
            />
            <p className="mt-1 text-xs text-white/40">
              Chạy SAU khi app đã sống (vd warmup). Lỗi ở đây chỉ cảnh báo, không làm deploy fail.
            </p>
          </div>
        </div>
      )}

      {type === 'MOBILE' && (
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
        {type !== 'MOBILE' && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="previewEnabled"
              defaultChecked={project.previewEnabled}
            />
            Preview mỗi Pull Request
          </label>
        )}
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
