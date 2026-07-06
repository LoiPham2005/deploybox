import { describe, it, expect, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';

async function userRow(password: string, name: string | null = null) {
  return {
    id: 'u1',
    email: 'a@b.com',
    name,
    avatarUrl: null,
    passwordHash: await bcrypt.hash(password, 10),
  };
}

// AuthService giờ nhận thêm MailService — test dùng stub "chưa cấu hình SMTP"
// để register() đi đường đăng ký thẳng như cũ.
const mailStub = { isConfigured: () => false } as never;
// FeatureFlags stub: mặc định mọi flag bật (signup_enabled…)
const flagsStub = { isEnabled: () => true } as never;
// Sessions stub: login/register tạo phiên → trả sid cố định
const sessionsStub = { create: async () => ({ id: 'sid1' }) } as never;

describe('AuthService', () => {
  it('login: sai mật khẩu → Unauthorized', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(await userRow('correct')) },
    };
    const jwt = { sign: vi.fn().mockReturnValue('token') };
    const svc = new AuthService(prisma as never, jwt as never, { get: () => '' } as never, mailStub, flagsStub, sessionsStub);
    await expect(
      svc.login({ email: 'a@b.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login: đúng mật khẩu → trả token + user', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(await userRow('correct', 'A')),
      },
    };
    const jwt = { sign: vi.fn().mockReturnValue('token123') };
    const svc = new AuthService(prisma as never, jwt as never, { get: () => '' } as never, mailStub, flagsStub, sessionsStub);
    const r = await svc.login({ email: 'a@b.com', password: 'correct' });
    expect(r.accessToken).toBe('token123');
    expect(r.user.email).toBe('a@b.com');
  });

  it('login: token cấp ra gắn sid phiên (để đăng xuất từ xa được)', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(await userRow('correct')) },
    };
    const jwt = { sign: vi.fn().mockReturnValue('tok') };
    const svc = new AuthService(prisma as never, jwt as never, { get: () => '' } as never, mailStub, flagsStub, sessionsStub);
    await svc.login({ email: 'a@b.com', password: 'correct' });
    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ sid: 'sid1' }));
  });

  it('register: email đã tồn tại → Conflict', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'existing' }) },
    };
    const jwt = { sign: vi.fn() };
    const svc = new AuthService(prisma as never, jwt as never, { get: () => '' } as never, mailStub, flagsStub, sessionsStub);
    await expect(
      svc.register({ email: 'a@b.com', password: 'longpassword' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('register: SIGNUP_CODE đặt + sai mã → Forbidden (chưa đụng DB)', async () => {
    const prisma = { user: { findUnique: vi.fn() } };
    const jwt = { sign: vi.fn() };
    const config = { get: () => 'SECRET-CODE' };
    const svc = new AuthService(
      prisma as never,
      jwt as never,
      config as never,
      mailStub,
      flagsStub,
      sessionsStub,
    );
    await expect(
      svc.register({
        email: 'a@b.com',
        password: 'longpassword',
        signupCode: 'wrong',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('login: user bật 2FA + SMTP có → trả requires2fa, KHÔNG trả token', async () => {
    const row = await userRow('correct', 'A');
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ ...row, twoFactorEnabled: true }) },
      emailOtp: {
        findUnique: vi.fn().mockResolvedValue(null),
        deleteMany: vi.fn().mockResolvedValue(undefined),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    };
    const jwt = { sign: vi.fn().mockReturnValue('token') };
    const mail2fa = {
      isConfigured: () => true,
      send: vi.fn().mockResolvedValue(undefined),
      otpHtml: vi.fn().mockReturnValue('<html>'),
    } as never;
    const svc = new AuthService(prisma as never, jwt as never, { get: () => '' } as never, mail2fa, flagsStub, sessionsStub);
    const r = await svc.login({ email: 'a@b.com', password: 'correct' });
    expect(r).toEqual({ requires2fa: true });
    expect(prisma.emailOtp.upsert).toHaveBeenCalledOnce(); // đã phát OTP
    expect(jwt.sign).not.toHaveBeenCalled(); // chưa cấp token
  });

  it('verifyLoginOtp: mã đúng → cấp token', async () => {
    const row = await userRow('correct', 'A');
    const codeHash = createHash('sha256').update('123456').digest('hex');
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ ...row, twoFactorEnabled: true }) },
      emailOtp: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'otp1', codeHash, attempts: 0,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const jwt = { sign: vi.fn().mockReturnValue('token2fa') };
    const svc = new AuthService(prisma as never, jwt as never, { get: () => '' } as never, mailStub, flagsStub, sessionsStub);
    const r = await svc.verifyLoginOtp({ email: 'a@b.com', code: '123456' });
    expect(r.accessToken).toBe('token2fa');
    expect(prisma.emailOtp.delete).toHaveBeenCalled(); // mã dùng 1 lần
  });

  it('register: flag signup_enabled TẮT → Forbidden dù mã mời đúng', async () => {
    const prisma = { user: { findUnique: vi.fn() } };
    const jwt = { sign: vi.fn() };
    const config = { get: () => 'SECRET-CODE' };
    const flagsOff = { isEnabled: (k: string) => k !== 'signup_enabled' } as never;
    const svc = new AuthService(
      prisma as never,
      jwt as never,
      config as never,
      mailStub,
      flagsOff,
      sessionsStub,
    );
    await expect(
      svc.register({
        email: 'a@b.com',
        password: 'longpassword',
        signupCode: 'SECRET-CODE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
