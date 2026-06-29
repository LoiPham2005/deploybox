import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { buildGitAuthUrl, type GitAuthMode } from '../../common/git-auth.util';

const execFileAsync = promisify(execFile);

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);

  async listBranches(
    repoUrl: string,
    gitToken?: string,
    authMode: GitAuthMode = 'auto',
    gitUsername?: string,
  ): Promise<string[]> {
    const url = buildGitAuthUrl(repoUrl, gitToken, authMode, gitUsername);
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-remote', '--heads', url],
        {
          timeout: 15_000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
        },
      );
      return stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\t')[1]?.replace('refs/heads/', '') ?? '')
        .filter(Boolean);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`git ls-remote [mode=${authMode}] failed: ${msg.slice(0, 200)}`);
      const hint =
        msg.includes('Authentication failed') || msg.includes('Invalid username')
          ? 'Token không hợp lệ hoặc không có quyền truy cập repo. Với Bitbucket app password cần nhập kèm username.'
          : msg.includes('not found') || msg.includes('does not exist') || msg.includes('Repository not found')
          ? 'Không tìm thấy repo. Kiểm tra lại URL.'
          : 'Không thể kết nối repo. Kiểm tra URL và access token.';
      throw new BadRequestException(hint);
    }
  }
}
