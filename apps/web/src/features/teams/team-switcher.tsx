'use client';
import { useState } from 'react';
import type { TeamDto } from '@deploybox/shared';

export function TeamSwitcher({ teams, currentTeamId }: { teams: TeamDto[]; currentTeamId: string }) {
  const [open, setOpen] = useState(false);
  const current = teams.find(t => t.id === currentTeamId) ?? teams[0];

  function switchTeam(teamId: string) {
    document.cookie = `db_team=${teamId};path=/;max-age=31536000`;
    window.location.reload();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-white/5"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate font-medium">{current?.name}</span>
          {current?.isPersonal && (
            <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/40">
              Cá nhân
            </span>
          )}
        </div>
        <span className="text-white/30">⌄</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border border-white/10 bg-zinc-900 py-1 shadow-lg">
          {teams.map(t => (
            <button
              key={t.id}
              onClick={() => switchTeam(t.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5 ${
                t.id === currentTeamId ? 'text-indigo-400' : 'text-white/70'
              }`}
            >
              <span className="truncate">{t.name}</span>
              {t.isPersonal && (
                <span className="ml-auto shrink-0 text-xs text-white/30">Cá nhân</span>
              )}
              {t.plan === 'PRO' && (
                <span className="shrink-0 rounded bg-indigo-500/20 px-1.5 py-0.5 text-xs text-indigo-400">
                  PRO
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
