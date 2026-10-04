import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { FolderOpen, HardDrive, Files as FilesIcon, Users } from 'lucide-react';
import type { AdminStats } from '@ferry/shared';
import { api } from '@/api/client';
import { formatBytes } from '@/lib/format';
import { PageLoader, SectionTitle } from '@/components/ui';

const SOURCES = [
  { key: 'web', label: 'Web', color: 'rgb(var(--accent))' },
  { key: 'sharex', label: 'ShareX', color: 'rgb(var(--accent-2))' },
  { key: 'request', label: 'Dépôts', color: 'rgb(var(--warm-1))' },
] as const;

export default function AdminDashboard() {
  const [s, setS] = useState<AdminStats | null>(null);
  useEffect(() => { api.get<AdminStats>('/api/admin/stats').then(setS); }, []);
  if (!s) return <PageLoader />;
  const totalCount = s.uploadsByDay.reduce((a, d) => a + d.count, 0);
  const totalBytes = s.uploadsByDay.reduce((a, d) => a + d.bytes, 0);
  return (
    <>
      <SectionTitle title={<>Vue <span className="text-grad">d’ensemble</span></>} subtitle="Activité de l’instance sur les 30 derniers jours." />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi icon={<HardDrive />} label="Stockage utilisé" value={formatBytes(s.storageUsed)} tone="grad" />
        <Kpi icon={<FolderOpen />} label="Partages actifs" value={String(s.activeShares)} />
        <Kpi icon={<FilesIcon />} label="Fichiers" value={String(s.files)} />
        <Kpi icon={<Users />} label="Utilisateurs" value={String(s.users)} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
        <section className="card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">Volume envoyé</h2>
            <span className="text-sm text-ink-3"><b className="text-ink">{formatBytes(totalBytes)}</b> · {totalCount} partages</span>
          </div>
          <AreaChart days={s.uploadsByDay} />
        </section>
        <section className="card p-5">
          <h2 className="text-lg font-bold">Sources</h2>
          <Donut bySource={s.bySource} />
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[340px_1fr]">
        <section className="card p-5">
          <h2 className="text-lg font-bold">Partages par jour</h2>
          <Bars days={s.uploadsByDay} />
        </section>
        <section className="card p-5">
          <h2 className="text-lg font-bold">Plus gros consommateurs</h2>
          <ul className="mt-4 space-y-2">
            {s.topUsers.map((u, i) => {
              const max = s.topUsers[0]?.bytes || 1;
              return (
                <li key={u.id}>
                  <Link to={`/admin/files?owner=${u.id}`} className="flex items-center gap-4 rounded-md px-3 py-2.5 transition hover:bg-ink/[.04]">
                    <span className={clsx('flex size-9 shrink-0 items-center justify-center rounded-md font-display font-bold', i === 0 ? 'bg-grad text-white glow' : 'bg-surface-2 text-ink-2')}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-semibold">{u.displayName}</span>
                        <span className="shrink-0 font-display font-bold">{formatBytes(u.bytes)}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3">
                        <div className="h-1.5 flex-1 rounded-full bg-surface-2"><div className="h-full rounded-full bg-grad" style={{ width: `${Math.max(3, (u.bytes / max) * 100)}%` }} /></div>
                        <span className="w-20 shrink-0 text-right text-xs text-ink-3">{u.shares} partages</span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
            {!s.topUsers.length && <li className="py-6 text-ink-3">Aucune donnée.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}

function Kpi({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: 'grad' }) {
  if (tone === 'grad') {
    return (
      <div className="relative overflow-hidden rounded-lg bg-grad p-5 text-white glow">
        <div aria-hidden className="absolute -right-10 -top-10 size-40 rounded-full bg-white/15 blur-2xl" />
        <div className="relative flex size-10 items-center justify-center rounded-md bg-white/20 [&>svg]:size-5">{icon}</div>
        <div className="relative mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/75">{label}</div>
        <div className="relative mt-1 font-display text-2xl font-bold tracking-tight">{value}</div>
      </div>
    );
  }
  return (
    <div className="card p-5">
      <div className="flex size-10 items-center justify-center rounded-md bg-grad-soft text-accent [&>svg]:size-5">{icon}</div>
      <div className="label mt-5">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold tracking-tight">{value}</div>
    </div>
  );
}

const fmtDay = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

function AreaChart({ days }: { days: AdminStats['uploadsByDay'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = 200, P = 6;
  const max = Math.max(1, ...days.map((d) => d.bytes));
  const pts = days.map((d, i) => [P + (i / Math.max(1, days.length - 1)) * (W - 2 * P), H - P - (d.bytes / max) * (H - 2 * P - 10)] as const);
  const path = useMemo(() => {
    if (!pts.length) return '';
    let p = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      p += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
    }
    return p;
  }, [pts]);
  const h = hover !== null ? days[hover] : null;
  return (
    <div className="relative mt-6">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full overflow-visible" preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * (days.length - 1)));
        }}>
        <defs>
          <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgb(var(--accent-2))" stopOpacity=".45" />
            <stop offset="1" stopColor="rgb(var(--accent))" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="area-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="rgb(var(--accent))" />
            <stop offset=".6" stopColor="rgb(var(--accent-2))" />
            <stop offset="1" stopColor="rgb(var(--warm-1))" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgb(var(--line))" strokeDasharray="3 6" vectorEffect="non-scaling-stroke" />)}
        {path && <path d={`${path} L ${W - P} ${H} L ${P} ${H} Z`} fill="url(#area-fill)" />}
        {path && <path d={path} fill="none" stroke="url(#area-line)" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        {hover !== null && pts[hover] && <line x1={pts[hover][0]} x2={pts[hover][0]} y1="0" y2={H} stroke="rgb(var(--accent))" strokeOpacity=".5" vectorEffect="non-scaling-stroke" />}
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: `${(hover / Math.max(1, days.length - 1)) * 100}%` }}>
          <div className="font-semibold">{fmtDay(h.day)}</div>
          <div className="text-ink-2">{formatBytes(h.bytes)} · {h.count} partage{h.count > 1 ? 's' : ''}</div>
        </div>
      )}
      <div className="mt-2 flex justify-between text-[11px] font-semibold text-ink-3">
        <span>{days[0] && fmtDay(days[0].day)}</span><span>Aujourd’hui</span>
      </div>
    </div>
  );
}

function Bars({ days }: { days: AdminStats['uploadsByDay'] }) {
  const last = days.slice(-14);
  const max = Math.max(1, ...last.map((d) => d.count));
  return (
    <div className="mt-6">
      <div className="flex h-44 items-end gap-1.5">
        {last.map((d, i) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end">
            <div className={clsx('w-full rounded-t-lg transition-all', d.count ? (i % 4 === 3 ? 'bg-grad-warm' : 'bg-grad') : 'bg-surface-2')}
              style={{ height: `${Math.max(4, (d.count / max) * 100)}%`, opacity: d.count ? 0.6 + (i / last.length) * 0.4 : 1 }} />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-surface px-2 py-1 text-xs font-semibold opacity-0 group-hover:opacity-100">
              {fmtDay(d.day)} · {d.count}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] font-semibold text-ink-3"><span>14 jours</span><span>Aujourd’hui</span></div>
    </div>
  );
}

function Donut({ bySource }: { bySource: AdminStats['bySource'] }) {
  const counts = SOURCES.map((s) => bySource.find((b) => b.source === s.key)?.count ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const C = 2 * Math.PI * 15.5;
  let offset = 0;
  return (
    <div className="mt-4 flex flex-col items-center">
      <div className="relative">
        <svg viewBox="0 0 40 40" className="size-44 -rotate-90">
          <circle cx="20" cy="20" r="15.5" fill="none" stroke="rgb(var(--surface-2))" strokeWidth="5" />
          {total > 0 && SOURCES.map((s, i) => {
            const len = (counts[i] / total) * C;
            const el = counts[i] ? (
              <circle key={s.key} cx="20" cy="20" r="15.5" fill="none" stroke={s.color} strokeWidth="5"
                strokeDasharray={`${Math.max(0, len - 1.2)} ${C}`} strokeDashoffset={-offset} strokeLinecap="round" />
            ) : null;
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-display text-2xl font-bold">{total}</div>
          <div className="text-xs text-ink-3">partages</div>
        </div>
      </div>
      <ul className="mt-6 w-full space-y-2.5">
        {SOURCES.map((s, i) => (
          <li key={s.key} className="flex items-center gap-3 text-sm">
            <span className="size-3 rounded-full" style={{ background: s.color }} />
            <span className="flex-1 font-semibold text-ink-2">{s.label}</span>
            <span className="font-semibold">{counts[i]}</span>
            <span className="w-12 text-right text-xs text-ink-3">{total ? Math.round((counts[i] / total) * 100) : 0} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
