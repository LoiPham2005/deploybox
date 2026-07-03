'use server';

import { revalidatePath } from 'next/cache';
import type { CronJobDto } from '@deploybox/shared';
import { serverApi } from '@/lib/api-server';

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export async function createCronAction(
  projectId: string,
  input: { name: string; schedule: string; command: string },
): Promise<Result<CronJobDto>> {
  try {
    const job = await serverApi<CronJobDto>(`/projects/${projectId}/cron`, {
      method: 'POST',
      body: JSON.stringify({ ...input, enabled: true }),
    });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: job };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Tạo cron thất bại' };
  }
}

export async function toggleCronAction(
  projectId: string,
  cronId: string,
  enabled: boolean,
): Promise<Result> {
  try {
    await serverApi(`/projects/${projectId}/cron/${cronId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Đổi trạng thái thất bại' };
  }
}

export async function deleteCronAction(projectId: string, cronId: string): Promise<Result> {
  try {
    await serverApi(`/projects/${projectId}/cron/${cronId}`, { method: 'DELETE' });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Xoá thất bại' };
  }
}

export async function runCronAction(
  projectId: string,
  cronId: string,
): Promise<Result<CronJobDto>> {
  try {
    const job = await serverApi<CronJobDto>(
      `/projects/${projectId}/cron/${cronId}/run`,
      { method: 'POST' },
    );
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: job };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Chạy thất bại' };
  }
}
