import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowUpRight, BarChart3, FolderOpen, Terminal, History, Inbox, Layers, LogOut, Menu, Moon, Settings, SlidersHorizontal, Sun, Users, X, Files,
} from 'lucide-react';
import { formatBytes } from '@ferry/shared';
import { useApp } from '@/store/app';
import { useTheme } from '@/lib/theme';
import { TransferDock, TransferPill, useTransferGuards } from './TransferDock';

/** Ferry mark: a sail over a wave, on the accent gradient. */
export function Mark({ className }: { className?: string }) {
  return (
    <span className={clsx('relative inline-flex shrink-0 items-center justify-center rounded-md bg-grad glow', className)}>
      <svg viewBox="0 0 32 32" className="size-[62%]" fill="none" aria-hidden>
        <path d="M15 5 L15 20 L6 20 Z" fill="white" />
        <path d="M17 9 L17 20 L24 20 Z" fill="white" opacity=".7" />
        <path d="M4 24 Q 9 21 14 24 T 24 24 T 30 23" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Brand({ size = 'md', className }: { size?: 'md' | 'lg' | 'xl'; className?: string }) {
  const branding = useApp((s) => s.config?.branding);
  const theme = useTheme((s) => s.theme);
  if (!branding) return null;
  const logo = theme === 'dark' ? branding.logoDark || branding.logoLight : branding.logoLight || branding.logoDark;
  const h = { md: 'h-8', lg: 'h-10', xl: 'h-20' }[size];
  if (logo) return <img src={logo} alt={branding.name} className={clsx(h, 'w-auto object-contain', className)} />;
  return (
    <span className={clsx('inline-flex items-center gap-2.5 font-display font-bold tracking-tight', { md: 'text-base', lg: 'text-xl', xl: 'text-3xl' }[size], className)}>
      <Mark className={{ md: 'size-8', lg: 'size-11', xl: 'size-16' }[size]} />
      {branding.name}
    </span>
  );
}

export function ThemeSwitch({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      role="switch"
      aria-checked={theme === 'dark'}
      aria-label="Thème sombre"
      title={theme === 'dark' ? 'Passer en clair' : 'Passer en sombre'}
      className={clsx('relative grid h-8 w-16 shrink-0 grid-cols-2 rounded-full bg-surface-2 p-0.5 transition', className)}
    >
      {/* Two equal halves: the knob covers exactly one, each icon is centred in its own. */}
      <span className={clsx('absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-grad glow transition-transform duration-200', theme === 'dark' && 'translate-x-full')} />
      <span className="relative z-10 flex items-center justify-center"><Sun className={clsx('size-4 transition', theme === 'dark' ? 'text-ink-3' : 'text-white')} /></span>
      <span className="relative z-10 flex items-center justify-center"><Moon className={clsx('size-4 transition', theme === 'dark' ? 'text-white' : 'text-ink-3')} /></span>
    </button>
  );
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function NavItem({ to, end, icon: Icon, children, onNavigate }: { to: string; end?: boolean; icon: typeof Files; children: ReactNode; onNavigate?: () => void }) {
  return (
    <NavLink to={to} end={end} onClick={onNavigate}
      className={({ isActive }) => clsx(
        'group relative flex items-center gap-3 rounded-md px-3 h-9 text-[13px] font-semibold transition',
        isActive ? 'bg-grad-soft text-ink' : 'text-ink-2 hover:text-ink hover:bg-ink/[.04]',
      )}>
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-r-full bg-grad" />}
          <span className={clsx('flex size-7 items-center justify-center rounded transition', isActive ? 'bg-grad text-white glow' : 'bg-surface-2 text-ink-3 group-hover:text-ink')}>
            <Icon className="size-[18px]" />
          </span>
          {children}
        </>
      )}
    </NavLink>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { me, logout } = useApp();
  const navigate = useNavigate();
  if (!me) return null;
  const { storageUsed, storageQuota } = me.limits;
  const pct = storageQuota ? Math.min(100, (storageUsed / storageQuota) * 100) : 0;
  return (
    <div className="flex min-h-full flex-col gap-6 p-5 [&>*]:shrink-0">
      <Link to="/" onClick={onNavigate} className="px-1.5 pt-1"><Brand /></Link>

      <Link to="/" onClick={onNavigate}
        className="group flex items-center justify-between rounded-md bg-grad px-4 h-9 font-semibold text-white glow transition hover:brightness-110">
        Nouveau partage <ArrowUpRight className="size-5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </Link>

      <nav className="flex flex-col gap-1">
        <div className="label px-3.5 pb-1">Espace</div>
        <NavItem to="/" end icon={ArrowUpRight} onNavigate={onNavigate}>Envoyer</NavItem>
        <NavItem to="/my" end icon={FolderOpen} onNavigate={onNavigate}>Mes partages</NavItem>
        <NavItem to="/my/requests" icon={Inbox} onNavigate={onNavigate}>Demandes</NavItem>
        <NavItem to="/settings" icon={SlidersHorizontal} onNavigate={onNavigate}>Paramètres</NavItem>
        {me.role === 'admin' && (
          <>
            <div className="label px-3.5 pb-1 pt-5">Administration</div>
            <NavItem to="/admin" end icon={BarChart3} onNavigate={onNavigate}>Vue d’ensemble</NavItem>
            <NavItem to="/admin/files" icon={Files} onNavigate={onNavigate}>Fichiers</NavItem>
            <NavItem to="/admin/users" icon={Users} onNavigate={onNavigate}>Utilisateurs</NavItem>
            <NavItem to="/admin/profiles" icon={Layers} onNavigate={onNavigate}>Profils</NavItem>
            <NavItem to="/admin/settings" icon={Settings} onNavigate={onNavigate}>Réglages</NavItem>
            <NavItem to="/admin/audit" icon={History} onNavigate={onNavigate}>Journal</NavItem>
          </>
        )}
      </nav>

      <div className="mt-auto space-y-3">
        <TransferDock onNavigate={onNavigate} />
        <div className="rounded-md bg-surface-2/50 p-4">
          <div className="flex items-baseline justify-between">
            <span className="label">Stockage</span>
            <span className="text-xs font-semibold text-ink-2">{storageQuota ? `${Math.round(pct)} %` : 'illimité'}</span>
          </div>
          <div className="mt-2 font-display text-lg font-bold">
            {formatBytes(storageUsed)}{storageQuota > 0 && <span className="text-sm font-semibold text-ink-3"> / {formatBytes(storageQuota)}</span>}
          </div>
          {storageQuota > 0 && <div className="mt-2.5 h-1.5 rounded-full bg-surface-2"><div className="h-full rounded-full bg-grad" style={{ width: `${Math.max(2, pct)}%` }} /></div>}
        </div>
        <div className="flex items-center gap-1">
          <Link to="/settings" onClick={onNavigate} title="Mon profil"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1.5 py-1 transition hover:bg-surface-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-grad text-[13px] font-bold text-white glow">{initials(me.displayName)}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{me.displayName}</div>
              <div className="truncate font-mono text-xs text-ink-3">@{me.username}</div>
            </div>
          </Link>
          {me.limits.sharexEnabled && (
            <Link to="/settings/sharex" onClick={onNavigate} title="ShareX & API" aria-label="ShareX & API"
              className="flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-ink/5 hover:text-ink">
              <Terminal className="size-[18px]" />
            </Link>
          )}
          <button onClick={async () => { await logout(); navigate('/login'); }} title="Se déconnecter" aria-label="Se déconnecter"
            className="flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-ink/5 hover:text-danger">
            <LogOut className="size-[18px]" />
          </button>
        </div>
        <div className="flex items-center justify-between px-1.5">
          <ThemeSwitch />
          <VersionTag />
        </div>
      </div>
    </div>
  );
}

function VersionTag() {
  const version = useApp((s) => s.config?.version);
  return <span className="font-mono text-[11px] text-ink-3">Ferry {version}</span>;
}

export function AppLayout() {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useEffect(() => setDrawer(false), [location.pathname]);
  useTransferGuards();
  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] overflow-y-auto scroll-thin bg-surface/70 backdrop-blur-xl lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-30 flex h-12 items-center justify-between bg-bg/80 px-4 backdrop-blur-xl lg:hidden">
        <Link to="/"><Brand /></Link>
        <div className="flex items-center gap-2">
          <TransferPill />
          <ThemeSwitch />
          <button className="flex size-9 items-center justify-center rounded-md bg-surface-2" onClick={() => setDrawer(true)} aria-label="Menu"><Menu className="size-5" /></button>
        </div>
      </header>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-[#07051a]/70 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-[290px] max-w-[85vw] overflow-y-auto bg-surface animate-[fade-up_160ms_ease-out]">
            <button className="absolute right-4 top-5 flex size-9 items-center justify-center rounded-md text-ink-3 hover:text-ink" onClick={() => setDrawer(false)} aria-label="Fermer"><X className="size-5" /></button>
            <SidebarContent onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <main className="lg:pl-[248px]">
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-8 sm:py-12 animate-fade-up">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function Footer() {
  const config = useApp((s) => s.config);
  return (
    <footer className="mx-auto flex w-full max-w-6xl flex-wrap justify-between gap-2 px-4 py-10 text-xs text-ink-3 sm:px-5">
      <span>{config?.branding.footer}</span>
      <span className="font-mono">Ferry {config?.version}</span>
    </footer>
  );
}

/** Minimal chrome for public pages (shares, drop pages). */
export function BareLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-4 sm:px-5">
        <Link to="/"><Brand /></Link>
        <ThemeSwitch />
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-5 animate-fade-up">{children}</main>
      <Footer />
    </div>
  );
}
