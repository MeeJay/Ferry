import { useState } from 'react';
import clsx from 'clsx';
import { Gauge, Minus, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Me } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';

/**
 * The user's own "chunks in flight", saved on their profile so it applies to
 * every upload: Auto (adapted to the measured speed, up to the admin max) or a
 * fixed 1 … max. "Par défaut" goes back to the admin default.
 */
export function ParallelPicker({ compact }: { compact?: boolean }) {
  const me = useApp((s) => s.me)!;
  const setMe = useApp((s) => s.setMe);
  const [saving, setSaving] = useState(false);
  const value = me.uploadParallel;
  const auto = value === 0;
  const max = me.uploadParallelMax;

  async function save(next: number | null) {
    setSaving(true);
    try { setMe(await api.patch<Me>('/api/me', { uploadParallel: next })); }
    catch (err) { toast.error(errorMessage(err)); } finally { setSaving(false); }
  }
  // Leaving Auto starts from a sensible fixed value.
  const step = (d: number) => save(Math.min(max, Math.max(1, (auto ? Math.min(4, max) - d : value) + d)));

  return (
    <div className={compact ? 'flex items-center justify-between gap-3' : 'space-y-2'}>
      <div>
        <div className="text-sm font-semibold">Fragments simultanés</div>
        <div className="text-xs text-ink-3">
          {auto ? 'Ajusté au débit' : 'Fixe'} · {me.uploadParallelPref === null ? 'défaut de l’instance' : 'votre réglage'} · max {max}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => !auto && save(0)} disabled={saving} aria-pressed={auto} title="Commence à 1 et ajoute des fragments tant que le débit augmente"
          className={clsx('flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold', auto ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-ink-3 hover:bg-surface-3 hover:text-ink')}>
          <Gauge className="size-3.5" />Auto
        </button>
        <button type="button" onClick={() => step(-1)} disabled={saving || (!auto && value <= 1)} aria-label="Moins"
          className="flex size-7 items-center justify-center rounded-md bg-surface-2 text-ink-2 hover:bg-surface-3 disabled:opacity-40"><Minus className="size-3.5" /></button>
        <span className={clsx('w-8 text-center font-display text-lg font-bold tabular-nums', auto && 'text-ink-3')}>{auto ? '–' : value}</span>
        <button type="button" onClick={() => step(1)} disabled={saving || (!auto && value >= max)} aria-label="Plus"
          className="flex size-7 items-center justify-center rounded-md bg-surface-2 text-ink-2 hover:bg-surface-3 disabled:opacity-40"><Plus className="size-3.5" /></button>
        {me.uploadParallelPref !== null && (
          <button type="button" onClick={() => save(null)} disabled={saving} className="ml-1 text-[11px] font-semibold text-ink-3 hover:text-ink">Par défaut</button>
        )}
      </div>
    </div>
  );
}
