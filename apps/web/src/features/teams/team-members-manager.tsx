'use client';

import { useState } from 'react';
import type { TeamMemberDto, TeamRole } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const ROLE_LABEL: Record<TeamRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
};

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/api/v1';

async function apiCall(path: string, method: string, body?: unknown) {
  const token = document.cookie
    .split('; ')
    .find((r) => r.startsWith('db_token='))
    ?.split('=')[1];
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(e.message ?? `Lỗi ${res.status}`);
  }
  return res.json();
}

export function TeamMembersManager({
  teamId,
  myRole,
  initialMembers,
}: {
  teamId: string;
  myRole: TeamRole;
  initialMembers: TeamMemberDto[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const [inviting, setInviting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const canManage = myRole === 'OWNER' || myRole === 'ADMIN';
  const canChangeRole = myRole === 'OWNER';

  async function invite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setErr(null);
    try {
      const m = await apiCall(`/teams/${teamId}/members/invite`, 'POST', {
        email: inviteEmail.trim(),
        role: inviteRole,
      }) as TeamMemberDto;
      setMembers((prev) => [...prev, m]);
      setInviteEmail('');
      setMsg('Đã thêm thành viên');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lỗi không xác định');
    } finally {
      setInviting(false);
    }
  }

  async function updateRole(memberId: string, role: 'ADMIN' | 'MEMBER') {
    try {
      const updated = await apiCall(
        `/teams/${teamId}/members/${memberId}/role`,
        'PATCH',
        { role },
      ) as TeamMemberDto;
      setMembers((prev) => prev.map((m) => (m.id === memberId ? updated : m)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lỗi');
    }
  }

  async function remove(memberId: string) {
    if (!confirm('Xoá thành viên này?')) return;
    try {
      await apiCall(`/teams/${teamId}/members/${memberId}`, 'DELETE');
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lỗi');
    }
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-white/5">
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
            <div>
              <p className="font-medium">{m.name ?? m.email}</p>
              {m.name && <p className="text-xs text-white/40">{m.email}</p>}
            </div>
            <div className="flex items-center gap-2">
              {canChangeRole && m.role !== 'OWNER' ? (
                <select
                  value={m.role}
                  onChange={(e) => updateRole(m.id, e.target.value as 'ADMIN' | 'MEMBER')}
                  className="rounded bg-white/10 px-2 py-1 text-xs"
                >
                  <option value="ADMIN">Admin</option>
                  <option value="MEMBER">Member</option>
                </select>
              ) : (
                <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/60">
                  {ROLE_LABEL[m.role]}
                </span>
              )}
              {canManage && m.role !== 'OWNER' && (
                <Button variant="ghost" onClick={() => remove(m.id)} className="h-7 px-2 text-red-400 hover:text-red-300">
                  Xoá
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {canManage && (
        <div className="border-t border-white/10 pt-4">
          <p className="mb-2 text-xs text-white/50">Mời thành viên (phải đăng ký trước)</p>
          <div className="flex gap-2">
            <Input
              placeholder="email@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && invite()}
              className="flex-1"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'ADMIN' | 'MEMBER')}
              className="rounded border border-white/10 bg-white/5 px-2 text-sm"
            >
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
            <Button onClick={invite} disabled={inviting || !inviteEmail.trim()}>
              {inviting ? 'Đang mời…' : 'Mời'}
            </Button>
          </div>
          {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
          {msg && <p className="mt-2 text-xs text-emerald-400">{msg}</p>}
        </div>
      )}
    </div>
  );
}
