import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import type { GitRepoDto, OAuthIdentityDto, OAuthProviderStatusDto } from '@deploybox/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { AuthService, type LoginMeta } from '../auth/auth.service';
import { GithubProvider } from './github.provider';
import { GitlabProvider } from './gitlab.provider';
import { BitbucketProvider } from './bitbucket.provider';
import type { OAuthProviderAdapter, OAuthProviderKey, OAuthUserInfo } from './provider.interface';
import type { GitProvider } from '../../generated/prisma';

/** Kho tạm trong RAM có TTL — one-time code đổi token + pending signup. */
class TtlStore<T> {
  private map = new Map<string, { v: T; exp: number }>();
  constructor(private readonly ttlMs: number) {}
  put(v: T): string {
    const key = randomBytes(24).toString('base64url');
    this.map.set(key, { v, exp: Date.now() + this.ttlMs });
    if (this.map.size > 1000) {
      const first = this.map.keys().next().value;
      if (first) this.map.delete(first);
    }
    return key;
  }
  take(key: string): T | null {
    const hit = this.map.get(key);
    if (!hit) return null;
    this.map.delete(key); // dùng 1 lần
    return hit.exp > Date.now() ? hit.v : null;
  }
}

interface PendingSignup {
  provider: OAuthProviderKey;
  info: OAuthUserInfo;
  accessToken: string;
}

interface StatePayload {
  t: 'oauth_state';
  p: OAuthProviderKey;
  m: 'login' | 'connect';
  u?: string; // userId khi mode=connect
}

const PROVIDER_TO_ENUM: Record<OAuthProviderKey, GitProvider> = {
  github: 'GITHUB',
  gitlab: 'GITLAB',
  bitbucket: 'BITBUCKET',
} as Record<OAuthProviderKey, GitProvider>;

/** Kết quả callback — controller dựa vào đây để redirect về web đúng trang. */
export type CallbackResult =
  | { kind: 'login'; exchangeCode: string } // web đổi code lấy JWT rồi set cookie
  | { kind: 'connected' } // đã link vào tài khoản đang đăng nhập
  | { kind: 'pending_signup'; pendingId: string; login: string; email: string }
  | { kind: 'error'; message: string };

@Injectable()
export class OauthService {
  private readonly logger = new Logger(OauthService.name);
  private readonly providers: Map<OAuthProviderKey, OAuthProviderAdapter>;
  /** one-time code → JWT (60s) — tránh đưa JWT lên URL */
  private readonly tokenStore = new TtlStore<string>(60_000);
  /** pending signup (user mới qua OAuth chờ nhập mã mời) — 10 phút */
  private readonly pendingStore = new TtlStore<PendingSignup>(10 * 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly flags: FeatureFlagsService,
    private readonly auth: AuthService,
    github: GithubProvider,
    gitlab: GitlabProvider,
    bitbucket: BitbucketProvider,
  ) {
    // Thêm nhà mới: đăng ký adapter vào đây là xong phần backend
    this.providers = new Map<OAuthProviderKey, OAuthProviderAdapter>([
      [github.key, github],
      [gitlab.key, gitlab],
      [bitbucket.key, bitbucket],
    ]);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private adapter(key: string): OAuthProviderAdapter {
    const a = this.providers.get(key as OAuthProviderKey);
    if (!a) throw new NotFoundException(`Chưa hỗ trợ OAuth "${key}"`);
    if (!a.configured()) {
      throw new BadRequestException(
        `OAuth ${key} chưa cấu hình (thiếu client id/secret trong .env)`,
      );
    }
    if (!this.flags.isEnabled('oauth_login')) {
      throw new BadRequestException('Đăng nhập OAuth đang tắt (Admin → Tính năng hệ thống).');
    }
    return a;
  }

  private redirectUri(provider: OAuthProviderKey): string {
    const api = this.config.get<string>('PUBLIC_API_URL', 'http://localhost:4000');
    return `${api}/api/v1/auth/oauth/${provider}/callback`;
  }

  /** URL web công khai (redirect sau OAuth). */
  webUrl(): string {
    const explicit = this.config.get<string>('PUBLIC_WEB_URL', '');
    if (explicit) return explicit.replace(/\/$/, '');
    const tls = this.config.get<string>('PUBLIC_TLS', 'false') === 'true';
    const domain = this.config.get<string>('APP_DOMAIN', 'localhost');
    return tls ? `https://${domain}` : 'http://localhost:3000';
  }

  private signState(payload: Omit<StatePayload, 't'>): string {
    return this.jwt.sign({ t: 'oauth_state', ...payload }, { expiresIn: '10m' });
  }

  private verifyState(state: string): StatePayload {
    try {
      const p = this.jwt.verify<StatePayload>(state);
      if (p.t !== 'oauth_state') throw new Error('sai loại');
      return p;
    } catch {
      throw new BadRequestException('State OAuth không hợp lệ hoặc hết hạn — thử lại');
    }
  }

  // ── public API ─────────────────────────────────────────────────────────────

  /** Trạng thái từng nhà (web quyết định hiện nút nào). */
  providerStatuses(): OAuthProviderStatusDto[] {
    const enabled = this.flags.isEnabled('oauth_login');
    const all: OAuthProviderKey[] = ['github', 'gitlab', 'bitbucket'];
    return all.map((key) => ({
      provider: key,
      configured: this.providers.get(key)?.configured() ?? false,
      enabled,
    }));
  }

  /** Bắt đầu luồng LOGIN (public) → URL provider. */
  startLogin(provider: string): string {
    const a = this.adapter(provider);
    return a.authorizeUrl(this.signState({ p: a.key, m: 'login' }), this.redirectUri(a.key));
  }

  /** Bắt đầu luồng CONNECT (đã đăng nhập) → URL provider. */
  startConnect(provider: string, userId: string): string {
    const a = this.adapter(provider);
    return a.authorizeUrl(
      this.signState({ p: a.key, m: 'connect', u: userId }),
      this.redirectUri(a.key),
    );
  }

  /** Xử lý callback từ provider. */
  async handleCallback(
    provider: string,
    code: string,
    state: string,
    meta: LoginMeta,
  ): Promise<CallbackResult> {
    let a: OAuthProviderAdapter;
    let st: StatePayload;
    try {
      a = this.adapter(provider);
      st = this.verifyState(state);
      if (st.p !== a.key) throw new BadRequestException('State không khớp provider');
    } catch (e) {
      return { kind: 'error', message: e instanceof Error ? e.message : 'OAuth lỗi' };
    }

    try {
      const tokens = await a.exchangeCode(code, this.redirectUri(a.key));
      const info = await a.fetchUser(tokens.accessToken);
      const providerEnum = PROVIDER_TO_ENUM[a.key];

      // ── CONNECT: gắn danh tính vào user đang đăng nhập ──
      if (st.m === 'connect') {
        if (!st.u) return { kind: 'error', message: 'State connect thiếu user' };
        // Danh tính này đã thuộc user KHÁC → chặn (1 GitHub chỉ link 1 tài khoản)
        const existed = await this.prisma.oAuthIdentity.findUnique({
          where: { provider_providerUserId: { provider: providerEnum, providerUserId: info.providerUserId } },
        });
        if (existed && existed.userId !== st.u) {
          return { kind: 'error', message: `Tài khoản ${a.key} @${info.login} đã liên kết với người dùng khác` };
        }
        await this.upsertIdentity(st.u, providerEnum, info, tokens.accessToken, tokens.refreshToken, tokens.expiresAt);
        return { kind: 'connected' };
      }

      // ── LOGIN ──
      const identity = await this.prisma.oAuthIdentity.findUnique({
        where: { provider_providerUserId: { provider: providerEnum, providerUserId: info.providerUserId } },
        include: { user: true },
      });
      if (identity) {
        // cập nhật token mới nhất + đăng nhập
        await this.upsertIdentity(identity.userId, providerEnum, info, tokens.accessToken, tokens.refreshToken, tokens.expiresAt);
        const res = await this.auth.issueSession(identity.user, meta);
        return { kind: 'login', exchangeCode: this.tokenStore.put(res.accessToken) };
      }

      // Chưa có danh tính → thử auto-link theo email ĐÃ VERIFIED
      if (info.email && info.emailVerified) {
        const user = await this.prisma.user.findUnique({ where: { email: info.email } });
        if (user) {
          await this.upsertIdentity(user.id, providerEnum, info, tokens.accessToken, tokens.refreshToken, tokens.expiresAt);
          const res = await this.auth.issueSession(user, meta);
          return { kind: 'login', exchangeCode: this.tokenStore.put(res.accessToken) };
        }
      } else if (info.email) {
        const user = await this.prisma.user.findUnique({ where: { email: info.email } });
        if (user) {
          return {
            kind: 'error',
            message: `Email ${info.email} đã có tài khoản nhưng ${a.key} chưa xác minh email đó — hãy đăng nhập bằng mật khẩu rồi Kết nối ${a.key} trong trang Tài khoản`,
          };
        }
      }

      // User hoàn toàn mới → tôn trọng cổng đăng ký
      if (!this.flags.isEnabled('signup_enabled')) {
        return { kind: 'error', message: 'Đăng ký tài khoản mới đang tắt' };
      }
      if (!info.email) {
        return { kind: 'error', message: `Không đọc được email từ ${a.key} — hãy công khai email hoặc đăng ký bằng email trước` };
      }
      const requiredCode = this.config.get<string>('SIGNUP_CODE', '');
      if (requiredCode) {
        // Cần mã mời → treo pending, web hỏi mã rồi gọi completeSignup
        const pendingId = this.pendingStore.put({ provider: a.key, info, accessToken: tokens.accessToken });
        return { kind: 'pending_signup', pendingId, login: info.login, email: info.email };
      }
      // Không cần mã mời → tạo luôn
      const user = await this.auth.createUserForOAuth(info.email, info.name ?? info.login, info.avatarUrl);
      await this.upsertIdentity(user.id, providerEnum, info, tokens.accessToken, tokens.refreshToken, tokens.expiresAt);
      const res = await this.auth.issueSession(user, meta);
      return { kind: 'login', exchangeCode: this.tokenStore.put(res.accessToken) };
    } catch (e) {
      this.logger.warn(`OAuth callback lỗi: ${e instanceof Error ? e.message : e}`);
      return { kind: 'error', message: e instanceof Error ? e.message : 'OAuth lỗi' };
    }
  }

  /** Hoàn tất đăng ký OAuth khi instance yêu cầu mã mời. */
  async completeSignup(
    pendingId: string,
    signupCode: string,
    meta: LoginMeta,
  ): Promise<{ accessToken: string }> {
    const pending = this.pendingStore.take(pendingId);
    if (!pending) {
      throw new BadRequestException('Phiên đăng ký đã hết hạn — bấm đăng nhập GitHub lại');
    }
    const required = this.config.get<string>('SIGNUP_CODE', '');
    if (required && signupCode !== required) {
      // trả lại pending để user gõ lại mã (không bắt OAuth lại từ đầu)
      const retryId = this.pendingStore.put(pending);
      throw new ForbiddenException(`Mã mời không đúng|${retryId}`);
    }
    const { info, provider, accessToken } = pending;
    const user = await this.auth.createUserForOAuth(info.email!, info.name ?? info.login, info.avatarUrl);
    await this.upsertIdentity(user.id, PROVIDER_TO_ENUM[provider], info, accessToken);
    const res = await this.auth.issueSession(user, meta);
    return { accessToken: res.accessToken };
  }

  /** Web đổi one-time code lấy JWT (sau redirect landing). */
  exchange(code: string): { accessToken: string } {
    const token = this.tokenStore.take(code);
    if (!token) throw new BadRequestException('Code đã dùng hoặc hết hạn — đăng nhập lại');
    return { accessToken: token };
  }

  private async upsertIdentity(
    userId: string,
    provider: GitProvider,
    info: OAuthUserInfo,
    accessToken: string,
    refreshToken?: string,
    expiresAt?: Date,
  ): Promise<void> {
    await this.prisma.oAuthIdentity.upsert({
      where: { provider_providerUserId: { provider, providerUserId: info.providerUserId } },
      update: {
        userId,
        login: info.login,
        accessTokenEnc: this.crypto.encrypt(accessToken),
        refreshTokenEnc: refreshToken ? this.crypto.encrypt(refreshToken) : null,
        tokenExpiresAt: expiresAt ?? null,
      },
      create: {
        userId,
        provider,
        providerUserId: info.providerUserId,
        login: info.login,
        accessTokenEnc: this.crypto.encrypt(accessToken),
        refreshTokenEnc: refreshToken ? this.crypto.encrypt(refreshToken) : null,
        tokenExpiresAt: expiresAt ?? null,
      },
    });
  }

  // ── identities + repos + webhook ───────────────────────────────────────────

  async listIdentities(userId: string): Promise<OAuthIdentityDto[]> {
    const rows = await this.prisma.oAuthIdentity.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      provider: r.provider.toLowerCase() as OAuthProviderKey,
      login: r.login,
      connectedAt: r.createdAt.toISOString(),
    }));
  }

  async unlink(userId: string, provider: string): Promise<{ ok: true }> {
    const providerEnum = PROVIDER_TO_ENUM[provider as OAuthProviderKey];
    if (!providerEnum) throw new NotFoundException('Provider không hợp lệ');
    const [user, count] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
      this.prisma.oAuthIdentity.count({ where: { userId } }),
    ]);
    // Không cho tự khoá mình ngoài cửa: phải còn mật khẩu hoặc 1 danh tính khác
    if (!user?.passwordHash && count <= 1) {
      throw new BadRequestException(
        'Không thể gỡ liên kết cuối cùng khi tài khoản chưa đặt mật khẩu — đặt mật khẩu trước đã.',
      );
    }
    await this.prisma.oAuthIdentity.deleteMany({ where: { userId, provider: providerEnum } });
    return { ok: true };
  }

  private async identityToken(userId: string, provider: string): Promise<string> {
    const providerEnum = PROVIDER_TO_ENUM[provider as OAuthProviderKey];
    const row = await this.prisma.oAuthIdentity.findFirst({
      where: { userId, provider: providerEnum },
    });
    if (!row) {
      throw new BadRequestException(
        `Chưa kết nối ${provider} — vào Tài khoản → Kết nối ${provider} trước`,
      );
    }
    // Token sắp/đã hết hạn (GitLab 2h, Bitbucket 2h) → tự xoay bằng refresh token
    const expiringSoon =
      row.tokenExpiresAt && row.tokenExpiresAt.getTime() < Date.now() + 60_000;
    if (expiringSoon && row.refreshTokenEnc) {
      const a = this.providers.get(provider as OAuthProviderKey);
      if (a?.refresh) {
        try {
          const t = await a.refresh(this.crypto.decrypt(row.refreshTokenEnc));
          await this.prisma.oAuthIdentity.update({
            where: { id: row.id },
            data: {
              accessTokenEnc: this.crypto.encrypt(t.accessToken),
              refreshTokenEnc: t.refreshToken ? this.crypto.encrypt(t.refreshToken) : row.refreshTokenEnc,
              tokenExpiresAt: t.expiresAt ?? null,
            },
          });
          return t.accessToken;
        } catch {
          throw new BadRequestException(
            `Token ${provider} hết hạn và không làm mới được — vào Tài khoản kết nối lại`,
          );
        }
      }
    }
    return this.crypto.decrypt(row.accessTokenEnc);
  }

  /** Repos của user qua danh tính đã kết nối (cho picker tạo project). */
  async listRepos(userId: string, provider: string): Promise<GitRepoDto[]> {
    const a = this.adapter(provider);
    const token = await this.identityToken(userId, provider);
    return a.listRepos(token);
  }

  /** Tạo webhook tự động cho project (sau khi tạo project từ repo picker). */
  async setupWebhook(userId: string, provider: string, projectId: string): Promise<{ ok: true }> {
    const a = this.adapter(provider);
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project?.gitRepoUrl) throw new NotFoundException('Project không có repo URL');
    // quyền: user phải thuộc team
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Bạn không thuộc team này');
    if (!project.webhookSecret) throw new BadRequestException('Project chưa có webhook secret');

    // Lấy path đầy đủ từ URL (hỗ trợ GitLab subgroup: group/sub/repo)
    let fullName: string;
    try {
      fullName = new URL(project.gitRepoUrl).pathname.replace(/^\//, '').replace(/\.git$/, '');
    } catch {
      const m = project.gitRepoUrl.match(/[:/]([^/]+\/[^/]+?)(\.git)?$/);
      if (!m) throw new BadRequestException('Không đọc được owner/repo từ URL');
      fullName = m[1];
    }
    if (!fullName.includes('/')) throw new BadRequestException('URL repo không hợp lệ');
    const token = await this.identityToken(userId, provider);
    const api = this.config.get<string>('PUBLIC_API_URL', 'http://localhost:4000');
    await a.createWebhook(
      token,
      fullName,
      `${api}/api/v1/webhooks/git/${project.id}`,
      project.webhookSecret,
    );
    await this.prisma.project.update({
      where: { id: project.id },
      data: { gitProvider: PROVIDER_TO_ENUM[a.key] },
    }).catch(() => undefined);
    return { ok: true };
  }
}
