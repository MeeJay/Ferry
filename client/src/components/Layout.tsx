import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { LogOut, Moon, Settings, Shield, Sun, Menu, X } from 'lucide-react';
import { useApp } from '@/store/app';
import { useTheme } from '@/lib/theme';

export function Brand({ size = 'md', className }: { size?: 'md' | 'lg' | 'xl'; className?: string }) {
  const branding = useApp((s) => s.config?.branding);
  const theme = useTheme((s) => s.theme);
  if (!branding) return null;
  const logo = theme === 'dark' ? branding.logoDark || branding.logoLight : branding.logoLight || branding.logoDark;
  const h = { md: 'h-8', lg: 'h-12', xl: 'h-20' }[size];
  if (logo) return <img src={logo} alt={branding.name} className={clsx(h, 'w-auto object-contain', className)} />;
  return (
    <span className={clsx('inline-flex items-center gap-2.5 font-display font-extrabold tracking-tight', { md: 'text-xl', lg: 'text-3xl', xl: 'text-5xl' }[size], className)}>
      <span className={clsx('inline-block rounded-[30%] bg-accent', { md: 'size-6', lg: 'size-9', xl: 'size-14' }[size])} />
      {branding.name}
    </span>
  );
}

export function ThemeSwitch() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      role="switch"
      aria-checked={theme === 'dark'}
      aria-label="Thème sombre"
      title={theme === 'dark' ? 'Passer en clair' : 'Passer en sombre'}
      className="relative inline-flex h-9 w-[68px] items-center rounded-full border-2 border-line bg-surface p-0.5 transition"
    >
      <span className={clsx('absolute size-7 rounded-full bg-ink transition-transform duration-200', theme === 'dark' ? 'translate-x-[32px]' : 'translate-x-0')} />
      <Sun className={clsx('relative z-10 mx-1.5 size-4 transition', theme === 'dark' ? 'text-ink-3' : 'text-bg')} />
      <Moon className={clsx('relative z-10 mx-1.5 size-4 transition', theme === 'dark' ? 'text-bg' : 'text-ink-3')} />
    </button>
  );
}

function UserMenu() {
  const { me, logout } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!me) return null;
  const initials = me.displayName.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex size-9 items-center justify-center rounded-full bg-ink text-bg text-[13px] font-extrabold" aria-label="Compte">
        {initials}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-64 card p-2 animate-pop">
          <div className="px-3 py-2">
            <div className="font-bold truncate">{me.displayName}</div>
            <div className="text-xs text-ink-3 truncate font-mono">@{me.username}</div>
          </div>
          <div className="my-1 h-0.5 bg-line-soft" />
          <MenuItem icon={<Settings className="size-4" />} onClick={() => { setOpen(false); navigate('/settings'); }}>Paramètres</MenuItem>
          <MenuItem icon={<LogOut className="size-4" />} onClick={async () => { await logout(); navigate('/login'); }}>Se déconnecter</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-3 h-10 text-sm font-semibold text-ink-2 hover:bg-ink/5 hover:text-ink">
      {icon}{children}
    </button>
  );
}

const navItems = [
  { to: '/', label: 'Envoyer', end: true },
  { to: '/my', label: 'Mes partages', end: true },
  { to: '/my/requests', label: 'Demandes' },
];

export function TopBar() {
  const me = useApp((s) => s.me);
  const [mobile, setMobile] = useState(false);
  const items = me?.role === 'admin' ? [...navItems, { to: '/admin', label: 'Admin' }] : navItems;
  return (
    <header className="sticky top-0 z-30 border-b-2 border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link to="/" className="shrink-0"><Brand /></Link>
        {me && (
          <nav className="hidden md:flex items-center gap-1">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end}
                className={({ isActive }) => clsx('flex items-center gap-1.5 rounded-xl px-3.5 h-9 text-sm font-bold transition', isActive ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink hover:bg-ink/5')}>
                {i.to === '/admin' && <Shield className="size-3.5" />}{i.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3">
          <ThemeSwitch />
          <UserMenu />
          {me && (
            <button className="md:hidden flex size-9 items-center justify-center" onClick={() => setMobile(!mobile)} aria-label="Menu">
              {mobile ? <X /> : <Menu />}
            </button>
          )}
        </div>
      </div>
      {mobile && me && (
        <nav className="md:hidden border-t-2 border-line-soft px-4 py-3 flex flex-col gap-1">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} onClick={() => setMobile(false)}
              className={({ isActive }) => clsx('rounded-xl px-3 h-11 flex items-center font-bold', isActive ? 'bg-ink text-bg' : 'text-ink-2')}>
              {i.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}

export function Footer() {
  const config = useApp((s) => s.config);
  return (
    <footer className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-10 text-xs text-ink-3 flex flex-wrap justify-between gap-2">
      <span>{config?.branding.footer}</span>
      <span className="font-mono">Ferry {config?.version}</span>
    </footer>
  );
}

export function AppLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 py-10 sm:py-14 animate-fade-up">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

/** Minimal chrome for public pages (shares, drop pages, login). */
export function BareLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/"><Brand /></Link>
        <ThemeSwitch />
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 py-8 animate-fade-up">{children}</main>
      <Footer />
    </div>
  );
}
