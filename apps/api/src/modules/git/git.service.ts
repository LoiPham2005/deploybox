import { BadRequestException, Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

@Injectable()
export class GitService {
  private injectToken(repoUrl: string, token: string): string {
    try {
      const u = new URL(repoUrl);
      u.username = 'oauth2';
      u.password = token;
      return u.toString();
    } catch {
      return repoUrl;
    }
  }

  async listBranches(repoUrl: string, gitToken?: string): Promise<string[]> {
    const url = gitToken ? this.injectToken(repoUrl, gitToken) : repoUrl;
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-remote', '--heads', url],
        {
          timeout: 15_000,
          // Tắt prompt tương tác — nếu auth fail sẽ throw ngay
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        },
      );
      return stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\t')[1]?.replace('refs/heads/', '') ?? '')
        .filter(Boolean);
    } catch {
      throw new BadRequestException(
        'Không thể kết nối repo. Kiểm tra URL và access token.',
      );
    }
  }
}
