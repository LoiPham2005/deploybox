import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readdir, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ProjectCheckResult } from '@deploybox/shared';
import { buildGitAuthUrl, type GitAuthMode } from '../../common/git-auth.util';
import { buildRepoHints } from './repo-hints.util';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AiService } from '../../infra/ai/ai.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { scanForSecrets } from './secret-scan.util';

const execFileAsync = promisify(execFile);

const NO_PROMPT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'echo',
} as const;

export interface RemoteBranch {
  name: string;
  /** ISO date của commit cuối cùng (null nếu không lấy được) */
  lastCommitAt: string | null;
}

/** Ảnh chụp nhẹ của repo cho AI phân tích: cây file + nội dung các file chìa khóa. */
export interface RepoSnapshot {
  tree: string; // danh sách đường dẫn (tối đa 3 cấp, có giới hạn)
  files: Record<string, string>; // path → nội dung (đã cắt bớt)
  secretWarnings: string[]; // cảnh báo secret lộ (quét regex)
}

// File "chìa khóa" giúp nhận diện framework/config — đọc nếu tồn tại (mọi cấp tới depth 2)
const KEY_FILES = new Set([
  'package.json', 'pubspec.yaml', 'requirements.txt', 'pyproject.toml',
  'go.mod', 'composer.json', 'Dockerfile', 'docker-compose.yml',
  'next.config.js', 'next.config.mjs', 'next.config.ts',
  'vite.config.js', 'vite.config.ts', 'nuxt.config.ts',
  'nest-cli.json', 'angular.json', 'index.html', '.env.example', '.env.sample',
  'build.gradle', 'build.gradle.kts', // android/app/build.gradle → phát hiện flavor
  // Đọc thêm để đoán ĐÚNG lệnh build/start (vd NestJS dist/src/main, Next standalone)
  'tsconfig.json', 'tsconfig.build.json', 'schema.prisma',
  'svelte.config.js', 'astro.config.mjs', 'remix.config.js', 'Procfile',
]);
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt',
  'vendor', '__pycache__', '.dart_tool', 'Pods', '.idea', '.vscode',
]);

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly ai: AiService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /**
   * "Kiểm tra AI" trên project có sẵn: clone (token đã lưu) → quét secret + AI đọc
   * env app cần → lưu requiredEnvKeys → trả về danh sách env THIẾU + cảnh báo secret.
   */
  async checkProjectConfig(projectId: string, userId: string): Promise<ProjectCheckResult> {
    if (!this.flags.aiEnabled('ai_env_check')) {
      throw new BadRequestException('Tính năng "Kiểm tra env" đang tắt (Admin → Tính năng hệ thống).');
    }
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { envVars: { select: { key: true } } },
    });
    if (!project) throw new NotFoundException('Không tìm thấy project');
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Bạn không thuộc team này');
    if (!project.gitRepoUrl) {
      throw new BadRequestException('Project chưa có Git repo URL');
    }

    const token = project.gitToken
      ? (() => { try { return this.crypto.decrypt(project.gitToken!); } catch { return undefined; } })()
      : undefined;

    const snapshot = await this.snapshotRepo(
      project.gitRepoUrl, token, project.gitBranch, 'auto',
    );
    const suggestion = await this.ai.analyzeRepo({
      repoUrl: project.gitRepoUrl,
      branch: project.gitBranch,
      tree: snapshot.tree,
      files: snapshot.files,
      hints: buildRepoHints(snapshot.tree, snapshot.files),
    });

    const envKeys = suggestion.envKeys.slice(0, 30);
    await this.prisma.project.update({
      where: { id: projectId },
      data: { requiredEnvKeys: envKeys },
    });

    const declared = new Set(project.envVars.map((v) => v.key));
    const missingEnv = envKeys.filter((k) => !declared.has(k));

    return {
      envKeys,
      missingEnv,
      secretWarnings: snapshot.secretWarnings,
      framework: suggestion.framework,
      reason: suggestion.reason,
    };
  }

  /**
   * Lấy branches cho project đã tồn tại — dùng token đã lưu (mã hóa) của project,
   * nên không cần nhập lại token ở form Sửa cấu hình. Có check quyền team.
   */
  async listBranchesForProject(projectId: string, userId: string): Promise<RemoteBranch[]> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Không tìm thấy project');

    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Bạn không thuộc team này');

    if (!project.gitRepoUrl) {
      throw new BadRequestException('Project chưa có Git repo URL');
    }

    const token = project.gitToken
      ? (() => {
          try {
            return this.crypto.decrypt(project.gitToken!);
          } catch {
            return undefined;
          }
        })()
      : undefined;

    return this.listBranches(project.gitRepoUrl, token, 'auto');
  }

  async listBranches(
    repoUrl: string,
    gitToken?: string,
    authMode: GitAuthMode = 'auto',
    gitUsername?: string,
  ): Promise<RemoteBranch[]> {
    const url = buildGitAuthUrl(repoUrl, gitToken, authMode, gitUsername);

    // ── Cách chính: partial shallow bare clone → đọc ngày commit từng nhánh ──
    // --filter=tree:0  : chỉ tải commit object (không tải file) → nhẹ & nhanh
    // --depth 1        : chỉ tip commit mỗi nhánh (không tải lịch sử)
    // --no-single-branch: lấy TẤT CẢ nhánh, không chỉ default
    let tmp: string | null = null;
    try {
      tmp = await mkdtemp(join(tmpdir(), 'db-branches-'));
      await execFileAsync(
        'git',
        [
          'clone', '--bare', '--depth', '1', '--no-single-branch',
          '--filter=tree:0', '--no-tags', url, tmp,
        ],
        { timeout: 30_000, env: { ...process.env, ...NO_PROMPT_ENV } },
      );

      const { stdout } = await execFileAsync(
        'git',
        [
          '--git-dir', tmp, 'for-each-ref', 'refs/heads/',
          '--sort=-committerdate',
          '--format=%(refname:short)%09%(committerdate:iso-strict)',
        ],
        { timeout: 15_000 },
      );

      const branches = stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, date] = line.split('\t');
          return { name: name ?? '', lastCommitAt: date || null };
        })
        .filter((b) => b.name);

      if (branches.length) return branches;
      // clone OK nhưng không có nhánh → rơi xuống ls-remote
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Lỗi auth / không tìm thấy repo → báo ngay, không cần thử lại
      if (this.isAuthOrNotFound(msg)) throw this.friendly(msg);
      // Lỗi khác (VD server không hỗ trợ partial clone) → fallback ls-remote
      this.logger.warn(`partial clone failed, fallback ls-remote: ${msg.slice(0, 160)}`);
    } finally {
      if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }

    // ── Fallback: ls-remote (chỉ tên nhánh, không có ngày) ──
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-remote', '--heads', url],
        { timeout: 15_000, env: { ...process.env, ...NO_PROMPT_ENV } },
      );
      return stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\t')[1]?.replace('refs/heads/', '') ?? '')
        .filter(Boolean)
        .map((name) => ({ name, lastCommitAt: null }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`ls-remote failed: ${msg.slice(0, 160)}`);
      throw this.friendly(msg);
    }
  }

  /**
   * Clone nông repo → thu cây file (3 cấp) + nội dung file chìa khóa (package.json,
   * pubspec.yaml, Dockerfile…) cho AI phân tích. Tự dọn thư mục tạm.
   */
  async snapshotRepo(
    repoUrl: string,
    gitToken?: string,
    branch?: string,
    authMode: GitAuthMode = 'auto',
    gitUsername?: string,
  ): Promise<RepoSnapshot> {
    const url = buildGitAuthUrl(repoUrl, gitToken, authMode, gitUsername);
    let tmp: string | null = null;
    try {
      tmp = await mkdtemp(join(tmpdir(), 'db-analyze-'));
      await execFileAsync(
        'git',
        [
          'clone', '--depth', '1', '--no-tags',
          ...(branch ? ['--branch', branch] : []),
          url, tmp,
        ],
        { timeout: 60_000, env: { ...process.env, ...NO_PROMPT_ENV } },
      );

      const tree: string[] = [];
      const files: Record<string, string> = {};
      // File .env THẬT: chỉ quét secret bằng regex, KHÔNG đưa vào prompt AI
      const scanOnly: Record<string, string> = {};

      const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
        if (depth > 3 || tree.length >= 200) return;
        const entries = await readdir(dir).catch(() => [] as string[]);
        for (const name of entries.sort()) {
          if (tree.length >= 200) return;
          if (SKIP_DIRS.has(name)) continue;
          const abs = join(dir, name);
          const relPath = rel ? `${rel}/${name}` : name;
          const st = await stat(abs).catch(() => null);
          if (!st) continue;
          if (st.isDirectory()) {
            tree.push(relPath + '/');
            await walk(abs, relPath, depth + 1);
          } else {
            tree.push(relPath);
            // Đọc file chìa khóa (depth ≤ 3 để bắt cả android/app/build.gradle)
            if (KEY_FILES.has(name) && st.size < 200_000) {
              const content = await readFile(abs, 'utf8').catch(() => '');
              if (content) files[relPath] = content.slice(0, 4_000);
            } else if (name.startsWith('.env') && st.size < 200_000) {
              // .env thật → chỉ để quét secret, không đưa AI
              const content = await readFile(abs, 'utf8').catch(() => '');
              if (content) scanOnly[relPath] = content.slice(0, 8_000);
            }
          }
        }
      };
      await walk(tmp, '', 1);

      const treeText = tree.join('\n');
      const secretWarnings = this.flags.aiEnabled('ai_secret_scan')
        ? scanForSecrets(treeText, { ...files, ...scanOnly })
        : [];
      return { tree: treeText, files, secretWarnings };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw this.friendly(msg);
    } finally {
      if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * 📝 Danh sách commit cho release notes: from..to (2 sha) hoặc N commit mới nhất của nhánh.
   * Dùng bare clone --filter=blob:none: có đủ lịch sử commit nhưng không tải nội dung file.
   */
  async listCommits(
    repoUrl: string,
    gitToken: string | undefined,
    branch: string,
    fromSha?: string | null,
    toSha?: string | null,
  ): Promise<string[]> {
    const url = buildGitAuthUrl(repoUrl, gitToken, 'auto');
    let tmp: string | null = null;
    try {
      tmp = await mkdtemp(join(tmpdir(), 'db-commits-'));
      await execFileAsync(
        'git',
        ['clone', '--bare', '--filter=blob:none', '--no-tags', '--single-branch', '--branch', branch, url, tmp],
        { timeout: 60_000, env: { ...process.env, ...NO_PROMPT_ENV } },
      );
      const range = fromSha && toSha ? [`${fromSha}..${toSha}`] : ['-15', branch];
      const { stdout } = await execFileAsync(
        'git',
        ['--git-dir', tmp, 'log', '--oneline', '--no-decorate', ...range],
        { timeout: 30_000 },
      );
      return stdout.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 60);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw this.friendly(msg);
    } finally {
      if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  private isAuthOrNotFound(msg: string): boolean {
    return (
      msg.includes('Authentication failed') ||
      msg.includes('Invalid username') ||
      msg.includes('could not read Username') ||
      msg.includes('not found') ||
      msg.includes('does not exist') ||
      msg.includes('Repository not found')
    );
  }

  private friendly(msg: string): BadRequestException {
    const hint =
      msg.includes('Authentication failed') || msg.includes('Invalid username') || msg.includes('could not read Username')
        ? 'Token không hợp lệ hoặc không có quyền truy cập repo. Với Bitbucket app password cần nhập kèm username.'
        : msg.includes('not found') || msg.includes('does not exist') || msg.includes('Repository not found')
        ? 'Không tìm thấy repo. Kiểm tra lại URL.'
        : 'Không thể kết nối repo. Kiểm tra URL và access token.';
    return new BadRequestException(hint);
  }
}
