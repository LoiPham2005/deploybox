'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Sparkles } from 'lucide-react';
import type {
  AiProjectSuggestion,
  AiRepoApp,
  CreateProjectDto,
  GitRepoDto,
  ProjectType,
  ServerDto,
} from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { RemoteBranch } from './actions';

/** "2 ngày trước", "3 giờ trước"… từ ISO date */
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

/** Link tạo token cho từng provider — mở thẳng trang tạo + ghi rõ scope cần chọn */
const TOKEN_GUIDES = [
  {
    id: 'github',
    emoji: '🐙',
    name: 'GitHub',
    url: 'https://github.com/settings/personal-access-tokens/new',
    scope: 'Fine-grained → Repository access → Contents: Read',
  },
  {
    id: 'gitlab',
    emoji: '🦊',
    name: 'GitLab',
    url: 'https://gitlab.com/-/user_settings/personal_access_tokens',
    scope: 'Scope: read_repository',
  },
  {
    id: 'bitbucket',
    emoji: '🪣',
    name: 'Bitbucket',
    url: 'https://bitbucket.org/account/settings/app-passwords/',
    scope: 'App password → Repositories: Read',
  },
] as const;

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
  { label: 'Next.js (static export)', type: 'STATIC', buildCommand: 'npm run build && npm run export', outputDir: 'out' },
  { label: 'Next.js SSR (standalone)', type: 'BACKEND',
    buildCommand: 'npm run build && cp -r .next/static .next/standalone/.next/ && (cp -r public .next/standalone/ 2>/dev/null || true)',
    startCommand: 'HOSTNAME=0.0.0.0 node .next/standalone/server.js', internalPort: 3000 },
  { label: 'Vue / Nuxt static', type: 'STATIC',  buildCommand: 'npm run generate',         outputDir: '.output/public' },
  { label: 'Node / Express',    type: 'BACKEND', buildCommand: 'npm run build',           startCommand: 'node dist/index.js', internalPort: 3000 },
  { label: 'Python / FastAPI',  type: 'BACKEND', startCommand: 'uvicorn main:app --host 0.0.0.0 --port 8000', internalPort: 8000 },
  { label: 'Flutter APK',       type: 'MOBILE',  buildCommand: 'flutter build apk --release', buildImage: 'cirrusci/flutter:stable', artifactPath: 'build/app/outputs/flutter-apk/app-release.apk' },
  { label: 'Flutter AAB',       type: 'MOBILE',  buildCommand: 'flutter build appbundle --release', buildImage: 'cirrusci/flutter:stable', artifactPath: 'build/app/outputs/bundle/release/app-release.aab' },
];

const PICKER_LABELS: Record<string, string> = {
  github: '🐙 GitHub',
  gitlab: '🦊 GitLab',
  bitbucket: '🪣 Bitbucket',
};

export function NewProjectForm({
  teamId,
  servers = [],
  oauthConnected = [],
}: {
  teamId: string;
  servers?: ServerDto[];
  oauthConnected?: string[]; // các nhà OAuth user đã kết nối ('github'…)
}) {
  const router = useRouter();
  const [type, setType] = useState<ProjectType>('STATIC');
  const [serverId, setServerId] = useState<string>(() => servers[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [templateApplied, setTemplateApplied] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [gitRepoUrl, setGitRepoUrl] = useState('');
  const [gitToken, setGitToken] = useState('');
  const [authMode, setAuthMode] = useState('auto');
  const [gitUsername, setGitUsername] = useState('');
  const [branches, setBranches] = useState<RemoteBranch[] | null>(null);
  const [selectedBranch, setSelectedBranch] = useState('main');
  const [fetchingBranches, setFetchingBranches] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [rootDir, setRootDir] = useState('.');
  // Repo picker qua OAuth (nhà nào đã kết nối thì có nút)
  const [ghRepos, setGhRepos] = useState<GitRepoDto[] | null>(null);
  const [ghOpenProvider, setGhOpenProvider] = useState<string | null>(null);
  const [ghLoading, setGhLoading] = useState(false);
  const [ghError, setGhError] = useState<string | null>(null);
  const [ghFilter, setGhFilter] = useState('');
  const [pickedProvider, setPickedProvider] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AiProjectSuggestion | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Nhận diện provider từ URL để gợi ý
  const provider = /github\.com/i.test(gitRepoUrl)
    ? 'github'
    : /gitlab/i.test(gitRepoUrl)
    ? 'gitlab'
    : /bitbucket/i.test(gitRepoUrl)
    ? 'bitbucket'
    : null;

  async function fetchBranches() {
    if (!gitRepoUrl.trim()) return;
    setFetchingBranches(true);
    setBranchError(null);
    setBranches(null);
    const { fetchBranchesAction } = await import('./actions');
    const res = await fetchBranchesAction(
      gitRepoUrl.trim(),
      gitToken.trim() || undefined,
      authMode,
      gitUsername.trim() || undefined,
    );
    setFetchingBranches(false);
    if (res.ok && res.data) {
      setBranches(res.data);
      // Danh sách đã sort theo ngày commit (mới nhất đầu) → chọn nhánh mới nhất
      if (res.data[0]) setSelectedBranch(res.data[0].name);
    } else if (!res.ok) {
      setBranchError(res.error);
    }
  }

  /** ✨ AI đọc repo → tự điền type + các ô cấu hình. */
  async function analyzeRepo() {
    if (!gitRepoUrl.trim()) return;
    setAnalyzing(true);
    setAiError(null);
    setAiSuggestion(null);
    const { analyzeRepoAction } = await import('./actions');
    const res = await analyzeRepoAction(
      gitRepoUrl.trim(),
      gitToken.trim() || undefined,
      branches ? selectedBranch : undefined, // chỉ gửi branch khi user đã chọn từ danh sách thật
      authMode,
      gitUsername.trim() || undefined,
    );
    setAnalyzing(false);
    if (!res.ok) {
      setAiError(res.error);
      return;
    }
    const s = res.data!;
    setAiSuggestion(s);
    setType(s.type);
    setRootDir(s.rootDir || '.');
    setTemplateApplied(null);
    setFields({
      buildCommand: s.buildCommand,
      outputDir: s.outputDir,
      startCommand: s.startCommand,
      internalPort: String(s.internalPort || 3000),
      buildImage: s.buildImage,
      artifactPath: s.artifactPath,
    });
  }

  /** Monorepo: điền form theo 1 app con được chọn. */
  function applyRepoApp(app: AiRepoApp) {
    setType(app.type);
    setRootDir(app.rootDir || '.');
    setTemplateApplied(null);
    setFields((f) => ({
      ...f,
      buildCommand: app.buildCommand,
      startCommand: app.startCommand,
      outputDir: app.outputDir,
      internalPort: String(app.internalPort || 3000),
    }));
  }

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
      gitRepoUrl: gitRepoUrl.trim() || undefined,
      gitBranch: selectedBranch || str('gitBranch') || 'main',
      rootDir: str('rootDir') ?? '.',
      gitToken: gitToken.trim() || undefined,
      buildCommand: str('buildCommand'),
      outputDir: type === 'STATIC' ? str('outputDir') : undefined,
      startCommand: type === 'BACKEND' ? str('startCommand') : undefined,
      internalPort:
        type === 'BACKEND' && portRaw ? Number(portRaw) : undefined,
      buildImage: type === 'MOBILE' ? str('buildImage') : undefined,
      artifactPath: type === 'MOBILE' ? str('artifactPath') : undefined,
      serverId: serverId || undefined,
      // Lưu env app cần (AI đọc từ repo) → cảnh báo thiếu env trước mỗi deploy
      requiredEnvKeys: aiSuggestion?.envKeys?.length ? aiSuggestion.envKeys : undefined,
    };

    setLoading(true);
    const { createProjectAction, setupOauthWebhookAction } = await import('./actions');
    const res = await createProjectAction(teamId, dto);
    if (res.ok && res.data) {
      // Repo chọn từ GitHub picker → tự gắn webhook auto-deploy (best-effort)
      if (pickedProvider) {
        await setupOauthWebhookAction(pickedProvider, res.data.id).catch(() => undefined);
      }
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

      {servers.length > 0 && (
        <div>
          <Label htmlFor="serverId">Server deploy</Label>
          <Select
            id="serverId"
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
          >
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.type}{s.type === 'REMOTE' ? ` — ${s.host}` : ''})
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-white/30">
            Chọn server sẽ chạy quá trình build và deploy.
          </p>
        </div>
      )}

      <div>
        <Label htmlFor="gitRepoUrl">Git repo URL (tùy chọn)</Label>

        {/* Chọn repo từ nhà đã kết nối — tự điền URL + nhánh, tự gắn webhook sau khi tạo */}
        {oauthConnected.length > 0 ? (
          <div className="mb-2">
            <div className="flex flex-wrap gap-1.5">
              {oauthConnected.map((prov) => (
                <button
                  key={prov}
                  type="button"
                  disabled={ghLoading}
                  onClick={async () => {
                    if (ghRepos && ghOpenProvider === prov) { setGhRepos(null); setGhOpenProvider(null); return; }
                    setGhLoading(true);
                    setGhError(null);
                    setGhOpenProvider(prov);
                    const { listOauthReposAction } = await import('./actions');
                    const res = await listOauthReposAction(prov);
                    if (res.ok && res.data) setGhRepos(res.data);
                    else { setGhError(res.ok ? 'Không tải được' : res.error); setGhOpenProvider(null); }
                    setGhLoading(false);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs font-medium text-white/75 transition hover:bg-white/[0.08] disabled:opacity-50"
                >
                  {ghLoading && ghOpenProvider === prov
                    ? 'Đang tải…'
                    : ghRepos && ghOpenProvider === prov
                      ? 'Đóng danh sách'
                      : `Chọn repo ${PICKER_LABELS[prov] ?? prov}`}
                </button>
              ))}
            </div>
            {ghError && <p className="mt-1 text-xs text-red-400">{ghError}</p>}
            {ghRepos && (
              <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.02] p-2">
                <Input
                  placeholder="Lọc repo…"
                  value={ghFilter}
                  onChange={(e) => setGhFilter(e.target.value)}
                  className="mb-2"
                />
                <div className="max-h-48 space-y-0.5 overflow-y-auto">
                  {ghRepos
                    .filter((r) => r.fullName.toLowerCase().includes(ghFilter.toLowerCase()))
                    .slice(0, 50)
                    .map((r) => (
                      <button
                        key={r.fullName}
                        type="button"
                        onClick={() => {
                          setGitRepoUrl(r.url);
                          setSelectedBranch(r.defaultBranch);
                          setPickedProvider(ghOpenProvider);
                          setGhRepos(null);
                          setGhOpenProvider(null);
                          setBranches(null);
                          setAiSuggestion(null);
                        }}
                        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-white/75 hover:bg-white/5"
                      >
                        <span className="truncate">{r.fullName}</span>
                        <span className="ml-2 shrink-0 text-[10px] text-white/35">
                          {r.private ? '🔒 private' : 'public'} · {r.defaultBranch}
                        </span>
                      </button>
                    ))}
                  {ghRepos.length === 0 && (
                    <p className="px-2 py-1 text-xs text-white/30">Không có repo nào.</p>
                  )}
                </div>
              </div>
            )}
            {pickedProvider && (
              <p className="mt-1 text-[11px] text-emerald-300/80">
                ✓ Repo {PICKER_LABELS[pickedProvider] ?? pickedProvider} đã chọn — webhook auto-deploy sẽ được gắn tự động sau khi tạo.
              </p>
            )}
          </div>
        ) : (
          <p className="mb-2 text-[11px] text-white/35">
            💡 <a href="/api/oauth/connect/github" className="text-indigo-400 hover:underline">Kết nối GitHub</a>{' '}
            (hoặc GitLab/Bitbucket ở trang Tài khoản) để chọn repo từ danh sách + tự gắn webhook.
          </p>
        )}

        <Input
          id="gitRepoUrl"
          name="gitRepoUrl"
          type="url"
          placeholder="https://github.com/user/repo"
          value={gitRepoUrl}
          onChange={(e) => { setGitRepoUrl(e.target.value); setBranches(null); setBranchError(null); setAiSuggestion(null); setAiError(null); setPickedProvider(null); }}
        />

        {/* ✨ AI tự nhận diện cấu hình từ repo */}
        {gitRepoUrl.trim() && (
          <div className="mt-2">
            <button
              type="button"
              onClick={analyzeRepo}
              disabled={analyzing}
              className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50"
            >
              <Sparkles size={12} />
              {analyzing ? 'AI đang đọc repo…' : 'Tự nhận diện cấu hình (AI)'}
            </button>
            {aiError && <p className="mt-1.5 text-xs text-red-400">{aiError}</p>}
            {aiSuggestion && (
              <div className="mt-2 rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5 text-xs">
                <p className="text-sky-300">
                  ✨ Nhận diện: <b>{aiSuggestion.framework}</b> ({aiSuggestion.type})
                  {aiSuggestion.rootDir !== '.' && (
                    <> · thư mục <code>{aiSuggestion.rootDir}</code></>
                  )}
                  {' '}— đã điền sẵn các ô bên dưới, kiểm tra lại rồi bấm Tạo.
                </p>
                {aiSuggestion.reason && (
                  <p className="mt-1 text-white/40">{aiSuggestion.reason}</p>
                )}
                {aiSuggestion.envKeys.length > 0 && (
                  <p className="mt-1 text-amber-300/80">
                    ⚠️ App cần biến môi trường:{' '}
                    <code>{aiSuggestion.envKeys.join(', ')}</code> — thêm ở tab Env sau
                    khi tạo.
                  </p>
                )}
                {(aiSuggestion.secretWarnings?.length ?? 0) > 0 && (
                  <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 p-2">
                    <p className="font-medium text-red-300">🚨 Secret bị lộ trong repo:</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-red-200/80">
                      {aiSuggestion.secretWarnings!.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(aiSuggestion.apps?.length ?? 0) >= 2 && (
                  <div className="mt-2 rounded-md border border-indigo-500/30 bg-indigo-500/10 p-2">
                    <p className="font-medium text-indigo-300">
                      🗂 Monorepo: phát hiện {aiSuggestion.apps!.length} app trong repo này
                    </p>
                    <p className="mt-0.5 text-white/40">
                      Mỗi lần tạo 1 project — bấm chọn app để điền form, tạo xong quay lại
                      tạo tiếp app còn lại (cùng repo URL).
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {aiSuggestion.apps!.map((a) => (
                        <button
                          key={a.rootDir + a.name}
                          type="button"
                          onClick={() => applyRepoApp(a)}
                          className="rounded-full border border-indigo-400/40 px-2.5 py-0.5 text-[11px] text-indigo-200 hover:bg-indigo-500/20"
                        >
                          {a.name} · {a.type} · {a.rootDir}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="gitToken">
          Git Access Token (để trống nếu repo public)
          {provider && (
            <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-normal capitalize text-white/50">
              {provider}
            </span>
          )}
        </Label>
        <Input
          id="gitToken"
          name="gitToken"
          type="password"
          placeholder="ghp_… / github_pat_… / glpat-… / ATCTT… (Bitbucket)"
          autoComplete="off"
          value={gitToken}
          onChange={(e) => { setGitToken(e.target.value); setBranches(null); setBranchError(null); }}
        />

        {/* Auth mode selector — hiện khi đã nhập token */}
        {gitToken.trim() && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="shrink-0 text-xs text-white/30">Kiểu xác thực:</span>
            <div className="flex flex-wrap gap-1">
              {[
                { value: 'auto',           label: 'Tự động',        hint: 'Tự detect theo prefix token + host repo' },
                { value: 'x-access-token', label: 'GitHub (PAT)',   hint: 'GitHub fine-grained github_pat_… & classic ghp_…' },
                { value: 'oauth2',         label: 'GitLab / oauth2', hint: 'GitLab glpat-… hoặc GitHub classic' },
                { value: 'x-token-auth',   label: 'Bitbucket token', hint: 'Bitbucket access token ATCTT…' },
                { value: 'basic',          label: 'User + token',    hint: 'Bitbucket app password / GitLab deploy token (cần username)' },
              ].map((m) => (
                <button
                  key={m.value}
                  type="button"
                  title={m.hint}
                  onClick={() => { setAuthMode(m.value); setBranches(null); setBranchError(null); }}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                    authMode === m.value
                      ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                      : 'border-white/10 text-white/35 hover:border-white/25 hover:text-white/60'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Username field — bắt buộc cho mode 'basic' (Bitbucket app password) */}
        {gitToken.trim() && authMode === 'basic' && (
          <div className="mt-2">
            <Input
              placeholder="Git username (VD: tên Bitbucket của bạn)"
              autoComplete="off"
              value={gitUsername}
              onChange={(e) => { setGitUsername(e.target.value); setBranches(null); setBranchError(null); }}
            />
            <p className="mt-1 text-[10px] text-amber-400/70">
              Bitbucket app password cần đúng username (không phải email).
            </p>
          </div>
        )}

        {/* Hướng dẫn lấy token — bấm mở thẳng trang tạo của từng provider */}
        <div className="mt-2.5">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-white/25">
            Chưa có token? Bấm để lấy:
          </p>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {TOKEN_GUIDES.map((g) => (
              <a
                key={g.id}
                href={g.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`group flex items-start gap-2 rounded-lg border px-2.5 py-2 transition ${
                  provider === g.id
                    ? 'border-indigo-500/50 bg-indigo-500/10'
                    : 'border-white/8 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                }`}
              >
                <span className="mt-0.5 shrink-0 text-sm">{g.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-xs font-medium text-white/70 group-hover:text-white">
                    {g.name}
                    <ExternalLink size={10} className="text-white/30 group-hover:text-white/50" />
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-tight text-white/30">
                    {g.scope}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="gitBranch">Branch</Label>
          {branches && branches.length > 0 ? (
            <div className="flex gap-2">
              <Select
                id="gitBranch"
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="flex-1"
              >
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
              {gitRepoUrl.trim() && (
                <button
                  type="button"
                  onClick={fetchBranches}
                  disabled={fetchingBranches}
                  className="shrink-0 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-white/60 hover:border-white/30 hover:text-white disabled:opacity-40"
                >
                  {fetchingBranches ? '…' : 'Lấy branches'}
                </button>
              )}
            </div>
          )}
          {branchError && <p className="mt-1 text-xs text-red-400">{branchError}</p>}
          {branches && branches.length > 0 && (
            <p className="mt-1 text-xs text-emerald-400">
              {branches.length} nhánh
              {branches[0].lastCommitAt
                ? ` · mới nhất: ${branches[0].name} (${relativeVi(branches[0].lastCommitAt)})`
                : ' (đã sort theo ngày commit)'}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="rootDir">Thư mục gốc</Label>
          <Input
            id="rootDir"
            name="rootDir"
            value={rootDir}
            onChange={(e) => setRootDir(e.target.value)}
          />
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
