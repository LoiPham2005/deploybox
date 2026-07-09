import { redirect } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { serverApi } from '@/lib/api-server';
import { Card } from '@/components/ui/card';
import {
  PLAN_LIMITS,
  isAdminRole,
  type BillingStatusDto,
  type PaymentDto,
} from '@deploybox/shared';
import { ProCheckout } from '@/features/billing/pro-checkout';

const STATUS_LABEL: Record<PaymentDto['status'], string> = {
  PENDING: 'Chờ thanh toán',
  PAID: 'Đã thanh toán',
  CANCELED: 'Đã huỷ',
};

export default async function BillingPage() {
  const token = getToken();
  if (!token) redirect('/login');

  const me = await authApi.me(token).catch(() => redirect('/api/session/clear'));
  const team = me.teams[0];
  if (!team) redirect('/dashboard');

  const [status, payments] = await Promise.all([
    serverApi<BillingStatusDto>(`/billing/status/${team.id}`).catch(() => null),
    serverApi<PaymentDto[]>(`/billing/payments/${team.id}`).catch(() => [] as PaymentDto[]),
  ]);

  const isPro = team.plan === 'PRO';
  // Admin hệ thống, hoặc admin đã tắt giới hạn gói → coi như không giới hạn.
  const unlimited = isAdminRole(me.user.role) || !me.flags.planLimitsEnabled;
  const limits = PLAN_LIMITS[team.plan];
  const priceVnd = status?.priceVnd ?? 99000;
  const configured = status?.configured ?? false;
  const expiresAt = status?.planExpiresAt ?? null;
  // Nút mua Pro chỉ hiện khi: chưa Pro, còn áp giới hạn, và admin cho phép mua.
  const showUpgrade = !isPro && !unlimited && me.flags.billingProUpgrade;
  const fmt = (n: number) => (unlimited || n === -1 ? '∞' : n);
  const vnd = (n: number) => n.toLocaleString('vi-VN');
  const paidPayments = payments.filter((p) => p.status !== 'PENDING');

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Gói dịch vụ</h1>
        <p className="mt-1 text-sm text-white/40">Quản lý gói và giới hạn của team</p>
      </div>

      {/* Current plan */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-white/40">Gói hiện tại</p>
            <p className="mt-1 text-2xl font-bold">
              {isPro ? (
                <span className="text-indigo-400">PRO</span>
              ) : (
                <span>FREE</span>
              )}
            </p>
          </div>
          {isPro && (
            <span className="rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-medium text-indigo-300">
              Đang dùng
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { label: 'Projects', value: fmt(limits.projects) },
            { label: 'Servers', value: fmt(limits.servers) },
            { label: 'Thành viên', value: fmt(limits.members) },
          ].map((item) => (
            <div key={item.label} className="rounded-lg bg-white/5 p-3 text-center">
              <p className="text-xl font-bold">{item.value}</p>
              <p className="mt-0.5 text-xs text-white/40">{item.label}</p>
            </div>
          ))}
        </div>

        {isPro && (
          <p className="mt-3 text-xs text-white/50">
            {expiresAt
              ? `Hết hạn: ${new Date(expiresAt).toLocaleDateString('vi-VN')}`
              : 'Không giới hạn thời gian (admin cấp).'}
          </p>
        )}
        {unlimited && !isPro && (
          <p className="mt-3 text-xs text-emerald-400/80">
            {isAdminRole(me.user.role)
              ? 'Tài khoản admin — không giới hạn toàn bộ chức năng.'
              : 'Admin đã tắt giới hạn theo gói — bạn đang dùng không giới hạn.'}
          </p>
        )}
      </Card>

      {/* Upgrade section — chỉ hiện khi admin cho phép mua & còn áp giới hạn */}
      {showUpgrade && (
        <Card>
          <h2 className="text-sm font-semibold">
            {isPro ? 'Gia hạn Pro' : 'Nâng cấp lên Pro'}
          </h2>
          <p className="mt-1 text-xs text-white/40">
            Mở khóa không giới hạn project, server và thành viên
          </p>

          <div className="mt-4 space-y-2">
            {[
              'Không giới hạn projects',
              'Không giới hạn servers (LOCAL + REMOTE)',
              'Không giới hạn thành viên',
              'Ưu tiên hỗ trợ',
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-2 text-sm">
                <span className="text-emerald-400">✓</span>
                <span className="text-white/70">{feature}</span>
              </div>
            ))}
          </div>

          <div className="mt-5 border-t border-white/[0.06] pt-4">
            {configured ? (
              <ProCheckout
                teamId={team.id}
                priceVnd={priceVnd}
                providers={status?.availableProviders ?? []}
              />
            ) : (
              <p className="text-sm text-amber-300/80">
                Cổng thanh toán chưa được cấu hình. Liên hệ admin để nâng cấp thủ công.
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Lịch sử thanh toán */}
      {paidPayments.length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-white/70">
            Lịch sử thanh toán
          </h2>
          <ul className="divide-y divide-white/5 text-sm">
            {paidPayments.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-mono text-xs text-white/50">{p.orderCode}</p>
                  <p className="text-xs text-white/40">
                    {new Date(p.paidAt ?? p.createdAt).toLocaleString('vi-VN')} ·{' '}
                    {p.months} tháng
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{vnd(p.amount)}₫</p>
                  <p
                    className={`text-xs ${
                      p.status === 'PAID' ? 'text-emerald-400' : 'text-white/40'
                    }`}
                  >
                    {STATUS_LABEL[p.status]}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
