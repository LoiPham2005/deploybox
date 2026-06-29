/**
 * Logic xác thực Git HTTPS dùng chung cho cả việc lấy branches (GitService)
 * và clone khi deploy (BuildRunnerService). Hỗ trợ GitHub, GitLab, Bitbucket.
 */

export type GitAuthMode =
  | 'auto'
  | 'x-access-token' // GitHub App / fine-grained PAT
  | 'oauth2' // GitHub classic PAT / GitLab PAT
  | 'x-token-auth' // Bitbucket access token
  | 'basic' // username:password — Bitbucket app password, GitLab deploy token
  | 'token-as-user'; // token làm username

/**
 * Tự detect kiểu xác thực theo prefix token + host repo.
 * Prefix tin cậy hơn host nên check trước.
 */
export function detectGitAuthMode(token: string, host: string): GitAuthMode {
  // 1. Theo prefix token (chính xác nhất)
  if (token.startsWith('github_pat_')) return 'x-access-token'; // GitHub fine-grained
  if (/^gh[pousr]_/.test(token)) return 'oauth2'; // GitHub classic/oauth/server/refresh
  if (token.startsWith('glpat-')) return 'oauth2'; // GitLab PAT
  if (token.startsWith('ATCTT') || token.startsWith('ATBB')) return 'x-token-auth'; // Bitbucket/Atlassian

  // 2. Theo host (fallback khi prefix lạ — VD token tự host GitLab/Gitea)
  const h = host.toLowerCase();
  if (h.includes('github.com')) return 'x-access-token';
  if (h.includes('gitlab')) return 'oauth2';
  if (h.includes('bitbucket')) return 'x-token-auth';

  // 3. Mặc định an toàn (GitHub-style)
  return 'x-access-token';
}

/**
 * Chèn credential vào URL HTTPS theo mode.
 * @param username Tùy chọn — bắt buộc cho mode 'basic' (VD Bitbucket app password).
 */
export function buildGitAuthUrl(
  repoUrl: string,
  token?: string | null,
  mode: GitAuthMode = 'auto',
  username?: string,
): string {
  if (!token) return repoUrl;
  try {
    const u = new URL(repoUrl);
    const resolvedMode = mode === 'auto' ? detectGitAuthMode(token, u.host) : mode;
    const tok = encodeURIComponent(token);

    switch (resolvedMode) {
      case 'oauth2': // GitHub classic / GitLab
        u.username = 'oauth2';
        u.password = tok;
        break;
      case 'x-token-auth': // Bitbucket access token
        u.username = 'x-token-auth';
        u.password = tok;
        break;
      case 'basic': // Bitbucket app password / GitLab deploy token (cần username)
        u.username = encodeURIComponent(username || 'git');
        u.password = tok;
        break;
      case 'token-as-user':
        u.username = tok;
        u.password = 'x-oauth-basic';
        break;
      case 'x-access-token': // GitHub fine-grained + classic (default)
      default:
        u.username = 'x-access-token';
        u.password = tok;
        break;
    }

    return u.toString();
  } catch {
    return repoUrl;
  }
}
