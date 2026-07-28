'use server';

import { revalidatePath } from 'next/cache';
import type { BackupDto, BackupStatsDto } from '@deploybox/shared';
import { serverApi } from '@/lib/api-server';

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

const base = (projectId: string, dbId: string) =>
  `/projects/${projectId}/databases/${dbId}/backups`;

/** Nạp thống kê + danh sách backup của 1 database. */
export async function getBackupDataAction(
  projectId: string,
  dbId: string,
): Promise<Ok<{ stats: BackupStatsDto; backups: BackupDto[] }> | Err> {
  try {
    const [stats, backups] = await Promise.all([
      serverApi<BackupStatsDto>(`${base(projectId, dbId)}/stats`),
      serverApi<BackupDto[]>(base(projectId, dbId)),
    ]);
    return { ok: true, data: { stats, backups } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Không tải được backup' };
  }
}

export async function backupNowAction(
  projectId: string,
  dbId: string,
): Promise<Ok<BackupDto> | Err> {
  try {
    const data = await serverApi<BackupDto>(base(projectId, dbId), { method: 'POST' });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Sao lưu thất bại' };
  }
}

export async function deleteBackupAction(
  projectId: string,
  dbId: string,
  backupId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await serverApi(`${base(projectId, dbId)}/${backupId}`, { method: 'DELETE' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Xoá thất bại' };
  }
}

export async function getDownloadUrlAction(
  projectId: string,
  dbId: string,
  backupId: string,
): Promise<Ok<string> | Err> {
  try {
    const r = await serverApi<{ url: string }>(
      `${base(projectId, dbId)}/${backupId}/download`,
    );
    return { ok: true, data: r.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Không tạo được link tải' };
  }
}

export async function setAutoBackupAction(
  projectId: string,
  dbId: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await serverApi(`${base(projectId, dbId)}/auto`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Đổi chế độ thất bại' };
  }
}
