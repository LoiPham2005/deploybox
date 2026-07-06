import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  OAuthProviderAdapter,
  OAuthRepo,
  OAuthTokens,
  OAuthUserInfo,
} from './provider.interface';

const API = 'https://api.bitbucket.org/2.0';

/**
 * Bitbucket Cloud OAuth (OAuth consumer).
 * Lưu ý: scope đặt TRÊN consumer (không nằm trong URL) — khi tạo consumer phải tick:
 * Account:Read, Email, Repositories:Read, Webhooks:Read and write.
 * Access token sống ~2 giờ → có refresh token (service tự xoay).
 */
@Injectable()
export class BitbucketProvider implements OAuthProviderAdapter {
  readonly key = 'bitbucket' as const;

  constructor(private readonly config: ConfigService) {}

  private id(): string {
    return this.config.get<string>('BITBUCKET_OAUTH_CLIENT_ID', '');
  }
  private secret(): string {
    return this.config.get<string>('BITBUCKET_OAUTH_CLIENT_SECRET', '');
  }

  configured(): boolean {
    return !!(this.id() && this.secret());
  }

  authorizeUrl(state: string, _redirectUri: string): string {
    // redirect_uri cố định theo consumer đã đăng ký — Bitbucket không nhận qua URL
    const q = new URLSearchParams({
      client_id: this.id(),
      response_type: 'code',
      state,
    });
    return `https://bitbucket.org/site/oauth2/authorize?${q.toString()}`;
  }

  private async tokenRequest(body: URLSearchParams): Promise<OAuthTokens> {
    const basic = Buffer.from(`${this.id()}:${this.secret()}`).toString('base64');
    const res = await fetch('https://bitbucket.org/site/oauth2/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const b = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!b.access_token) {
      throw new BadRequestException(`Bitbucket từ chối: ${b.error_description ?? 'không rõ'}`);
    }
    return {
      accessToken: b.access_token,
      refreshToken: b.refresh_token,
      expiresAt: b.expires_in ? new Date(Date.now() + b.expires_in * 1000) : undefined,
    };
  }

  exchangeCode(code: string, _redirectUri: string): Promise<OAuthTokens> {
    return this.tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', code }));
  }

  refresh(refreshToken: string): Promise<OAuthTokens> {
    return this.tokenRequest(
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    );
  }

  private async bb<T>(url: string, token: string): Promise<T> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new BadRequestException(`Bitbucket API lỗi ${res.status}`);
    return res.json() as Promise<T>;
  }

  async fetchUser(accessToken: string): Promise<OAuthUserInfo> {
    const u = await this.bb<{
      uuid: string; username?: string; nickname?: string;
      display_name: string | null; links?: { avatar?: { href?: string } };
    }>(`${API}/user`, accessToken);
    let email: string | null = null;
    let emailVerified = false;
    try {
      const emails = await this.bb<{
        values: Array<{ email: string; is_primary: boolean; is_confirmed: boolean }>;
      }>(`${API}/user/emails`, accessToken);
      const primary =
        emails.values.find((e) => e.is_primary) ?? emails.values.find((e) => e.is_confirmed);
      if (primary) {
        email = primary.email;
        emailVerified = primary.is_confirmed;
      }
    } catch {
      /* thiếu scope Email → không auto-link */
    }
    return {
      providerUserId: u.uuid,
      login: u.username ?? u.nickname ?? 'bitbucket-user',
      email,
      emailVerified,
      name: u.display_name,
      avatarUrl: u.links?.avatar?.href ?? null,
    };
  }

  async listRepos(accessToken: string): Promise<OAuthRepo[]> {
    const all: OAuthRepo[] = [];
    let url = `${API}/repositories?role=member&sort=-updated_on&pagelen=100`;
    for (let i = 0; i < 2 && url; i++) {
      const page = await this.bb<{
        values: Array<{
          full_name: string; is_private: boolean; description: string | null;
          updated_on: string; mainbranch?: { name?: string } | null;
          links?: { html?: { href?: string } };
        }>;
        next?: string;
      }>(url, accessToken);
      all.push(
        ...page.values.map((r) => ({
          fullName: r.full_name,
          url: r.links?.html?.href ?? `https://bitbucket.org/${r.full_name}`,
          private: r.is_private,
          defaultBranch: r.mainbranch?.name ?? 'main',
          description: r.description,
          updatedAt: r.updated_on,
        })),
      );
      url = page.next ?? '';
    }
    return all;
  }

  async createWebhook(
    accessToken: string,
    repoFullName: string,
    hookUrl: string,
    secret: string,
  ): Promise<void> {
    const res = await fetch(`${API}/repositories/${repoFullName}/hooks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: 'DeployBox auto-deploy',
        url: hookUrl,
        active: true,
        secret, // Bitbucket ký X-Hub-Signature (sha256) — khớp xác thực DeployBox
        events: ['repo:push'],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new BadRequestException(
        `Tạo webhook Bitbucket lỗi ${res.status}: ${b.error?.message ?? ''}`,
      );
    }
  }
}
