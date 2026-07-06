import { describe, it, expect } from 'vitest';
import { parseMemToMb } from './monitor.service';

describe('parseMemToMb (parse "docker stats" MemUsage)', () => {
  it('MiB giữ nguyên', () => {
    expect(parseMemToMb('123.4MiB')).toBeCloseTo(123.4);
  });
  it('GiB → MB', () => {
    expect(parseMemToMb('1.5GiB')).toBeCloseTo(1536);
  });
  it('KiB → MB', () => {
    expect(parseMemToMb('2048KiB')).toBeCloseTo(2);
  });
  it('chuỗi rác → null', () => {
    expect(parseMemToMb('--')).toBeNull();
  });
});
