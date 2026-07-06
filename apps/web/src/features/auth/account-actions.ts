'use server';

import { revalidatePath } from 'next/cache';
import { serverApi } from '@/lib/api-server';

type ActionResult = { ok: true } | { ok: false; error: string };

/** Đổi tên hiển thị (chạy server-side nên đọc được cookie httpOnly). */
export async function updateNameAction(name: string): Promise<ActionResult> {
  try {
    await serverApi('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ name: name.trim() || undefined }),
    });
    revalidatePath('/account');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Lưu thất bại' };
  }
}

/** Bật/tắt 2FA (OTP email khi đăng nhập). */
export async function set2faAction(enabled: boolean): Promise<ActionResult> {
  try {
    await serverApi('/auth/me/2fa', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
    revalidatePath('/account');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Thao tác thất bại' };
  }
}

/** Đổi mật khẩu (chạy server-side nên đọc được cookie httpOnly). */
export async function changePasswordAction(
  currentPassword: string,
  newPassword: string,
): Promise<ActionResult> {
  try {
    await serverApi('/auth/me/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Đổi mật khẩu thất bại' };
  }
}
