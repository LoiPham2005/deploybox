import { redirect } from 'next/navigation';
import { isAdminRole, type AiConfigStatus, type AuditLogDto, type UserRole } from '@deploybox/shared';
import { getToken } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { serverApi } from '@/lib/api-server';
import { Card } from '@/components/ui/card';
import { PlanToggle } from './plan-toggle';
import { FeatureFlagsPanel, type Feature } from './feature-flags-panel';
import { AiConfigPanel } from './ai-config-panel';

interface AiUsageSummary {
  days: number;
  totalCalls: number;
  totalUsd: number;
  items: Array<{
    feature: string;
    provider: string;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    estCostUsd: number;
  }>;
}

interface AdminStats {
  users: number;
  teams: number;
  projects: number;
}

interface AdminUser {
  id: string;
  email: string;
  name?: string | null;
  role: UserRole;
  createdAt: string;
  memberships: Array<{
    team: { id: string; plan: string };
  }>;
}

export default async function AdminPage() {
  const token = getToken();
  if (!token) redirect('/login');

  const me = await authApi.me(token).catch(() => redirect('/api/session/clear'));
  if (!isAdminRole(me.user.role)) redirect('/dashboard');

  const [stats, users, features, aiConfig, aiUsage, audit] = await Promise.all([
    serverApi<AdminStats>('/admin/stats').catch(() => ({ users: 0, teams: 0, projects: 0 })),
    serverApi<AdminUser[]>('/admin/users').catch(() => [] as AdminUser[]),
    serverApi<Feature[]>('/admin/features').catch(() => [] as Feature[]),
    serverApi<AiConfigStatus>('/admin/ai').catch(() => null),
    serverApi<AiUsageSummary>('/admin/ai-usage?days=30').catch(() => null),
    serverApi<AuditLogDto[]>('/admin/audit?limit=50').catch(() => [] as AuditLogDto[]),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Admin Panel</h1>
        <p className="mt-1 text-sm text-white/40">Quản lý toàn bộ hệ thống DeployBox</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <p className="text-xs text-white/40">Tổng người dùng</p>
          <p className="mt-1 text-3xl font-bold">{stats.users}</p>
        </Card>
        <Card>
          <p className="text-xs text-white/40">Teams cá nhân</p>
          <p className="mt-1 text-3xl font-bold">{stats.teams}</p>
        </Card>
        <Card>
          <p className="text-xs text-white/40">Tổng project</p>
          <p className="mt-1 text-3xl font-bold">{stats.projects}</p>
        </Card>
      </div>

      {/* Tính năng hệ thống */}
      <Card>
        <h2 className="mb-1 text-sm font-semibold text-white/70">Tính năng hệ thống</h2>
        <p className="mb-4 text-xs text-white/40">
          Bật/tắt tính năng toàn hệ thống (áp dụng cho mọi người dùng) — vd tắt tạm khi bảo trì.
        </p>
        <FeatureFlagsPanel features={features} />
      </Card>

      {/* AI — nhà cung cấp & model */}
      {aiConfig && (
        <Card>
          <h2 className="mb-1 text-sm font-semibold text-white/70">
            AI — nhà cung cấp &amp; model
          </h2>
          <p className="mb-4 text-xs text-white/40">
            Chọn Claude / ChatGPT / Gemini và model dùng cho tính năng AI (bác sĩ lỗi
            deploy) trên toàn hệ thống. Đổi lúc nào cũng được.
          </p>
          <AiConfigPanel config={aiConfig} />
        </Card>
      )}

      {/* 💰 Chi phí AI */}
      {aiUsage && (
        <Card>
          <h2 className="mb-1 text-sm font-semibold text-white/70">
            💰 Chi phí AI ({aiUsage.days} ngày qua)
          </h2>
          <p className="mb-3 text-xs text-white/40">
            {aiUsage.totalCalls} lượt gọi · ước tính{' '}
            <span className="font-semibold text-emerald-300">${aiUsage.totalUsd}</span>{' '}
            (theo bảng giá public — chỉ để tham khảo)
          </p>
          {aiUsage.items.length === 0 ? (
            <p className="text-xs text-white/30">Chưa có lượt gọi AI nào được ghi.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-white/40">
                  <tr className="border-b border-white/[0.06] text-left">
                    <th className="py-1.5 pr-3">Tính năng</th>
                    <th className="py-1.5 pr-3">Model</th>
                    <th className="py-1.5 pr-3 text-right">Lượt</th>
                    <th className="py-1.5 pr-3 text-right">Token vào/ra</th>
                    <th className="py-1.5 text-right">~$</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-white/70">
                  {aiUsage.items.map((r) => (
                    <tr key={`${r.feature}-${r.model}`}>
                      <td className="py-1.5 pr-3">{r.feature}</td>
                      <td className="py-1.5 pr-3 text-white/50">{r.model}</td>
                      <td className="py-1.5 pr-3 text-right">{r.calls}</td>
                      <td className="py-1.5 pr-3 text-right text-white/50">
                        {(r.inputTokens / 1000).toFixed(1)}k / {(r.outputTokens / 1000).toFixed(1)}k
                      </td>
                      <td className="py-1.5 text-right text-emerald-300">${r.estCostUsd}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Users list */}
      <Card>
        <h2 className="mb-4 text-sm font-semibold text-white/70">Danh sách người dùng</h2>
        <div className="divide-y divide-white/5">
          {users.map((u) => {
            const personalTeam = u.memberships[0]?.team;
            return (
              <div key={u.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{u.name ?? u.email}</p>
                    {isAdminRole(u.role) && (
                      <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-400">
                        Admin
                      </span>
                    )}
                  </div>
                  {u.name && <p className="text-xs text-white/40">{u.email}</p>}
                  <p className="text-xs text-white/30">
                    {new Date(u.createdAt).toLocaleDateString('vi-VN')}
                    {personalTeam && (
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          personalTeam.plan === 'PRO'
                            ? 'bg-indigo-500/20 text-indigo-300'
                            : 'bg-white/10 text-white/40'
                        }`}
                      >
                        {personalTeam.plan}
                      </span>
                    )}
                  </p>
                </div>
                {personalTeam ? (
                  <PlanToggle
                    teamId={personalTeam.id}
                    currentPlan={personalTeam.plan as 'FREE' | 'PRO'}
                  />
                ) : (
                  <span className="text-xs text-white/20">Chưa có team cá nhân</span>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* 📝 Nhật ký hoạt động */}
      <Card>
        <h2 className="mb-1 text-sm font-semibold text-white/70">📝 Nhật ký hoạt động</h2>
        <p className="mb-3 text-xs text-white/40">
          50 thao tác ghi/sửa/xoá gần nhất của mọi người dùng (không lưu nội dung — không lộ
          secret). Giữ 90 ngày. Tắt/bật ở &quot;Tính năng hệ thống&quot;.
        </p>
        {audit.length === 0 ? (
          <p className="text-xs text-white/30">Chưa có hoạt động nào được ghi.</p>
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#0b0d12] text-white/40">
                <tr className="border-b border-white/[0.06] text-left">
                  <th className="py-1.5 pr-3">Lúc</th>
                  <th className="py-1.5 pr-3">Ai</th>
                  <th className="py-1.5 pr-3">Hành động</th>
                  <th className="py-1.5 pr-3">Đường dẫn</th>
                  <th className="py-1.5 text-right">Kết quả</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-white/70">
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-white/40">
                      {new Date(a.createdAt).toLocaleString('vi-VN', { hour12: false })}
                    </td>
                    <td className="py-1.5 pr-3">{a.userEmail ?? '—'}</td>
                    <td className="py-1.5 pr-3">{a.action}</td>
                    <td className="max-w-[220px] truncate py-1.5 pr-3 text-white/40">
                      {a.method} {a.path.replace('/api/v1', '')}
                    </td>
                    <td
                      className={`py-1.5 text-right ${
                        a.status < 400 ? 'text-emerald-300' : 'text-red-400'
                      }`}
                    >
                      {a.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
