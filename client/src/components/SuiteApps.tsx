import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import type { ConnectedApp } from '@ferry/shared';
import { api } from '@/api/client';
import { useApp } from '@/store/app';

const REFRESH_MS = 5 * 60_000;

/**
 * Apps of the Obli* suite the user may open, as Obligate lists them (names,
 * colors and order come from Obligate, nothing is hard-coded). Each link goes
 * through the app's /auth/sso-redirect, so the user lands signed in.
 */
export function SuiteApps({ onNavigate }: { onNavigate?: () => void }) {
  const enabled = useApp((s) => s.config?.obligate.enabled);
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const load = () => api.get<ConnectedApp[]>('/api/auth/connected-apps').then(setApps).catch(() => {});
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [enabled]);

  const others = apps.filter((a) => !a.self);
  if (!enabled || !others.length) return null;
  const main = others.filter((a) => !a.thirdParty);
  const extra = others.filter((a) => a.thirdParty);

  return (
    <nav className="flex flex-col gap-0.5">
      <div className="label px-3.5 pb-1">Suite</div>
      {main.map((a) => <AppLink key={a.baseUrl} app={a} onNavigate={onNavigate} />)}
      {extra.length > 0 && (
        <>
          <button type="button" onClick={() => setMore(!more)} aria-expanded={more}
            className="flex h-8 items-center gap-3 rounded-md px-3.5 text-left text-sm font-semibold text-ink-3 hover:bg-surface-3 hover:text-ink">
            <ChevronDown className={clsx('size-3.5 transition', more && 'rotate-180')} />Plus…
          </button>
          {more && extra.map((a) => <AppLink key={a.baseUrl} app={a} onNavigate={onNavigate} />)}
        </>
      )}
    </nav>
  );
}

function AppLink({ app, onNavigate }: { app: ConnectedApp; onNavigate?: () => void }) {
  return (
    <a href={`${app.baseUrl}/auth/sso-redirect`} onClick={onNavigate}
      className="group flex h-8 items-center gap-3 rounded-md px-3.5 text-sm font-semibold text-ink-2 transition hover:bg-surface-3 hover:text-ink">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: app.color || 'rgb(var(--ink-3))' }} />
      <span className="truncate">{app.name}</span>
    </a>
  );
}
