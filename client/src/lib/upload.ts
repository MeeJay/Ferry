// Parallel chunked uploader (server side: server/src/routes/chunks.ts).
//
// Every file gets a session; its chunks go into one queue drained by up to
// `parallel` concurrent PUTs, so a single big file uses every slot and a batch
// of small files is sent several at a time. Each chunk is retried on its own.
// parallel = 0 is "auto": the Pacer below finds the right number on the fly.

export interface UploadItem {
  id: string;
  file: File;
  progress: number; // 0..100
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
  /** Per-chunk fill (0..1) while uploading. */
  chunks?: number[];
}

/** One chunk's life, for the animated chunk lane. */
export interface ChunkEvent {
  key: string;
  itemId: string;
  index: number;
  count: number;
  /** Size of this chunk: the overall bar grows by it when the chunk lands. */
  bytes: number;
  fraction: number;
  done: boolean;
}

interface Session { id: string; chunkSize: number; count: number }

const RETRY_DELAYS = [1000, 3000, 6000, 12000, 20000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class ChunkError extends Error {
  constructor(message: string, public retryable: boolean) { super(message); }
}

function apiError(xhrOrRes: { status: number }, body: string): ChunkError {
  let msg = `Erreur ${xhrOrRes.status}`;
  try { msg = JSON.parse(body).error || msg; } catch { /* not json */ }
  const s = xhrOrRes.status;
  return new ChunkError(msg, s === 0 || s === 408 || s === 429 || s >= 500);
}

async function json<T>(url: string, token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'X-Upload-Token': token, 'X-Requested-With': 'ferry', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw apiError(res, text);
  return (text ? JSON.parse(text) : {}) as T;
}

function putChunk(url: string, token: string, blob: Blob, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('X-Upload-Token', token);
    xhr.setRequestHeader('X-Requested-With', 'ferry');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(apiError(xhr, xhr.responseText)));
    xhr.onerror = () => reject(new ChunkError('Connexion interrompue', true));
    xhr.ontimeout = () => reject(new ChunkError('Délai dépassé', true));
    xhr.send(blob);
  });
}

/** Let a new level settle (socket buffers fill in a burst) before measuring it. */
const PACE_SETTLE_MS = 1500;
const PACE_MEASURE_MS = 2500;
/** A level must beat the previous one by this much to be kept. */
const PACE_GAIN = 1.08;
/** After finding the best level, stay there this long before probing again. */
const PACE_HOLD_MS = 20000;
/** While holding, a drop this deep means congestion: back off one level. */
const PACE_DROP = 0.6;

/**
 * Adaptive chunks-in-flight, like TCP's slow start: begin with 1, add one while
 * the aggregate throughput keeps rising, step back when it doesn't. Once the
 * best level is found it is held, then re-checked now and then, one step up or
 * one step down in turn, since network conditions change. Never above `max`.
 */
export class Pacer {
  target = 1;
  private sent = 0;
  private changedAt = performance.now();
  private windowAt = 0;
  private windowBytes = 0;
  private mode: 'up' | 'down' | 'hold' = 'up';
  /** Throughput at the level we came from, while probing (bytes / ms). */
  private ref = 0;
  private holdUntil = 0;
  /** Smoothed throughput while holding. */
  private steady = 0;
  private nextProbe: 'up' | 'down' = 'up';
  /** First window of a level that looked like a step back: one more look before deciding. */
  private doubt = 0;
  private timer: ReturnType<typeof setInterval>;

  constructor(private max: number, private onChange: (target: number) => void) {
    this.timer = setInterval(() => this.tick(), 500);
  }

  add(bytes: number) { this.sent += bytes; }
  stop() { clearInterval(this.timer); }

  private set(target: number, now: number) {
    target = Math.min(this.max, Math.max(1, target));
    if (target === this.target) return;
    this.target = target;
    this.changedAt = now;
    this.windowAt = 0;
    this.doubt = 0;
    this.onChange(target);
  }

  private hold(now: number, steady: number, target = this.target) {
    this.mode = 'hold';
    this.holdUntil = now + PACE_HOLD_MS;
    this.steady = steady;
    this.set(target, now);
  }

  private probe(dir: 'up' | 'down', now: number) {
    this.mode = dir;
    this.ref = this.steady;
    this.set(this.target + (dir === 'up' ? 1 : -1), now);
  }

  private tick() {
    const now = performance.now();
    if (now - this.changedAt < PACE_SETTLE_MS) return;
    if (!this.windowAt) { this.windowAt = now; this.windowBytes = this.sent; return; }
    if (now - this.windowAt < PACE_MEASURE_MS) return;
    const rate = (this.sent - this.windowBytes) / (now - this.windowAt);
    this.windowAt = now;
    this.windowBytes = this.sent;
    if (rate <= 0) return; // stalled (retry back-off…): nothing to learn

    switch (this.mode) {
      case 'up': {
        // Worth it: keep climbing. Not worth it (twice, windows are noisy): the level below was as good.
        const best = Math.max(rate, this.doubt);
        if (!this.ref || best > this.ref * PACE_GAIN) {
          this.ref = best;
          if (this.target < this.max) this.set(this.target + 1, now);
          else this.hold(now, best);
        } else if (!this.doubt) this.doubt = rate;
        else this.hold(now, this.ref, this.target - 1);
        return;
      }
      case 'down': {
        // Clearly slower: go back. About as fast (twice): keep shedding.
        if (rate * PACE_GAIN < this.ref) this.hold(now, this.ref, this.target + 1);
        else if (!this.doubt) this.doubt = rate;
        else {
          this.ref = Math.min(rate, this.doubt);
          if (this.target > 1) this.set(this.target - 1, now);
          else this.hold(now, this.ref);
        }
        return;
      }
      case 'hold': {
        if (this.steady && rate < this.steady * PACE_DROP && this.target > 1) {
          // Sudden collapse (congestion): back off right away.
          this.hold(now, 0, this.target - 1);
          return;
        }
        this.steady = this.steady ? this.steady * 0.6 + rate * 0.4 : rate;
        if (now < this.holdUntil) return;
        const dir = this.nextProbe;
        this.nextProbe = dir === 'up' ? 'down' : 'up';
        if (dir === 'up' && this.target < this.max) this.probe('up', now);
        else if (this.target > 1) this.probe('down', now);
        else if (this.target < this.max) this.probe('up', now);
        else this.holdUntil = now + PACE_HOLD_MS;
      }
    }
  }
}

export async function uploadAll(
  items: UploadItem[],
  token: string,
  /** parallel: fixed chunks in flight, or 0 = auto up to `max`. */
  opts: { parallel: number; max?: number; onParallel?: (n: number) => void },
  onUpdate: (id: string, patch: Partial<UploadItem>) => void,
  onChunk?: (e: ChunkEvent) => void,
): Promise<void> {
  const errors: string[] = [];
  const state = new Map<string, { item: UploadItem; session: Session; chunks: number[]; remaining: number; failed: boolean; lastEmit: number }>();
  const fail = (item: UploadItem, msg: string) => {
    const st = state.get(item.id);
    if (st) st.failed = true;
    errors.push(`${item.file.name} : ${msg}`);
    onUpdate(item.id, { status: 'error', error: msg, chunks: undefined });
  };

  const emitItem = (itemId: string, force = false) => {
    const st = state.get(itemId)!;
    const now = performance.now();
    if (!force && now - st.lastEmit < 100) return; // React-friendly rate
    st.lastEmit = now;
    const { size } = st.item.file;
    const { chunkSize, count } = st.session;
    let sent = 0;
    st.chunks.forEach((f, i) => { sent += f * (i === count - 1 ? size - i * chunkSize : chunkSize); });
    onUpdate(itemId, { progress: size ? (sent / size) * 100 : 100, chunks: [...st.chunks] });
  };

  async function complete(itemId: string) {
    const st = state.get(itemId)!;
    try {
      await json(`/api/chunks/${st.session.id}/complete`, token, 'POST');
      onUpdate(itemId, { status: 'done', progress: 100, chunks: undefined });
    } catch (err) { fail(st.item, (err as Error).message); }
  }

  // Sessions: pre-sized target files on the server.
  const queue: { itemId: string; index: number }[] = [];
  for (const item of items) {
    onUpdate(item.id, { status: 'uploading', progress: 0, error: undefined });
    try {
      const session = await json<Session>('/api/chunks', token, 'POST', {
        filename: item.file.name, filetype: item.file.type || 'application/octet-stream', size: item.file.size,
      });
      state.set(item.id, { item, session, chunks: new Array(session.count).fill(0), remaining: session.count, failed: false, lastEmit: 0 });
      if (session.count === 0) await complete(item.id);
      for (let i = 0; i < session.count; i++) queue.push({ itemId: item.id, index: i });
    } catch (err) { fail(item, (err as Error).message); }
  }

  const pacer = opts.parallel > 0 ? null
    : new Pacer(Math.max(1, opts.max ?? 1), (n) => { opts.onParallel?.(n); pump(); });

  async function sendWithRetry(itemId: string, index: number) {
    const st = state.get(itemId)!;
    const { session, item } = st;
    const start = index * session.chunkSize;
    const blob = item.file.slice(start, Math.min(item.file.size, start + session.chunkSize));
    const key = `${session.id}:${index}`;
    let lastChunkEmit = 0;
    for (let attempt = 0; ; attempt++) {
      // Show the chunk in the lane as soon as it leaves, before its first progress event.
      onChunk?.({ key, itemId, index, count: session.count, bytes: blob.size, fraction: 0, done: false });
      let sentBytes = 0;
      try {
        await putChunk(`/api/chunks/${session.id}/${index}`, token, blob, (fraction) => {
          const loaded = fraction * blob.size;
          if (loaded > sentBytes) { pacer?.add(loaded - sentBytes); sentBytes = loaded; }
          st.chunks[index] = fraction;
          emitItem(itemId);
          const now = performance.now();
          if (now - lastChunkEmit > 80) { lastChunkEmit = now; onChunk?.({ key, itemId, index, count: session.count, bytes: blob.size, fraction, done: false }); }
        });
        st.chunks[index] = 1;
        onChunk?.({ key, itemId, index, count: session.count, bytes: blob.size, fraction: 1, done: true });
        emitItem(itemId, true);
        return;
      } catch (err) {
        const e = err as ChunkError;
        st.chunks[index] = 0;
        if (!e.retryable || attempt >= RETRY_DELAYS.length || st.failed) throw e;
        await sleep(RETRY_DELAYS[attempt]);
      }
    }
  }

  async function run(task: { itemId: string; index: number }) {
    const st = state.get(task.itemId)!;
    if (st.failed) return;
    try {
      await sendWithRetry(task.itemId, task.index);
      if (--st.remaining === 0) await complete(task.itemId);
    } catch (err) {
      if (!st.failed) fail(st.item, (err as Error).message);
    }
  }

  // Start chunks while there are free slots; the target may move under us (auto).
  let active = 0;
  let finish!: () => void;
  const finished = new Promise<void>((r) => (finish = r));
  const limit = () => (pacer ? pacer.target : Math.max(1, opts.parallel));
  function pump() {
    while (active < limit() && queue.length) {
      active++;
      void run(queue.shift()!).finally(() => { active--; pump(); });
    }
    if (!active && !queue.length) finish();
  }

  opts.onParallel?.(limit());
  pump();
  await finished;
  pacer?.stop();
  if (errors.length) throw new Error(errors.join('\n'));
}

export const newId = () => Math.random().toString(36).slice(2, 10);
