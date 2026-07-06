import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomInt, createHash } from 'crypto';
import type {
  ApiTokenDto,
  AuthResponse,
  LoginDto,
  MeResponse,
  RegisterDto,
  ResetPasswordDto,
  TwoFactorChallenge,
  UpdateMeDto,
  UserDto,
  UserRole,
  VerifyLoginOtpDto,
  VerifyRegisterDto,
} from '@deploybox/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { SessionsService } from '../../infra/sessions/sessions.service';

const OTP_TTL_MS = 10 * 60 * 1000; // mã sống 10 phút
const OTP_RESEND_MS = 60 * 1000; // 60s mới được gửi lại
const OTP_MAX_ATTEMPTS = 5;

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'team'
  );
}

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: UserRole;
  twoFactorEnabled?: boolean;
};

/** Thông tin thiết bị lúc đăng nhập (controller lấy từ request) — để ghi phiên. */
export interface LoginMeta {
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly flags: FeatureFlagsService,
    private readonly sessions: SessionsService,
  ) {}

  /** Cấp token kèm phiên đăng nhập mới (để xem thiết bị + đăng xuất từ xa).
   *  Public vì OAuth (đăng nhập GitHub…) cũng cấp phiên qua đường này. */
  async issueSession(user: UserRow, meta?: LoginMeta): Promise<AuthResponse> {
    const session = await this.sessions.create(user.id, meta?.userAgent, meta?.ip);
    return {
      user: this.toUserDto(user),
      accessToken: this.sign(user.id, user.email, session.id),
    };
  }

  /** Kiểm tra mã mời + email chưa dùng (dùng chung cho register thẳng và register OTP). */
  private async assertCanRegister(dto: RegisterDto): Promise<void> {
    // Admin có thể đóng đăng ký hoàn toàn (Admin → Tính năng hệ thống)
    if (!this.flags.isEnabled('signup_enabled')) {
      throw new ForbiddenException(
        'Đăng ký tài khoản mới đang tắt (Admin → Tính năng hệ thống).',
      );
    }
    const required = this.config.get<string>('SIGNUP_CODE', '');
    if (required && dto.signupCode !== required) {
      throw new ForbiddenException(
        'Mã mời không đúng — liên hệ admin để được cấp',
      );
    }
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email đã được sử dụng');
    }
  }

  /**
   * Tạo user qua OAuth (không mật khẩu). Caller PHẢI tự kiểm mã mời/flag trước.
   * Trả user để cấp phiên.
   */
  async createUserForOAuth(
    email: string,
    name?: string | null,
    avatarUrl?: string | null,
  ) {
    if (!this.flags.isEnabled('signup_enabled')) {
      throw new ForbiddenException(
        'Đăng ký tài khoản mới đang tắt (Admin → Tính năng hệ thống).',
      );
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email đã được sử dụng');
    const user = await this.createUserWithTeam(email, name, null);
    if (avatarUrl) {
      await this.prisma.user
        .update({ where: { id: user.id }, data: { avatarUrl } })
        .catch(() => undefined);
    }
    return user;
  }

  /** Tạo user + personal team (dùng chung cho register thẳng và verify OTP). */
  private async createUserWithTeam(
    email: string,
    name: string | null | undefined,
    passwordHash: string | null, // null = tài khoản OAuth (không mật khẩu)
  ) {
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email, name: name ?? null, passwordHash },
      });
      const base = slugify(name ?? email.split('@')[0]);
      const team = await tx.team.create({
        data: {
          name: name ? `${name}'s Team` : 'My Team',
          slug: `${base}-${u.id.slice(-6)}`,
          isPersonal: true,
        },
      });
      await tx.teamMember.create({
        data: { teamId: team.id, userId: u.id, role: 'OWNER' },
      });
      return u;
    });
  }

  async register(dto: RegisterDto, meta?: LoginMeta): Promise<AuthResponse> {
    // Server có cấu hình email → bắt buộc đi luồng OTP, chặn đăng ký thẳng (email bừa).
    if (this.mail.isConfigured()) {
      throw new BadRequestException(
        'Đăng ký cần xác thực email — hãy dùng luồng gửi mã OTP',
      );
    }
    await this.assertCanRegister(dto);
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.createUserWithTeam(dto.email, dto.name, passwordHash);
    return this.issueSession(user, meta);
  }

  // ─── OTP qua email ────────────────────────────────────────────────────────

  private genOtp(): string {
    // randomInt (crypto) an toàn hơn Math.random; khoảng [100000, 999999] luôn đủ 6 chữ số
    return String(randomInt(100000, 1000000));
  }

  private otpHash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /**
   * Tạo/ghi đè OTP cho (email, purpose), gửi mail. Chặn gửi lại trong 60s.
   * quietResend: đang trong cửa sổ 60s thì trả ok luôn (mã cũ còn hiệu lực,
   * không gửi mail mới) — dùng cho 2FA login để user bấm đăng nhập lại không bị lỗi.
   */
  private async issueOtp(
    email: string,
    purpose: 'register' | 'reset' | 'login',
    payload: string | null,
    mailTitle: string,
    mailNote: string,
    quietResend = false,
  ): Promise<{ ok: true }> {
    if (!this.mail.isConfigured()) {
      throw new BadRequestException(
        'Server chưa cấu hình email (SMTP) nên chưa dùng được tính năng này',
      );
    }
    const existing = await this.prisma.emailOtp.findUnique({
      where: { email_purpose: { email, purpose } },
    });
    if (existing && Date.now() - existing.createdAt.getTime() < OTP_RESEND_MS) {
      if (quietResend) return { ok: true };
      const wait = Math.ceil(
        (OTP_RESEND_MS - (Date.now() - existing.createdAt.getTime())) / 1000,
      );
      throw new BadRequestException(`Vui lòng đợi ${wait} giây rồi gửi lại mã`);
    }
    // Dọn rác các OTP hết hạn (best-effort)
    await this.prisma.emailOtp
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => undefined);

    const code = this.genOtp();
    await this.prisma.emailOtp.upsert({
      where: { email_purpose: { email, purpose } },
      update: {
        codeHash: this.otpHash(code),
        payload,
        attempts: 0,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        createdAt: new Date(),
      },
      create: {
        email,
        purpose,
        codeHash: this.otpHash(code),
        payload,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    await this.mail.send(
      email,
      mailTitle,
      this.mail.otpHtml({ title: mailTitle, code, note: mailNote }),
    );
    return { ok: true };
  }

  /** Đọc + kiểm OTP. Đúng thì trả row (caller xử lý tiếp và xoá row). */
  private async consumeOtp(
    email: string,
    purpose: 'register' | 'reset' | 'login',
    code: string,
  ) {
    const row = await this.prisma.emailOtp.findUnique({
      where: { email_purpose: { email, purpose } },
    });
    if (!row) {
      throw new BadRequestException('Không tìm thấy yêu cầu — hãy gửi lại mã');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      await this.prisma.emailOtp.delete({ where: { id: row.id } }).catch(() => undefined);
      throw new BadRequestException('Mã đã hết hạn — hãy gửi lại mã mới');
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      await this.prisma.emailOtp.delete({ where: { id: row.id } }).catch(() => undefined);
      throw new BadRequestException('Nhập sai quá nhiều lần — hãy gửi lại mã mới');
    }
    if (row.codeHash !== this.otpHash(code)) {
      const updated = await this.prisma.emailOtp.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      const left = OTP_MAX_ATTEMPTS - updated.attempts;
      throw new BadRequestException(
        left > 0 ? `Mã không đúng (còn ${left} lần thử)` : 'Nhập sai quá nhiều lần — hãy gửi lại mã mới',
      );
    }
    return row;
  }

  /** B1 đăng ký: kiểm tra thông tin, gửi OTP về email. User CHƯA được tạo. */
  async requestRegisterOtp(dto: RegisterDto): Promise<{ ok: true }> {
    await this.assertCanRegister(dto);
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.issueOtp(
      dto.email,
      'register',
      JSON.stringify({ name: dto.name ?? null, passwordHash }),
      'Mã xác thực đăng ký DeployBox',
      `Nhập mã bên dưới để hoàn tất đăng ký tài khoản cho <b>${dto.email}</b>.`,
    );
  }

  /** B2 đăng ký: OTP đúng → tạo tài khoản thật + đăng nhập luôn. */
  async verifyRegister(dto: VerifyRegisterDto, meta?: LoginMeta): Promise<AuthResponse> {
    const row = await this.consumeOtp(dto.email, 'register', dto.code);
    const payload = JSON.parse(row.payload ?? '{}') as {
      name: string | null;
      passwordHash: string;
    };
    if (!payload.passwordHash) {
      throw new BadRequestException('Yêu cầu đăng ký không hợp lệ — hãy đăng ký lại');
    }
    // Chống race: email có thể vừa bị đăng ký xong ở request khác
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      await this.prisma.emailOtp.delete({ where: { id: row.id } }).catch(() => undefined);
      throw new ConflictException('Email đã được sử dụng');
    }
    const user = await this.createUserWithTeam(dto.email, payload.name, payload.passwordHash);
    await this.prisma.emailOtp.delete({ where: { id: row.id } }).catch(() => undefined);
    return this.issueSession(user, meta);
  }

  /** Quên mật khẩu B1: gửi OTP nếu email tồn tại. Luôn trả ok (không lộ email nào có tài khoản). */
  async forgotPassword(email: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { ok: true };
    return this.issueOtp(
      email,
      'reset',
      null,
      'Mã đặt lại mật khẩu DeployBox',
      `Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu cho <b>${email}</b>. Nhập mã bên dưới để tiếp tục.`,
    );
  }

  /** Quên mật khẩu B2: OTP đúng → đặt mật khẩu mới. */
  async resetPassword(dto: ResetPasswordDto): Promise<{ ok: true }> {
    const row = await this.consumeOtp(dto.email, 'reset', dto.code);
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new BadRequestException('Tài khoản không còn tồn tại');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.prisma.emailOtp.delete({ where: { id: row.id } }).catch(() => undefined);
    return { ok: true };
  }

  async login(dto: LoginDto, meta?: LoginMeta): Promise<AuthResponse | TwoFactorChallenge> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (
      !user?.passwordHash ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }
    // 2FA: user bật + flag hệ thống bật + có SMTP → gửi OTP, chưa cấp token vội.
    // (SMTP hỏng thì cho đăng nhập thẳng — không khoá cửa toàn bộ user vì mail chết.)
    if (
      (user as { twoFactorEnabled?: boolean }).twoFactorEnabled &&
      this.flags.isEnabled('two_factor_auth') &&
      this.mail.isConfigured()
    ) {
      await this.issueOtp(
        user.email,
        'login',
        null,
        'Mã đăng nhập DeployBox (2FA)',
        `Ai đó vừa đăng nhập tài khoản <b>${user.email}</b> bằng đúng mật khẩu. Nếu là bạn, nhập mã bên dưới để hoàn tất. Nếu không phải bạn — đổi mật khẩu ngay.`,
        true, // trong 60s đăng nhập lại → dùng mã cũ, không lỗi
      );
      return { requires2fa: true };
    }
    return this.issueSession(user, meta);
  }

  /** 2FA bước 2: OTP đúng → cấp token thật. */
  async verifyLoginOtp(dto: VerifyLoginOtpDto, meta?: LoginMeta): Promise<AuthResponse> {
    const row = await this.consumeOtp(dto.email, 'login', dto.code);
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Tài khoản không còn tồn tại');
    await this.prisma.emailOtp.delete({ where: { id: row.id } }).catch(() => undefined);
    return this.issueSession(user, meta);
  }

  /** Bật/tắt 2FA cho chính mình (cần đang đăng nhập). */
  async set2fa(userId: string, enabled: boolean): Promise<UserDto> {
    if (enabled && !this.mail.isConfigured()) {
      throw new BadRequestException(
        'Server chưa cấu hình email (SMTP) — chưa bật được 2FA qua email.',
      );
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: enabled },
    });
    return this.toUserDto(user);
  }

  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      include: { team: { select: { id: true, name: true, slug: true, plan: true, isPersonal: true } } },
    });
    return {
      user: this.toUserDto(user),
      teams: memberships.map((m) => ({
        id: m.team.id,
        name: m.team.name,
        slug: m.team.slug,
        role: m.role,
        plan: m.team.plan as 'FREE' | 'PRO',
        isPersonal: m.team.isPersonal,
      })),
    };
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<UserDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name },
    });
    return this.toUserDto(user);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException('Mật khẩu hiện tại không đúng');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { ok: true };
  }

  async listTokens(userId: string): Promise<ApiTokenDto[]> {
    const tokens = await this.prisma.apiToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return tokens.map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt.toISOString(),
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    }));
  }

  async createToken(userId: string, name: string): Promise<{ token: string } & ApiTokenDto> {
    const raw = `deploybox_${randomBytes(24).toString('hex')}`;
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const record = await this.prisma.apiToken.create({
      data: { userId, name, tokenHash },
    });
    return {
      token: raw,
      id: record.id,
      name: record.name,
      createdAt: record.createdAt.toISOString(),
      lastUsedAt: null,
    };
  }

  async revokeToken(userId: string, tokenId: string): Promise<{ ok: true }> {
    const token = await this.prisma.apiToken.findUnique({ where: { id: tokenId } });
    if (!token || token.userId !== userId) {
      throw new BadRequestException('Không tìm thấy token');
    }
    await this.prisma.apiToken.delete({ where: { id: tokenId } });
    return { ok: true };
  }

  private sign(sub: string, email: string, sid?: string): string {
    return this.jwt.sign({ sub, email, ...(sid ? { sid } : {}) });
  }

  private toUserDto(u: UserRow): UserDto {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatarUrl,
      role: u.role,
      twoFactorEnabled: u.twoFactorEnabled ?? false,
    };
  }
}
