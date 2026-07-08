import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/**
 * Băm & xác minh mật khẩu — CHỈ dùng argon2id (chống brute-force GPU tốt hơn bcrypt).
 * (Dự án đã bỏ hoàn toàn bcrypt — toàn bộ mật khẩu đều là argon2.)
 */

/** Băm mật khẩu (đăng ký / đổi / reset). */
export function hashPassword(plain: string): Promise<string> {
  return argonHash(plain); // argon2id mặc định
}

/** Xác minh mật khẩu với hash argon2. */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(hash, plain);
  } catch {
    return false; // hash lạ / hỏng
  }
}
