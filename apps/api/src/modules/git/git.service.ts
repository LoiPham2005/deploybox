import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildGitAuthUrl, type GitAuthMode } from '../../common/git-auth.util';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

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

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

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
