'use server';

import { revalidatePath } from 'next/cache';
import { type CreateServerDto, createServerSchema } from '@deploybox/shared';
import { serverApi } from '@/lib/api-server';

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function addServerAction(
  teamId: string,
  input: CreateServerDto,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createServerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Dữ liệu không hợp lệ' };
  }
  try {
    const server = await serverApi<{ id: string }>(`/teams/${teamId}/servers`, {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    });
    revalidatePath('/servers');
    return { ok: true, data: server };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Thêm server thất bại' };
  }
}

export async function removeServerAction(serverId: string): Promise<ActionResult> {
  try {
    await serverApi(`/servers/${serverId}`, { method: 'DELETE' });
    revalidatePath('/servers');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Xóa server thất bại' };
  }
}

export async function testServerAction(serverId: string): Promise<ActionResult<{ online: boolean }>> {
  try {
    const result = await serverApi<{ ok: boolean; message: string }>(`/servers/${serverId}/test`, {
      method: 'POST',
    });
    revalidatePath('/servers');
    return { ok: true, data: { online: result.ok } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Kiểm tra thất bại' };
  }
}
