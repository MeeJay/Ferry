import { create } from 'zustand';
import clsx from 'clsx';
import type { ChunkEvent, UploadItem } from '@/lib/upload';

/** How long a finished chunk takes to "land" in the overall bar. */
const LAND_MS = 520;
/** Bars while they fit; beyond this many chunks in flight, compact cubes take over. */
const LANE_BARS_UP_TO = 6;
/** Per-file gauge: one segment per chunk up to this many, compact cubes above. */
const FILE_BARS_UP_TO = 16;
/** Very big files: chunks are grouped so the gauge never exceeds this many cubes. */
const FILE_MAX_CUBES = 120;

interface LaneChunk { key: string; index: number; count: number; bytes: number; fraction: number; landing: boolean }

interface LaneState {
  chunks: LaneChunk[];
  /** Bytes of chunks that have landed: the overall bar is driven by this, not by raw progress. */
  landedBytes: number;
  push: (e: ChunkEvent) => void;
  clear: () => void;
}

/** Chunks in flight across the whole batch, fed by uploadAll()'s onChunk. */
export const useChunkLane = create<LaneState>((set, get) => ({
  chunks: [],
  landedBytes: 0,
  push(e) {
    const list = get().chunks;
    const i = list.findIndex((c) => c.key === e.key);
    if (i !== -1 && list[i].landing) return; // already landing: ignore late events
    const next = { key: e.key, index: e.index, count: e.count, bytes: e.bytes, fraction: e.fraction, landing: e.done };
    set({ chunks: i === -1 ? [...list, next] : list.map((c, j) => (j === i ? next : c)) });
    if (e.done) {
      // The bar grows when the chunk has dropped into it, not before.
      setTimeout(() => set({ chunks: get().chunks.filter((c) => c.key !== e.key), landedBytes: get().landedBytes + e.bytes }), LAND_MS);
    }
  },
  clear: () => set({ chunks: [], landedBytes: 0 }),
}));

/** Overall percentage as shown by the bar: landed chunks only. */
export function useLandedPercent(total: number): number {
  const landed = useChunkLane((s) => s.landedBytes);
  return total ? Math.min(100, (landed / total) * 100) : 0;
}

function Cube({ c }: { c: LaneChunk }) {
  return (
    <div className={clsx('flex flex-col items-center gap-0.5', c.landing && 'motion-safe:animate-chunk-land')}>
      <div className="relative size-5 overflow-hidden rounded-[4px] bg-surface-3" title={`Fragment ${c.index + 1}/${c.count}`}>
        {/* fills from the bottom */}
        <div className="absolute inset-x-0 bottom-0 bg-grad transition-[height] duration-150" style={{ height: `${Math.round(c.fraction * 100)}%` }} />
      </div>
    </div>
  );
}

function Bar({ c }: { c: LaneChunk }) {
  return (
    <div className={clsx('flex min-w-[28px] max-w-[140px] flex-1 flex-col gap-0.5', c.landing && 'motion-safe:animate-chunk-land')}>
      <span className="truncate text-center font-mono text-[9px] leading-none text-ink-3">{c.index + 1}/{c.count}</span>
      <div className="h-1.5 overflow-hidden rounded-sm bg-surface-3">
        <div className="h-full rounded-sm bg-grad transition-[width] duration-150" style={{ width: `${Math.round(c.fraction * 100)}%` }} />
      </div>
    </div>
  );
}

/**
 * Chunks filling side by side; each finished one drops into the overall bar
 * just below (the `chunk-land` animation), which only then advances.
 */
export function ChunkLane({ parallel, auto }: { parallel: number; auto?: boolean }) {
  const chunks = useChunkLane((s) => s.chunks);
  const flying = chunks.filter((c) => !c.landing).length;
  const cubes = parallel > LANE_BARS_UP_TO;
  const shown = chunks.slice(-Math.max(parallel * 2, 8));
  const count = chunks[0]?.count;
  return (
    <div className="mb-1.5">
      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
        <span>Fragments en vol{count ? <span className="normal-case tracking-normal"> · sur {count}</span> : null}</span>
        <span className="tabular-nums">
          {auto && <span className="mr-1.5 rounded-sm bg-accent/15 px-1 py-px text-[9px] tracking-[0.08em] text-accent" title="Ajusté en continu selon le débit mesuré">Auto</span>}
          {flying} / {parallel}
        </span>
      </div>
      <div className={clsx('flex items-end', cubes ? 'min-h-6 flex-wrap gap-1' : 'h-5 gap-1')}>
        {shown.map((c) => (cubes ? <Cube key={c.key} c={c} /> : <Bar key={c.key} c={c} />))}
      </div>
    </div>
  );
}

/** Per-file gauge: a segmented line while it fits, compact cubes once chunks are many. */
export function ChunkBar({ item }: { item: UploadItem }) {
  const chunks = item.chunks;
  if (!chunks || chunks.length <= 1) {
    return (
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-grad transition-[width] duration-150" style={{ width: `${item.progress}%` }} />
      </div>
    );
  }
  const title = `${chunks.filter((f) => f >= 1).length} / ${chunks.length} fragments`;
  if (chunks.length <= FILE_BARS_UP_TO) {
    return (
      <div className="mt-2 flex h-1.5 gap-[2px]" title={title}>
        {chunks.map((f, i) => (
          <div key={i} className="flex-1 overflow-hidden rounded-[2px] bg-surface-3">
            <div className={clsx('h-full transition-[width] duration-150', f >= 1 ? 'bg-accent' : 'bg-grad')} style={{ width: `${Math.round(f * 100)}%` }} />
          </div>
        ))}
      </div>
    );
  }
  const buckets = Math.min(FILE_MAX_CUBES, chunks.length);
  const per = chunks.length / buckets;
  const cubes = Array.from({ length: buckets }, (_, b) => {
    const slice = chunks.slice(Math.floor(b * per), Math.floor((b + 1) * per));
    return slice.reduce((s, f) => s + f, 0) / Math.max(1, slice.length);
  });
  return (
    <div className="mt-2 flex flex-wrap gap-[3px]" title={title}>
      {cubes.map((f, i) => (
        <div key={i} className="relative size-2.5 overflow-hidden rounded-[2px] bg-surface-3">
          <div className={clsx('absolute inset-x-0 bottom-0 transition-[height] duration-150', f >= 1 ? 'bg-accent' : 'bg-grad')} style={{ height: `${Math.round(f * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}
