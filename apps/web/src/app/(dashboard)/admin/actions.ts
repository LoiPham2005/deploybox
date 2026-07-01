'use server';

import { revalidatePath } from 'next/cache';
import { serverApi } from '@/lib/api-server';

type Result = { ok: true } | { ok: false; error: string };

/** Admin đổi plan của một team (nâng PRO / hạ FREE) — không cần thanh toán. */
export async function setPlanAction(
  teamId: string,
  plan: 'FREE' | 'PRO',
): Promise<Result> {
  try {
    await serverApi(`/admin/teams/${teamId}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ plan }),
    });
    revalidatePath('/admin');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Đổi plan thất bại' };
  }
}

/** Admin bật/tắt 1 tính năng hệ thống. */
export async function toggleFeatureAction(
  key: string,
  enabled: boolean,
): Promise<Result> {
  try {
    await serverApi(`/admin/features/${key}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    revalidatePath('/admin');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Đổi tính năng thất bại' };
  }
}
