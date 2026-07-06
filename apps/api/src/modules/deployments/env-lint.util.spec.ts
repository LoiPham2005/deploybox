import { describe, it, expect } from 'vitest';
import { lintEnvValues } from './env-lint.util';

describe('lintEnvValues (bắt env local lên production)', () => {
  it('biến public trỏ localhost → cảnh báo', () => {
    const w = lintEnvValues({ APP_URL: 'http://localhost:3001', WEB_URL: 'http://localhost:3000' });
    expect(w.map((x) => x.key).sort()).toEqual(['APP_URL', 'WEB_URL']);
  });

  it('URL tunnel ngrok → cảnh báo', () => {
    const w = lintEnvValues({ WEBHOOK_BASE_URL: 'https://abc.ngrok-free.dev' });
    expect(w).toHaveLength(1);
    expect(w[0].issue).toContain('tunnel');
  });

  it('biến *_BASE thiếu scheme → cảnh báo Invalid URL', () => {
    const w = lintEnvValues({ NEXT_PUBLIC_API_BASE: 'sports-booking-web.sneakup.io.vn' });
    expect(w).toHaveLength(1);
    expect(w[0].issue).toContain('Invalid URL');
  });

  it('KHÔNG false-positive: biến server-nội-bộ localhost là hợp lệ (host-run)', () => {
    const w = lintEnvValues({
      REDIS_HOST: 'localhost',
      DATABASE_URL: 'postgresql://app:pw@localhost:6000/app',
      PORT: '3005',
    });
    expect(w).toHaveLength(0);
  });

  it('giá trị chuẩn https → sạch', () => {
    const w = lintEnvValues({
      APP_URL: 'https://api.example.com',
      NEXT_PUBLIC_API_BASE: 'https://api.example.com',
    });
    expect(w).toHaveLength(0);
  });
});
