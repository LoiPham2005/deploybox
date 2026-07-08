'use server';

import { revalidatePath } from 'next/cache';
import type { CheckoutResponse, PaymentDto } from '@deploybox/shared';
import { serverApi } from '@/lib/api-server';

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

/** Bấm "Mua Pro" → tạo đơn + lấy VietQR (hoặc URL redirect với cổng khác). */
export async function checkoutAction(
  teamId: string,
  months: number,
  provider?: string,
): Promise<Ok<CheckoutResponse> | Err> {
  try {
    const data = await serverApi<CheckoutResponse>('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ teamId, months, provider }),
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Tạo đơn thất bại' };
  }
}

/** Poll trạng thái đơn (PENDING → PAID) trong lúc chờ khách chuyển khoản. */
export async function getOrderAction(
  orderCode: string,
): Promise<Ok<PaymentDto> | Err> {
  try {
    const data = await serverApi<PaymentDto>(`/billing/order/${orderCode}`);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Không đọc được đơn' };
  }
}

/** Sau khi thanh toán xong → làm mới trang để cập nhật gói. */
export async function refreshBillingAction(): Promise<void> {
  revalidatePath('/settings/billing');
}
