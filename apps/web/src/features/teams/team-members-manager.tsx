'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';
import type { TeamMemberDto, TeamDto } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  inviteMemberAction,
  removeMemberAction,
  setMemberProjectsAction,
} from './actions';

const ROLE_LABEL: Record<'OWNER' | 'MEMBER', string> = {
  OWNER: 'Owner',
  MEMBER: 'Member',
};

type ProjectLite = { id: string; name: string };

export function TeamMembersManager({
  teamId,
  myRole,
  initialMembers,
  plan,
  projects,
  initialAccess,
}: {
  teamId: string;
  myRole: 'OWNER' | 'MEMBER';
  initialMembers: TeamMemberDto[];
  plan: TeamDto['plan'];
  projects: ProjectLite[];
  initialAccess: Record<string, string[]>;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // access: userId -> Set<projectId>
  const [access, setAccess] = useState<Record<string, Set<string>>>(() => {
    const m: Record<string, Set<string>> = {};
    for (const [uid, ids] of Object.entries(initialAccess)) m[uid] = new Set(ids);
    return m;
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [savingFor, setSavingFor] = useState<string | null>(null);

  const isOwner = myRole === 'OWNER';
  const canInvite = isOwner && plan === 'PRO';

  async function invite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setErr(null);
    setMsg(null);
    const res = await inviteMemberAction(teamId, inviteEmail.trim());
    setInviting(false);
    if (res.ok && res.data) {
      const m = res.data;
      setMembers((prev) => [...prev, m]);
      setAccess((prev) => ({ ...prev, [m.userId]: new Set() })); // mặc định: chưa cấp project nào
      setInviteEmail('');
      setMsg('Đã thêm thành viên. Mở "Quyền project" để cấp quyền xem.');
      setExpanded(m.userId);
    } else if (!res.ok) {
      setErr(res.error);
    }
  }

  async function remove(memberId: string) {
    if (!confirm('Xoá thành viên này?')) return;
    setErr(null);
    const res = await removeMemberAction(teamId, memberId);
    if (res.ok) {
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } else {
      setErr(res.error);
    }
  }

  function toggleProject(userId: string, projectId: string) {
    setAccess((prev) => {
      const next = new Set(prev[userId] ?? []);
      next.has(projectId) ? next.delete(projectId) : next.add(projectId);
      return { ...prev, [userId]: next };
    });
  }

  function setAll(userId: string, all: boolean) {
    setAccess((prev) => ({
      ...prev,
      [userId]: all ? new Set(projects.map((p) => p.id)) : new Set(),
    }));
  }

  async function saveAccess(userId: string) {
    setSavingFor(userId);
    setErr(null);
    setMsg(null);
    const res = await setMemberProjectsAction(teamId, userId, [
      ...(access[userId] ?? []),
    ]);
    setSavingFor(null);
    if (res.ok) {
      setMsg('Đã lưu quyền project');
    } else {
      setErr(res.error);
    }
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-white/5">
        {members.map((m) => {
          const isMemberRole = m.role !== 'OWNER';
          const granted = access[m.userId] ?? new Set<string>();
          const isOpen = expanded === m.userId;
          return (
            <li key={m.id} className="py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{m.name ?? m.email}</p>
                  {m.name && <p className="text-xs text-white/40">{m.email}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {/* Tóm tắt quyền + nút mở rộng (chỉ với MEMBER, khi mình là OWNER) */}
                  {isOwner && isMemberRole && (
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : m.userId)}
                      className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-white/60 hover:border-white/30 hover:text-white"
                    >
                      <FolderOpen size={12} />
                      {granted.size === projects.length && projects.length > 0
                        ? 'Tất cả project'
                        : `${granted.size}/${projects.length} project`}
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  )}
                  <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/60">
                    {ROLE_LABEL[m.role as 'OWNER' | 'MEMBER'] ?? m.role}
                  </span>
                  {isOwner && m.role !== 'OWNER' && (
                    <Button
                      variant="ghost"
                      onClick={() => remove(m.id)}
                      className="h-7 px-2 text-red-400 hover:text-red-300"
                    >
                      Xoá
                    </Button>
                  )}
                </div>
              </div>

              {/* Panel phân quyền project */}
              {isOwner && isMemberRole && isOpen && (
                <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-white/60">
                      Project mà thành viên này được xem
                    </p>
                    <div className="flex gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setAll(m.userId, true)}
                        className="text-indigo-400 hover:underline"
                      >
                        Chọn tất cả
                      </button>
                      <button
                        type="button"
                        onClick={() => setAll(m.userId, false)}
                        className="text-white/40 hover:underline"
                      >
                        Bỏ hết
                      </button>
                    </div>
                  </div>

                  {projects.length === 0 ? (
                    <p className="py-2 text-xs text-white/30">
                      Team chưa có project nào để cấp quyền.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {projects.map((p) => (
                        <li key={p.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-white/5">
                            <input
                              type="checkbox"
                              checked={granted.has(p.id)}
                              onChange={() => toggleProject(m.userId, p.id)}
                              className="h-3.5 w-3.5 accent-indigo-500"
                            />
                            <span className="text-white/80">{p.name}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      onClick={() => saveAccess(m.userId)}
                      disabled={savingFor === m.userId}
                      className="h-7 px-3 text-xs"
                    >
                      {savingFor === m.userId ? 'Đang lưu…' : 'Lưu quyền'}
                    </Button>
                    <span className="text-[11px] text-white/30">
                      Không tích = không thấy project đó
                    </span>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {isOwner && (
        <div className="border-t border-white/10 pt-4">
          {canInvite ? (
            <>
              <p className="mb-2 text-xs text-white/50">Mời thành viên (phải đăng ký trước)</p>
              <div className="flex gap-2">
                <Input
                  placeholder="email@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && invite()}
                  className="flex-1"
                />
                <Button onClick={invite} disabled={inviting || !inviteEmail.trim()}>
                  {inviting ? 'Đang mời…' : 'Mời'}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-white/30">
                Mặc định thành viên mới <strong>chưa thấy project nào</strong> — bấm
                &quot;Quyền project&quot; để cấp quyền xem từng cái.
              </p>
            </>
          ) : (
            <div className="rounded-md border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-sm text-white/60">
                Nâng cấp Pro để mời thêm thành viên vào team.
              </p>
              <a
                href="/settings/billing"
                className="mt-1 inline-block text-xs text-indigo-400 hover:underline"
              >
                Nâng cấp ngay →
              </a>
            </div>
          )}
          {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
          {msg && <p className="mt-2 text-xs text-emerald-400">{msg}</p>}
        </div>
      )}
    </div>
  );
}
