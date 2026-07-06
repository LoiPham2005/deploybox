import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  OAuthProviderAdapter,
  OAuthRepo,
  OAuthTokens,
  OAuthUserInfo,
} from './provider.interface';

/**
 * GitLab OAuth (gitlab.com; đổi GITLAB_OAUTH_BASE_URL nếu self-host).
 * Khác GitHub: access token CHỈ sống 2 giờ → có refresh token (service tự xoay).
 */
@Injectable()
export class GitlabProvider implements OAuthProviderAdapter {
  readonly key = 'gitlab' as const;

  constructor(private readonly config: ConfigService) {}

  private base(): string {
    return this.config
      .get<string>('GITLAB_OAUTH_BASE_URL', 'https://gitlab.com')
      .replace(/\/$/, '');
  }
  private id(): string {
    return this.config.get<string>('GITLAB_OAUTH_CLIENT_ID', '');
  }
  private secret(): string {
    return this.config.get<string>('GITLAB_OAUTH_CLIENT_SECRET', '');
  }

  configured(): boolean {
    return !!(this.id() && this.secret());
  }

  authorizeUrl(state: string, redirectUri: string): string {
    const q = new URLSearchParams({
      client_id: this.id(),
      redirect_uri: redirectUri,
      response_type: 'code',
      // api: đọc repo + tạo webhook; read_user: hồ sơ + email
      scope: 'api read_user',
      state,
    });
    return `${this.base()}/oauth/authorize?${q.toString()}`;
  }

  private async tokenRequest(body: Record<string, string>): Promise<OAuthTokens> {
    const res = await fetch(`${this.base()}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: this.id(), client_secret: this.secret(), ...body }),
      signal: AbortSignal.timeout(10_000),
    });
    const b = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      created_at?: number;
      error_description?: string;
    };
    if (!b.access_token) {
      throw new BadRequestException(`GitLab từ chối: ${b.error_description ?? 'không rõ'}`);
    }
    const baseMs = (b.created_at ? b.created_at * 1000 : Date.now());
    return {
      accessToken: b.access_token,
      refreshToken: b.refresh_token,
      expiresAt: b.expires_in ? new Date(baseMs + b.expires_in * 1000) : undefined,
    };
  }

  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    return this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  }

  refresh(refreshToken: string): Promise<OAuthTokens> {
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  private async gl<T>(path: string, token: string): Promise<T> {
    const res = await fetch(`${this.base()}/api/v4${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new BadRequestException(`GitLab API ${path} lỗi ${res.status}`);
    return res.json() as Promise<T>;
  }

  async fetchUser(accessToken: string): Promise<OAuthUserInfo> {
    const u = await this.gl<{
      id: number; username: string; name: string | null;
      email: string | null; avatar_url: string | null; confirmed_at?: string | null;
    }>('/user', accessToken);
    let email = u.email;
    // /user của chính mình trả primary email; verified = tài khoản đã confirm
    let emailVerified = !!u.confirmed_at;
    try {
      const emails = await this.gl<Array<{ email: string; confirmed_at: string | null }>>(
        '/user/emails',
        accessToken,
      );
      const confirmed = emails.find((e) => e.email === email && e.confirmed_at)
        ?? emails.find((e) => e.confirmed_at);
      if (confirmed) {
        email = confirmed.email;
        emailVerified = true;
      }
    } catch {
      /* thiếu quyền → giữ kết quả từ /user */
    }
    return {
      providerUserId: String(u.id),
      login: u.username,
      email,
      emailVerified,
      name: u.name,
      avatarUrl: u.avatar_url,
    };
  }

  async listRepos(accessToken: string): Promise<OAuthRepo[]> {
    const all: OAuthRepo[] = [];
    for (const page of [1, 2]) {
      const rows = await this.gl<
        Array<{
          path_with_namespace: string; web_url: string; visibility: string;
          default_branch: string | null; description: string | null; last_activity_at: string;
        }>
      >(`/projects?membership=true&order_by=last_activity_at&per_page=100&page=${page}`, accessToken);
      all.push(
        ...rows.map((r) => ({
          fullName: r.path_with_namespace,
          url: r.web_url,
          private: r.visibility !== 'public',
          defaultBranch: r.default_branch ?? 'main',
          description: r.description,
          updatedAt: r.last_activity_at,
        })),
      );
      if (rows.length < 100) break;
    }
    return all;
  }

  async createWebhook(
    accessToken: string,
    repoFullName: string, // path đầy đủ, hỗ trợ subgroup: group/sub/repo
    hookUrl: string,
    secret: string,
  ): Promise<void> {
    const res = await fetch(
      `${this.base()}/api/v4/projects/${encodeURIComponent(repoFullName)}/hooks`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: hookUrl,
          token: secret, // DeployBox xác thực qua header X-Gitlab-Token
          push_events: true,
          merge_requests_events: true,
          enable_ssl_verification: true,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { message?: unknown };
      throw new BadRequestException(
        `Tạo webhook GitLab lỗi ${res.status}: ${JSON.stringify(b.message ?? '')}`,
      );
    }
  }
}
