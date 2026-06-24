import { describe, it, expect, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
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

describe('AuthService', () => {
  it('login: sai mật khẩu → Unauthorized', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(await userRow('correct')) },
    };
    const jwt = { sign: vi.fn().mockReturnValue('token') };
    const svc = new AuthService(prisma as never, jwt as never, { get: () => '' } as never);
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
    const svc = new AuthService(prisma as never, jwt as never, { get: () => '' } as never);
    const r = await svc.login({ email: 'a@b.com', password: 'correct' });
    expect(r.accessToken).toBe('token123');
    expect(r.user.email).toBe('a@b.com');
  });

  it('register: email đã tồn tại → Conflict', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'existing' }) },
    };
    const jwt = { sign: vi.fn() };
    const svc = new AuthService(prisma as never, jwt as never, { get: () => '' } as never);
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
});
