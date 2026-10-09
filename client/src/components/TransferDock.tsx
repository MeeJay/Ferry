import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowUp, Check, X } from 'lucide-react';
import { useApp } from '@/store/app';
import { useTransfer } from '@/store/transfer';
import { useLandedPercent } from './ChunkLane';
import { formatBitrate, formatEta, useTransferStats } from './TransferStats';
import { Progress } from './ui';

function label(names: string[]) {
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0] ?? '';
}

/**
 * The current transfer, shown wherever the user is except on "Envoyer"
 * itself. Clicking it goes back to the transfer (or to its link once done).
 */
export function TransferDock({ onNavigate }: { onNavigate?: () => void }) {
  const { phase, items, result, reset } = useTransfer();
  const location = useLocation();
  const navigate = useNavigate();
  const uploading = phase === 'uploading';
  const stats = useTransferStats(items, uploading);
  const landed = useLandedPercent(stats.total);
  if (location.pathname === '/' || (!uploading && !(phase === 'done' && result))) return null;

  const open = () => { navigate('/'); onNavigate?.(); };
  if (!uploading) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-success/10 p-3">
        <button onClick={open} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-success text-white"><Check className="size-4" strokeWidth={3} /></span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">Transfert terminé</span>
            <span className="block truncate text-xs text-ink-3">Voir le lien</span>
          </span>
        </button>
        <button onClick={reset} className="flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-ink/5 hover:text-ink" aria-label="Fermer" title="Fermer"><X className="size-4" /></button>
      </div>
    );
  }
  return (
    <button onClick={open} className="spotlight block w-full rounded-lg p-3 text-left transition hover:brightness-110" title="Revenir au transfert">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-grad text-white"><ArrowUp className="size-4 motion-safe:animate-bounce" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold">Envoi en cours · {Math.floor(landed)} %</span>
          <span className="block truncate text-xs text-ink-3">{label(items.map((i) => i.file.name))}</span>
        </span>
      </div>
      <Progress value={landed} className="mt-2.5 !h-1.5" />
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-ink-3">
        <span>{stats.speed !== null ? formatBitrate(stats.speed) : '—'}</span>
        <span>{stats.eta !== null ? `reste ${formatEta(stats.eta)}` : 'calcul…'}</span>
      </div>
    </button>
  );
}

/** Compact pill for the mobile header. */
export function TransferPill() {
  const { phase, items } = useTransfer();
  const location = useLocation();
  const navigate = useNavigate();
  const landed = useLandedPercent(items.reduce((s, i) => s + i.file.size, 0));
  if (phase !== 'uploading' || location.pathname === '/') return null;
  return (
    <button onClick={() => navigate('/')} className="flex h-8 items-center gap-1.5 rounded-full bg-grad px-3 text-xs font-semibold tabular-nums text-white" title="Revenir au transfert">
      <ArrowUp className="size-3.5" />{Math.floor(landed)} %
    </button>
  );
}

/**
 * Side effects of a running transfer, mounted once in the app layout:
 * progress in the tab title, and a confirmation before closing / reloading.
 */
export function useTransferGuards() {
  const phase = useTransfer((s) => s.phase);
  const items = useTransfer((s) => s.items);
  const brand = useApp((s) => s.config?.branding.name ?? 'Ferry');
  const uploading = phase === 'uploading';
  const pct = Math.floor(useLandedPercent(items.reduce((s, i) => s + i.file.size, 0)));

  useEffect(() => {
    document.title = uploading ? `${pct} % · Envoi — ${brand}` : brand;
  }, [uploading, pct, brand]);

  useEffect(() => {
    if (!uploading) return;
    // Browsers show their own wording; a custom message is no longer allowed.
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [uploading]);
}

/** Same confirmation for pages with their own local upload state (drop page). */
export function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}
