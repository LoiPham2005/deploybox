'use client';

import { useState } from 'react';
import { ChevronsUpDown, Check, Building2 } from 'lucide-react';
import type { TeamDto } from '@deploybox/shared';

export function TeamSwitcher({ teams, currentTeamId }: { teams: TeamDto[]; currentTeamId: string }) {
  const [open, setOpen] = useState(false);
  const current = teams.find((t) => t.id === currentTeamId) ?? teams[0];

  function switchTeam(teamId: string) {
    document.cookie = `db_team=${teamId};path=/;max-age=31536000`;
    setOpen(false);
    window.location.reload();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/5"
      >
        {/* Team avatar */}
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/10">
          <Building2 size={12} className="text-white/50" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-white/80">{current?.name}</p>
          <p className="text-[10px] text-white/30">
            {current?.isPersonal ? 'Cá nhân' : current?.plan === 'PRO' ? 'PRO Team' : 'Free Team'}
          </p>
        </div>

        <ChevronsUpDown size={13} className="shrink-0 text-white/25" />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Dropdown */}
          <div className="absolute left-0 top-full z-50 mt-1.5 w-full min-w-[200px] rounded-xl border border-white/10 bg-zinc-900/95 py-1.5 shadow-2xl backdrop-blur-sm">
            <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-widest text-white/25">
              Chuyển workspace
            </p>
            {teams.map((t) => (
              <button
                key={t.id}
                onClick={() => switchTeam(t.id)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/5"
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/10">
                  <span className="text-[10px] font-bold text-white/50">
                    {t.name[0].toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-xs font-medium ${t.id === currentTeamId ? 'text-white' : 'text-white/60'}`}>
                    {t.name}
                  </p>
                  <p className="text-[10px] text-white/25">
                    {t.isPersonal ? 'Cá nhân' : t.plan === 'PRO' ? 'PRO' : 'Free'}
                  </p>
                </div>
                {t.plan === 'PRO' && (
                  <span className="shrink-0 rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-400">
                    PRO
                  </span>
                )}
                {t.id === currentTeamId && (
                  <Check size={13} className="shrink-0 text-indigo-400" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
