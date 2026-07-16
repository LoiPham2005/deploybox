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

/** Admin đổi nhà cung cấp AI + model dùng cho toàn app. */
export async function setAiConfigAction(
  provider: string,
  model: string,
): Promise<Result> {
  try {
    await serverApi('/admin/ai', {
      method: 'PUT',
      body: JSON.stringify({ provider, model }),
    });
    revalidatePath('/admin');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Đổi cấu hình AI thất bại' };
  }
}

/** Đặt/sửa API key cho 1 nhà cung cấp AI (apiKey rỗng = xoá → về .env). */
export async function setAiKeyAction(
  provider: string,
  apiKey: string,
): Promise<Result> {
  try {
    await serverApi('/admin/ai/key', {
      method: 'PUT',
      body: JSON.stringify({ provider, apiKey }),
    });
    revalidatePath('/admin');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Lưu API key thất bại' };
  }
}

/** Admin lưu cấu hình thanh toán (giá + TK nhận tiền + key SePay). */
export async function setBillingConfigAction(
  patch: import('@deploybox/shared').BillingConfigPatch,
): Promise<Result> {
  try {
    await serverApi('/admin/billing', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    revalidatePath('/admin');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Lưu cấu hình thanh toán thất bại' };
  }
}

/** 🤖 Lưu key Cloudflare Turnstile (secret mã hoá; rỗng = giữ nguyên). */
export async function setCaptchaAction(patch: {
  siteKey?: string;
  secretKey?: string;
  clearSecret?: boolean;
}): Promise<Result> {
  try {
    await serverApi('/admin/captcha', { method: 'PUT', body: JSON.stringify(patch) });
    revalidatePath('/admin');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Lưu key thất bại' };
  }
}

/** 💾 Chạy backup DB nền tảng ngay (local + đẩy sang DB phụ). */
export async function runBackupAction(): Promise<Result> {
  try {
    await serverApi('/admin/backup/run', { method: 'POST' });
    revalidatePath('/admin');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Backup thất bại' };
  }
}

/** Đọc trạng thái backup (dùng để poll sau failover — API restart). */
export async function getBackupStatusAction(): Promise<
  { ok: true; data: unknown } | { ok: false; error: string }
> {
  try {
    const data = await serverApi('/admin/backup');
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'API chưa trả lời' };
  }
}

/** Chuyển DB chính ↔ DB dự phòng (API sẽ tự restart). */
export async function setFailoverAction(useBackup: boolean): Promise<Result> {
  try {
    await serverApi('/admin/backup/failover', {
      method: 'POST',
      body: JSON.stringify({ useBackup }),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Chuyển DB thất bại' };
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
