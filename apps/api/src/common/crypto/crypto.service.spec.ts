import { describe, it, expect } from 'vitest';
import { CryptoService } from './crypto.service';

function svc(key = 'a'.repeat(40)): CryptoService {
  return new CryptoService({ get: () => key } as never);
}

describe('CryptoService', () => {
  it('mã hoá rồi giải mã ra đúng plaintext', () => {
    const c = svc();
    const enc = c.encrypt('topsecret');
    expect(enc).not.toContain('topsecret');
    expect(c.decrypt(enc)).toBe('topsecret');
  });

  it('mỗi lần mã hoá ra ciphertext khác (IV ngẫu nhiên)', () => {
    const c = svc();
    expect(c.encrypt('x')).not.toBe(c.encrypt('x'));
  });

  it('giải mã bằng khoá khác → ném lỗi (GCM auth)', () => {
    const enc = svc('key-one-aaaaaaaaaaaaaaaaaaaaaaaaaaaa').encrypt('hello');
    expect(() =>
      svc('key-two-bbbbbbbbbbbbbbbbbbbbbbbbbbbb').decrypt(enc),
    ).toThrow();
  });

  it('ciphertext bị sửa → ném lỗi', () => {
    const c = svc();
    const enc = c.encrypt('hello');
    const tampered = enc.slice(0, -2) + (enc.endsWith('00') ? '11' : '00');
    expect(() => c.decrypt(tampered)).toThrow();
  });
});
