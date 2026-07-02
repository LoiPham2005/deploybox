import { createHash } from 'crypto';

/**
 * Chữ ký lỗi: chuẩn hoá text lỗi (bỏ số, id, timestamp, khoảng trắng) rồi hash.
 * Hai lần fail cùng một "bệnh" → cùng chữ ký, dù id/thời gian khác nhau.
 */
export function errorSig(errorMessage: string | null | undefined, logTail: string): string {
  const raw = `${errorMessage ?? ''}\n${logTail.slice(-1_500)}`;
  const normalized = raw
    .toLowerCase()
    // mọi token CÓ CHỨA chữ số → '#' (bắt cả cuid cmr123abc, sha, pid, port, timestamp)
    .replace(/[a-z0-9_-]*\d[a-z0-9_-]*/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha1').update(normalized).digest('hex');
}
