import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { BarChart3, Files, History, Layers, Settings, Users } from 'lucide-react';

const items = [
  { to: '/admin', label: 'Vue d’ensemble', icon: BarChart3, end: true },
  { to: '/admin/files', label: 'Fichiers', icon: Files },
  { to: '/admin/users', label: 'Utilisateurs', icon: Users },
  { to: '/admin/profiles', label: 'Profils', icon: Layers },
  { to: '/admin/settings', label: 'Réglages', icon: Settings },
  { to: '/admin/audit', label: 'Journal', icon: History },
];

export default function AdminLayout() {
  return (
    <div>
      <div className="mb-10 flex flex-wrap items-center gap-1 rounded-md bg-surface-2/70 p-1.5 w-fit max-w-full overflow-x-auto lg:hidden">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end}
            className={({ isActive }) => clsx('flex items-center gap-2 rounded-md px-3.5 h-10 text-sm font-semibold whitespace-nowrap transition', isActive ? 'bg-grad text-white' : 'text-ink-2 hover:text-ink')}>
            <i.icon className="size-4" />{i.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
