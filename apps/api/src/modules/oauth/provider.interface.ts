// Khuôn chung cho mọi nhà OAuth (GitHub/GitLab/Bitbucket) — thêm nhà mới =
// viết 1 adapter implement interface này + đăng ký vào PROVIDERS trong oauth.service.

export type OAuthProviderKey = 'github' | 'gitlab' | 'bitbucket';

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date; // GitHub OAuth app: không hết hạn; GitLab/Bitbucket: có
}

export interface OAuthUserInfo {
  providerUserId: string; // id bất biến phía provider
  login: string; // username hiển thị
  email: string | null;
  emailVerified: boolean; // CHỈ auto-link tài khoản khi email đã verified
  name?: string | null;
  avatarUrl?: string | null;
}

export interface OAuthRepo {
  fullName: string; // owner/repo
  url: string; // https clone/browse URL
  private: boolean;
  defaultBranch: string;
  description?: string | null;
  updatedAt?: string;
}

export interface OAuthProviderAdapter {
  readonly key: OAuthProviderKey;
  /** Đã cấu hình client id/secret trong .env chưa. */
  configured(): boolean;
  /** URL đưa user sang provider để cấp quyền. */
  authorizeUrl(state: string, redirectUri: string): string;
  /** Đổi authorization code lấy token. */
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  /** Lấy hồ sơ user (id, login, email verified). */
  fetchUser(accessToken: string): Promise<OAuthUserInfo>;
  /** Repos user truy cập được (đã sắp theo mới cập nhật). */
  listRepos(accessToken: string): Promise<OAuthRepo[]>;
  /** Tạo webhook push+PR trỏ về DeployBox cho 1 repo. */
  createWebhook(
    accessToken: string,
    repoFullName: string,
    hookUrl: string,
    secret: string,
  ): Promise<void>;
  /** Đổi refresh token lấy access token mới (GitLab/Bitbucket — token có hạn). */
  refresh?(refreshToken: string): Promise<OAuthTokens>;
}
