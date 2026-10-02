import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminStats } from '@ferry/shared';
import { api } from '@/api/client';
import { formatBytes } from '@/lib/format';
import { PageLoader, SectionTitle } from '@/components/ui';

const SOURCE_LABEL = { web: 'Web', sharex: 'ShareX', request: 'Dépôts' } as const;

export default function AdminDashboard() {
  const [s, setS] = useState<AdminStats | null>(null);
  useEffect(() => { api.get<AdminStats>('/api/admin/stats').then(setS); }, []);
  if (!s) return <PageLoader />;
  const max = Math.max(1, ...s.uploadsByDay.map((d) => d.count));
  const sourceTotal = s.bySource.reduce((a, b) => a + b.count, 0) || 1;
  return (
    <>
      <SectionTitle title="Vue d’ensemble" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Stockage utilisé" value={formatBytes(s.storageUsed)} accent />
        <Kpi label="Partages actifs" value={String(s.activeShares)} />
        <Kpi label="Fichiers" value={String(s.files)} />
        <Kpi label="Utilisateurs" value={String(s.users)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="card p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-2xl font-extrabold">Envois · 30 jours</h2>
            <span className="text-sm text-ink-3">{s.uploadsByDay.reduce((a, d) => a + d.count, 0)} partages · {formatBytes(s.uploadsByDay.reduce((a, d) => a + d.bytes, 0))}</span>
          </div>
          <div className="mt-6 flex h-48 items-end gap-[3px]">
            {s.uploadsByDay.map((d) => (
              <div key={d.day} className="group relative flex-1 h-full flex items-end">
                <div className={`w-full rounded-t-[4px] transition-colors group-hover:bg-accent ${d.count ? 'bg-ink' : 'bg-ink/15'}`}
                  style={{ height: `${Math.max(2, (d.count / max) * 100)}%` }} />
                <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-xs font-bold text-bg opacity-0 group-hover:opacity-100 z-10">
                  {new Date(d.day).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · {d.count} · {formatBytes(d.bytes)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[11px] font-bold text-ink-3">
            <span>{new Date(s.uploadsByDay[0]?.day).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span><span>Aujourd’hui</span>
          </div>
        </section>
        <section className="card p-6">
          <h2 className="text-2xl font-extrabold">Sources</h2>
          <div className="mt-5 space-y-4">
            {(['web', 'sharex', 'request'] as const).map((k) => {
              const n = s.bySource.find((b) => b.source === k)?.count ?? 0;
              return (
                <div key={k}>
                  <div className="mb-1.5 flex justify-between text-sm font-bold"><span>{SOURCE_LABEL[k]}</span><span>{n}</span></div>
                  <div className="h-2.5 rounded-full bg-surface-2"><div className="h-full rounded-full bg-ink" style={{ width: `${(n / sourceTotal) * 100}%` }} /></div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="mt-6 card p-6">
        <h2 className="text-2xl font-extrabold">Plus gros consommateurs</h2>
        <ul className="mt-4 divide-y-2 divide-line-soft">
          {s.topUsers.map((u, i) => (
            <li key={u.id} className="flex items-center gap-4 py-3">
              <span className="w-6 font-display text-xl font-extrabold text-ink-3">{i + 1}</span>
              <Link to={`/admin/files?owner=${u.id}`} className="min-w-0 flex-1">
                <div className="font-bold truncate">{u.displayName}</div>
                <div className="text-xs text-ink-3 font-mono">@{u.username}</div>
              </Link>
              <span className="text-sm text-ink-3">{u.shares} partages</span>
              <span className="w-24 text-right font-display text-lg font-extrabold">{formatBytes(u.bytes)}</span>
            </li>
          ))}
          {!s.topUsers.length && <li className="py-6 text-ink-3">Aucune donnée.</li>}
        </ul>
      </section>
    </>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={accent ? 'rounded-2xl border-2 border-accent bg-accent p-5 text-accent-ink' : 'card p-5'}>
      <div className={accent ? 'text-[11px] font-extrabold uppercase tracking-[0.12em] opacity-70' : 'label'}>{label}</div>
      <div className="mt-2 font-display text-4xl font-extrabold tracking-tight">{value}</div>
    </div>
  );
}
