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
  CreditCard,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TeamDto, UserDto } from '@deploybox/shared';

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

function NavLink({ href, label, icon, exact }: NavItem) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-white/10 text-white'
          : 'text-white/50 hover:bg-white/5 hover:text-white/80',
      )}
    >
      <span className={cn('h-4 w-4 shrink-0', isActive ? 'text-white' : 'text-white/40')}>
        {icon}
      </span>
      {label}
    </Link>
  );
}

export function SidebarNav({
  user,
  currentTeam,
}: {
  user: UserDto;
  currentTeam: TeamDto | null;
}) {
  const sections: NavSection[] = [
    {
      title: 'Workspace',
      items: [
        {
          href: '/dashboard',
          label: 'Projects',
          icon: <FolderOpen size={16} />,
          exact: true,
        },
      ],
    },
    {
      title: 'Infrastructure',
      items: [
        { href: '/team', label: 'Team', icon: <Users size={16} /> },
        { href: '/servers', label: 'Servers', icon: <Server size={16} /> },
      ],
    },
    {
      title: 'Developer',
      items: [
        { href: '/settings/tokens', label: 'API Tokens', icon: <Key size={16} /> },
      ],
    },
    {
      title: 'Account',
      items: [
        { href: '/account', label: 'Tài khoản', icon: <User size={16} /> },
      ],
    },
  ];

  return (
    <nav className="flex-1 space-y-5 overflow-y-auto py-2">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-white/25">
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
          <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-indigo-400/60">
            System
          </p>
          <ul>
            <li>
              <NavLink
                href="/admin"
                label="Admin Panel"
                icon={<ShieldCheck size={16} />}
              />
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
      <div className="flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500">
          <span className="text-[10px] font-black text-white">P</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-indigo-300">PRO Plan</p>
          <p className="truncate text-[11px] text-white/30">{teamName}</p>
        </div>
      </div>
    );
  }

  return (
    <Link
      href="/settings/billing"
      className="group flex items-center gap-2 rounded-xl border border-white/8 bg-white/3 px-3 py-2.5 transition-colors hover:border-indigo-500/30 hover:bg-indigo-500/5"
    >
      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10">
        <span className="text-[10px] font-bold text-white/40">F</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-white/50">FREE</p>
          <span className="flex items-center gap-0.5 text-[11px] text-indigo-400 group-hover:text-indigo-300">
            Nâng cấp <ChevronRight size={11} />
          </span>
        </div>
        <p className="text-[11px] text-white/25">2 project · 1 server · 3 members</p>
      </div>
    </Link>
  );
}
