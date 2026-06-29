'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FolderOpen,
  Users,
  Server,
  Key,
  User,
  ShieldCheck,
  Zap,
  ArrowUpRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TeamDto, UserDto } from '@deploybox/shared';

type NavItem = { href: string; label: string; icon: React.ReactNode; exact?: boolean };
type NavSection = { title: string; items: NavItem[] };

function NavLink({ href, label, icon, exact }: NavItem) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all duration-150',
        isActive
          ? 'bg-white/10 text-white shadow-sm'
          : 'text-white/45 hover:bg-white/[0.06] hover:text-white/80',
      )}
    >
      <span className={cn('shrink-0', isActive ? 'text-white' : 'text-white/35')}>
        {icon}
      </span>
      {label}
      {isActive && <span className="ml-auto h-1 w-1 rounded-full bg-indigo-400" />}
    </Link>
  );
}

export function SidebarNav({ user, currentTeam }: { user: UserDto; currentTeam: TeamDto | null }) {
  const sections: NavSection[] = [
    {
      title: 'Workspace',
      items: [{ href: '/dashboard', label: 'Projects', icon: <FolderOpen size={14} />, exact: true }],
    },
    {
      title: 'Infrastructure',
      items: [
        { href: '/team', label: 'Team', icon: <Users size={14} /> },
        { href: '/servers', label: 'Servers', icon: <Server size={14} /> },
      ],
    },
    {
      title: 'Developer',
      items: [
        { href: '/settings/tokens', label: 'API Tokens', icon: <Key size={14} /> },
        { href: '/account', label: 'Tài khoản', icon: <User size={14} /> },
      ],
    },
  ];

  return (
    <nav className="flex-1 space-y-4 overflow-y-auto">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-white/20">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.href}>
                <NavLink {...item} />
              </li>
            ))}
          </ul>
        </div>
      ))}

      {user.isAdmin && (
        <div>
          <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-indigo-400/50">
            System
          </p>
          <ul>
            <li>
              <NavLink href="/admin" label="Admin Panel" icon={<ShieldCheck size={14} />} />
            </li>
          </ul>
        </div>
      )}
    </nav>
  );
}

export function PlanBadge({ plan, teamName }: { plan: 'FREE' | 'PRO'; teamName: string }) {
  if (plan === 'PRO') {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-indigo-500/25 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 px-3 py-2.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-purple-600">
          <Zap size={11} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-indigo-300">PRO Plan</p>
          <p className="truncate text-[10px] text-white/30">{teamName}</p>
        </div>
      </div>
    );
  }

  return (
    <Link
      href="/settings/billing"
      className="group flex items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 transition-all hover:border-indigo-500/30 hover:bg-indigo-500/5"
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5">
        <span className="text-[10px] font-bold text-white/30">F</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-white/40">FREE</p>
          <span className="flex items-center gap-0.5 text-[10px] text-indigo-400 opacity-0 transition-opacity group-hover:opacity-100">
            Nâng cấp <ArrowUpRight size={10} />
          </span>
        </div>
        <p className="text-[10px] text-white/20">2 projects · 1 server</p>
      </div>
    </Link>
  );
}
