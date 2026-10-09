import { create } from 'zustand';
import clsx from 'clsx';
import type { ChunkEvent, UploadItem } from '@/lib/upload';
import { Progress } from './ui';

/** How long a finished chunk takes to "land" in the overall bar. */
const LAND_MS = 520;

interface LaneChunk { key: string; index: number; count: number; fraction: number; landing: boolean }

interface LaneState {
  chunks: LaneChunk[];
  push: (e: ChunkEvent) => void;
  clear: () => void;
}

/** Chunks in flight across the whole batch, fed by uploadAll()'s onChunk. */
export const useChunkLane = create<LaneState>((set, get) => ({
  chunks: [],
  push(e) {
    const list = get().chunks;
    const i = list.findIndex((c) => c.key === e.key);
    const next = { key: e.key, index: e.index, count: e.count, fraction: e.fraction, landing: e.done };
    if (i === -1) set({ chunks: [...list, next] });
    else set({ chunks: list.map((c, j) => (j === i ? next : c)) });
    if (e.done) setTimeout(() => set({ chunks: get().chunks.filter((c) => c.key !== e.key) }), LAND_MS);
  },
  clear: () => set({ chunks: [] }),
}));

/**
 * Chunks filling side by side; each finished one drops into the overall bar
 * just below (the `chunk-land` animation) as that bar advances.
 */
export function ChunkLane({ parallel }: { parallel: number }) {
  const chunks = useChunkLane((s) => s.chunks);
  const flying = chunks.filter((c) => !c.landing).length;
  return (
    <div className="mb-1.5">
      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
        <span>Fragments en vol</span>
        <span className="tabular-nums">{flying} / {parallel}</span>
      </div>
      <div className="flex h-5 items-end gap-1">
        {chunks.slice(-Math.max(parallel * 2, 8)).map((c) => (
          <div key={c.key} className={clsx('flex min-w-[28px] max-w-[140px] flex-1 flex-col gap-0.5', c.landing && 'motion-safe:animate-chunk-land')}>
            <span className="truncate text-center font-mono text-[9px] leading-none text-ink-3">{c.index + 1}/{c.count}</span>
            <div className="h-1.5 overflow-hidden rounded-sm bg-surface-3">
              <div className="h-full rounded-sm bg-grad transition-[width] duration-150" style={{ width: `${Math.round(c.fraction * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Per-file bar split into its chunks (grouped into ≤ 40 segments for huge files). */
export function ChunkBar({ item }: { item: UploadItem }) {
  const chunks = item.chunks;
  if (!chunks || chunks.length <= 1) return <Progress value={item.progress} className="mt-2 !h-1.5" />;
  const buckets = Math.min(40, chunks.length);
  const per = chunks.length / buckets;
  const segments = Array.from({ length: buckets }, (_, b) => {
    const slice = chunks.slice(Math.floor(b * per), Math.floor((b + 1) * per));
    return slice.reduce((s, f) => s + f, 0) / Math.max(1, slice.length);
  });
  return (
    <div className="mt-2 flex h-1.5 gap-[2px]" title={`${chunks.filter((f) => f >= 1).length} / ${chunks.length} fragments`}>
      {segments.map((f, i) => (
        <div key={i} className="flex-1 overflow-hidden rounded-[2px] bg-surface-3">
          <div className={clsx('h-full transition-[width] duration-150', f >= 1 ? 'bg-accent' : 'bg-grad')} style={{ width: `${Math.round(f * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}
