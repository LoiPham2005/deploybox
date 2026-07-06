import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  OAuthProviderAdapter,
  OAuthRepo,
  OAuthTokens,
  OAuthUserInfo,
} from './provider.interface';

const API = 'https://api.github.com';
const UA = 'DeployBox';

@Injectable()
export class GithubProvider implements OAuthProviderAdapter {
  readonly key = 'github' as const;

  constructor(private readonly config: ConfigService) {}

  private id(): string {
    return this.config.get<string>('GITHUB_OAUTH_CLIENT_ID', '');
  }
  private secret(): string {
    return this.config.get<string>('GITHUB_OAUTH_CLIENT_SECRET', '');
  }

  configured(): boolean {
    return !!(this.id() && this.secret());
  }

  authorizeUrl(state: string, redirectUri: string): string {
    const q = new URLSearchParams({
      client_id: this.id(),
      redirect_uri: redirectUri,
      // repo: đọc repo private + tạo webhook; user:email: lấy email verified để link tài khoản
      scope: 'repo read:user user:email',
      state,
    });
    return `https://github.com/login/oauth/authorize?${q.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: this.id(),
        client_secret: this.secret(),
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error_description?: string;
    };
    if (!body.access_token) {
      throw new BadRequestException(
        `GitHub từ chối đổi code: ${body.error_description ?? 'không rõ'}`,
      );
    }
    return { accessToken: body.access_token }; // OAuth App token: không hết hạn
  }

  private async gh<T>(path: string, token: string): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': UA,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new BadRequestException(`GitHub API ${path} lỗi ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async fetchUser(accessToken: string): Promise<OAuthUserInfo> {
    const u = await this.gh<{
      id: number; login: string; name: string | null;
      email: string | null; avatar_url: string | null;
    }>('/user', accessToken);
    // /user.email có thể null (email ẩn) → hỏi /user/emails lấy primary verified
    let email = u.email;
    let emailVerified = false;
    try {
      const emails = await this.gh<
        Array<{ email: string; primary: boolean; verified: boolean }>
      >('/user/emails', accessToken);
      const primary = emails.find((e) => e.primary) ?? emails.find((e) => e.verified);
      if (primary) {
        email = primary.email;
        emailVerified = primary.verified;
      }
    } catch {
      /* thiếu scope → dùng email công khai, coi như chưa verified */
    }
    return {
      providerUserId: String(u.id),
      login: u.login,
      email,
      emailVerified,
      name: u.name,
      avatarUrl: u.avatar_url,
    };
  }

  async listRepos(accessToken: string): Promise<OAuthRepo[]> {
    // 2 trang đầu (200 repo mới cập nhật nhất) — đủ cho picker, tránh gọi dài
    const all: OAuthRepo[] = [];
    for (const page of [1, 2]) {
      const rows = await this.gh<
        Array<{
          full_name: string; html_url: string; private: boolean;
          default_branch: string; description: string | null; updated_at: string;
        }>
      >(
        `/user/repos?sort=updated&per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`,
        accessToken,
      );
      all.push(
        ...rows.map((r) => ({
          fullName: r.full_name,
          url: r.html_url,
          private: r.private,
          defaultBranch: r.default_branch,
          description: r.description,
          updatedAt: r.updated_at,
        })),
      );
      if (rows.length < 100) break;
    }
    return all;
  }

  async createWebhook(
    accessToken: string,
    repoFullName: string,
    hookUrl: string,
    secret: string,
  ): Promise<void> {
    const res = await fetch(`${API}/repos/${repoFullName}/hooks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': UA,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'web',
        active: true,
        events: ['push', 'pull_request'],
        config: { url: hookUrl, content_type: 'json', secret },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    // 422 "Hook already exists" → coi như xong
    if (!res.ok && res.status !== 422) {
      const b = (await res.json().catch(() => ({}))) as { message?: string };
      throw new BadRequestException(`Tạo webhook GitHub lỗi: ${b.message ?? res.status}`);
    }
  }
}
