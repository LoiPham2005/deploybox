'use server';

import { revalidatePath } from 'next/cache';
import type { TeamMemberDto } from '@deploybox/shared';
import { serverApi } from '@/lib/api-server';

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/** Mời thành viên vào team (server-side để đọc được cookie httpOnly). */
export async function inviteMemberAction(
  teamId: string,
  email: string,
): Promise<Result<TeamMemberDto>> {
  try {
    const m = await serverApi<TeamMemberDto>(`/teams/${teamId}/members/invite`, {
      method: 'POST',
      body: JSON.stringify({ email, role: 'MEMBER' }),
    });
    revalidatePath('/team');
    return { ok: true, data: m };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Mời thất bại' };
  }
}

export async function removeMemberAction(
  teamId: string,
  memberId: string,
): Promise<Result> {
  try {
    await serverApi(`/teams/${teamId}/members/${memberId}`, { method: 'DELETE' });
    revalidatePath('/team');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Xoá thất bại' };
  }
}

export async function setMemberProjectsAction(
  teamId: string,
  userId: string,
  projectIds: string[],
): Promise<Result> {
  try {
    await serverApi(`/teams/${teamId}/members/${userId}/projects`, {
      method: 'PUT',
      body: JSON.stringify({ projectIds }),
    });
    revalidatePath('/team');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Lưu quyền thất bại' };
  }
}
