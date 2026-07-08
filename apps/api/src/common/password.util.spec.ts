import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.util';

describe('password.util (argon2)', () => {
  it('hashPassword ra hash argon2id', async () => {
    const h = await hashPassword('MatKhau!123');
    expect(h.startsWith('$argon2')).toBe(true);
  });

  it('verifyPassword đúng/sai', async () => {
    const h = await hashPassword('MatKhau!123');
    expect(await verifyPassword(h, 'MatKhau!123')).toBe(true);
    expect(await verifyPassword(h, 'sai')).toBe(false);
  });

  it('verifyPassword với hash rác → false, không ném lỗi', async () => {
    expect(await verifyPassword('không-phải-hash', 'gì đó')).toBe(false);
  });
});
