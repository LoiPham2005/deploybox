'use server';

import { revalidatePath } from 'next/cache';
import type { ApiTokenDto } from '@deploybox/shared';
import { serverApi } from '@/lib/api-server';

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/** Tạo API token mới — trả token thô (chỉ thấy 1 lần). */
export async function createTokenAction(
  name: string,
): Promise<Result<ApiTokenDto & { token: string }>> {
  try {
    const res = await serverApi<ApiTokenDto & { token: string }>('/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    revalidatePath('/settings/tokens');
    return { ok: true, data: res };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Tạo token thất bại' };
  }
}

export async function revokeTokenAction(id: string): Promise<Result> {
  try {
    await serverApi(`/auth/tokens/${id}`, { method: 'DELETE' });
    revalidatePath('/settings/tokens');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Thu hồi thất bại' };
  }
}
