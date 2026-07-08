import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import * as bcrypt from 'bcryptjs';

/**
 * Băm & xác minh mật khẩu. Hash MỚI dùng argon2id (chống brute-force GPU tốt hơn
 * bcrypt). Hash CŨ (bcrypt, prefix $2a/$2b) vẫn xác minh được → chuyển dần sang
 * argon2 bằng "rehash khi đăng nhập" (không ai phải đặt lại mật khẩu).
 *
 * KHÔNG có cách nào đổi thẳng hash bcrypt→argon2 vì mật khẩu gốc không được lưu.
 */

/** Băm mật khẩu mới (đăng ký / đổi / reset) bằng argon2id. */
export function hashPassword(plain: string): Promise<string> {
  return argonHash(plain); // mặc định argon2id
}

/** Xác minh — tự nhận diện hash là argon2 hay bcrypt. */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  if (hash.startsWith('$argon2')) {
    try {
      return await argonVerify(hash, plain);
    } catch {
      return false;
    }
  }
  // Hash cũ kiểu bcrypt ($2a$/$2b$/$2y$)
  return bcrypt.compare(plain, hash);
}

/** Hash này còn dùng thuật toán cũ (bcrypt) → nên nâng cấp lên argon2. */
export function needsRehash(hash: string): boolean {
  return !hash.startsWith('$argon2');
}
