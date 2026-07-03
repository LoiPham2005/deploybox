'use server';

import { revalidatePath } from 'next/cache';
import type { ManagedDatabaseDto } from '@deploybox/shared';
import { serverApi } from '@/lib/api-server';

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export async function createDatabaseAction(
  projectId: string,
  input: { engine: 'POSTGRES' | 'REDIS'; name: string; envKey?: string },
): Promise<Result<ManagedDatabaseDto>> {
  try {
    const db = await serverApi<ManagedDatabaseDto>(
      `/projects/${projectId}/databases`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: db };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Tạo database thất bại' };
  }
}

export async function deleteDatabaseAction(
  projectId: string,
  dbId: string,
): Promise<Result> {
  try {
    await serverApi(`/projects/${projectId}/databases/${dbId}`, { method: 'DELETE' });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Xoá thất bại' };
  }
}
