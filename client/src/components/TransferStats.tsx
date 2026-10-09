import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { formatBytes } from '@/lib/format';
import type { UploadItem } from '@/lib/upload';
import { useLandedPercent } from './ChunkLane';

/** Window over which the speed is averaged: long enough to smooth tus chunk bursts. */
const WINDOW_MS = 5000;

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** 6 025 000 B/s → "48,2 Mbit/s" (network-style bits per second). */
export function formatBitrate(bytesPerSec: number): string {
  const bits = bytesPerSec * 8;
  if (bits < 1e3) return `${Math.round(bits)} bit/s`;
  if (bits < 1e6) return `${nf1.format(bits / 1e3)} kbit/s`;
  if (bits < 1e9) return `${nf1.format(bits / 1e6)} Mbit/s`;
  return `${nf1.format(bits / 1e9)} Gbit/s`;
}

export function formatEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  const h = Math.floor(s / 3600);
  return h >= 48 ? `${Math.round(h / 24)} j` : `${h} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
}

/**
 * Overall progress, speed and ETA of a running upload batch. Speed = bytes sent
 * over the last WINDOW_MS; it is re-evaluated every second so a stalled
 * transfer shows a falling speed instead of a frozen one.
 */
export function useTransferStats(items: UploadItem[], active: boolean) {
  const total = items.reduce((s, i) => s + i.file.size, 0);
  const loaded = items.reduce((s, i) => s + (i.status === 'done' ? i.file.size : (i.progress / 100) * i.file.size), 0);
  const samples = useRef<{ t: number; loaded: number }[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) { samples.current = []; return; }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const t = Date.now();
    samples.current.push({ t, loaded });
    samples.current = samples.current.filter((p) => t - p.t <= WINDOW_MS * 2);
  }, [loaded, active]);

  // Oldest sample still inside the window vs the current value.
  const recent = samples.current.filter((p) => now - p.t <= WINDOW_MS);
  const first = recent[0];
  const span = first ? (Math.max(now, first.t) - first.t) / 1000 : 0;
  const speed = first && span >= 1 ? Math.max(0, (loaded - first.loaded) / span) : null;
  const remaining = Math.max(0, total - loaded);
  const eta = speed && speed > 0 ? remaining / speed : null;
  return { total, loaded, percent: total ? (loaded / total) * 100 : 0, speed, eta };
}

export function TransferStats({ items, active }: { items: UploadItem[]; active: boolean }) {
  const { total, speed, eta } = useTransferStats(items, active);
  // Percent and bytes follow the bar (landed chunks); speed and ETA use the live byte count.
  const percent = useLandedPercent(total);
  const loaded = (total * percent) / 100;
  if (!active) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs tabular-nums">
      <span className="text-ink-2"><b className="text-ink">{Math.floor(percent)} %</b> · {formatBytes(loaded)} / {formatBytes(total)}</span>
      <span className="flex items-center gap-1.5 text-ink-2" title={speed !== null ? `${formatBytes(speed)}/s` : undefined}>
        <ArrowUp className="size-3.5 text-accent" />
        <b className="text-ink">{speed !== null ? formatBitrate(speed) : '—'}</b>
        <span className="text-ink-3">·</span>
        {percent >= 100 ? 'finalisation…' : eta !== null ? <>reste <b className="text-ink">{formatEta(eta)}</b></> : 'calcul…'}
      </span>
    </div>
  );
}
