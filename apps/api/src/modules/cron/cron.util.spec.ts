import { describe, it, expect } from 'vitest';
import { parseCron, isValidCron, cronMatches } from './cron.util';

// Helper: tạo Date giờ server với (thứ tự) year, monthIndex, day, hour, minute
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi, 0);

describe('cron.util', () => {
  it('isValidCron: hợp lệ / không hợp lệ', () => {
    expect(isValidCron('0 3 * * *')).toBe(true);
    expect(isValidCron('*/15 * * * *')).toBe(true);
    expect(isValidCron('0 9 * * 1-5')).toBe(true);
    expect(isValidCron('30 2 1 * *')).toBe(true);
    expect(isValidCron('bad')).toBe(false); // sai số trường
    expect(isValidCron('60 * * * *')).toBe(false); // phút > 59
    expect(isValidCron('* 24 * * *')).toBe(false); // giờ > 23
    expect(isValidCron('* * * * 7')).toBe(false); // thứ > 6
    expect(isValidCron('*/0 * * * *')).toBe(false); // bước 0
  });

  it('"0 3 * * *" — đúng 3h sáng, sai phút/giờ khác', () => {
    const s = parseCron('0 3 * * *');
    expect(cronMatches(s, at(2026, 7, 3, 3, 0))).toBe(true);
    expect(cronMatches(s, at(2026, 7, 3, 3, 1))).toBe(false);
    expect(cronMatches(s, at(2026, 7, 3, 4, 0))).toBe(false);
  });

  it('"*/15 * * * *" — mỗi 15 phút', () => {
    const s = parseCron('*/15 * * * *');
    for (const m of [0, 15, 30, 45]) expect(cronMatches(s, at(2026, 7, 3, 10, m))).toBe(true);
    for (const m of [1, 7, 14, 16]) expect(cronMatches(s, at(2026, 7, 3, 10, m))).toBe(false);
  });

  it('"0 9 * * 1" — Thứ Hai 9h (2026-07-06 là Thứ Hai)', () => {
    const s = parseCron('0 9 * * 1');
    expect(cronMatches(s, at(2026, 7, 6, 9, 0))).toBe(true); // Mon
    expect(cronMatches(s, at(2026, 7, 7, 9, 0))).toBe(false); // Tue
  });

  it('dom + dow cùng giới hạn → OR (chuẩn cron)', () => {
    // ngày 1 HOẶC Thứ Hai
    const s = parseCron('0 0 1 * 1');
    expect(cronMatches(s, at(2026, 7, 1, 0, 0))).toBe(true); // ngày 1 (dù không phải T2)
    expect(cronMatches(s, at(2026, 7, 6, 0, 0))).toBe(true); // T2 (dù không phải ngày 1)
    expect(cronMatches(s, at(2026, 7, 2, 0, 0))).toBe(false); // không phải cả hai
  });

  it('khoảng a-b và danh sách a,b', () => {
    const s = parseCron('0 9-11 * * *');
    expect(cronMatches(s, at(2026, 7, 3, 10, 0))).toBe(true);
    expect(cronMatches(s, at(2026, 7, 3, 12, 0))).toBe(false);
    const s2 = parseCron('0 8,20 * * *');
    expect(cronMatches(s2, at(2026, 7, 3, 8, 0))).toBe(true);
    expect(cronMatches(s2, at(2026, 7, 3, 20, 0))).toBe(true);
    expect(cronMatches(s2, at(2026, 7, 3, 12, 0))).toBe(false);
  });
});
