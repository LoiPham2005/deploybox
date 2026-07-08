import { redirect } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { PLAN_LIMITS, isAdminRole } from '@deploybox/shared';

export default async function BillingPage() {
  const token = getToken();
  if (!token) redirect('/login');

  const me = await authApi.me(token).catch(() => redirect('/api/session/clear'));
  const team = me.teams[0];
  if (!team) redirect('/dashboard');

  const isPro = team.plan === 'PRO';
  // Admin hệ thống, hoặc admin đã tắt giới hạn gói → coi như không giới hạn.
  const unlimited = isAdminRole(me.user.role) || !me.flags.planLimitsEnabled;
  const limits = PLAN_LIMITS[team.plan];
  // Nút mua Pro chỉ hiện khi: chưa Pro, còn áp giới hạn, và admin cho phép mua.
  const showUpgrade = !isPro && !unlimited && me.flags.billingProUpgrade;
  const fmt = (n: number) => (unlimited || n === -1 ? '∞' : n);

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
          <h2 className="text-sm font-semibold">Nâng cấp lên Pro</h2>
          <p className="mt-1 text-xs text-white/40">
            Mở khóa không giới hạn project, server và thành viên
          </p>

          <div className="mt-4 space-y-2">
            {[
              'Không giới hạn projects',
              'Không giới hạn servers (LOCAL + REMOTE)',
              'Không giới hạn thành viên',
              'Priority support',
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-2 text-sm">
                <span className="text-emerald-400">✓</span>
                <span className="text-white/70">{feature}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-4">
            <div>
              <span className="text-3xl font-bold">$9</span>
              <span className="text-sm text-white/40">/tháng</span>
            </div>
            <button
              disabled
              className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white opacity-60 cursor-not-allowed"
            >
              Nâng cấp (sắp ra mắt)
            </button>
          </div>
          <p className="mt-2 text-xs text-white/30">
            Liên hệ admin để được nâng cấp thủ công trong thời gian beta.
          </p>
        </Card>
      )}
    </div>
  );
}
