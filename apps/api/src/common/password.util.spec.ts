import { describe, it, expect } from 'vitest';
import * as bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword, needsRehash } from './password.util';

describe('password.util (argon2 + migrate bcrypt)', () => {
  it('hashPassword ra hash argon2id', async () => {
    const h = await hashPassword('MatKhau!123');
    expect(h.startsWith('$argon2')).toBe(true);
  });

  it('verifyPassword đúng/sai với hash argon2', async () => {
    const h = await hashPassword('MatKhau!123');
    expect(await verifyPassword(h, 'MatKhau!123')).toBe(true);
    expect(await verifyPassword(h, 'sai')).toBe(false);
  });

  it('verifyPassword vẫn xác minh được hash bcrypt CŨ (migrate)', async () => {
    const legacy = await bcrypt.hash('MatKhauCu!9', 10);
    expect(legacy.startsWith('$2')).toBe(true);
    expect(await verifyPassword(legacy, 'MatKhauCu!9')).toBe(true);
    expect(await verifyPassword(legacy, 'sai')).toBe(false);
  });

  it('needsRehash: bcrypt = true, argon2 = false', async () => {
    const legacy = await bcrypt.hash('x12345678', 10);
    const modern = await hashPassword('x12345678');
    expect(needsRehash(legacy)).toBe(true);
    expect(needsRehash(modern)).toBe(false);
  });
});
