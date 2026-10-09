// Parallel chunked uploader (server side: server/src/routes/chunks.ts).
//
// Every file gets a session; its chunks go into one queue shared by
// `parallel` workers, so a single big file uses every worker and a batch of
// small files is sent several at a time. Each chunk is retried on its own.

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

export async function uploadAll(
  items: UploadItem[],
  token: string,
  opts: { parallel: number },
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
      try {
        await putChunk(`/api/chunks/${session.id}/${index}`, token, blob, (fraction) => {
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

  async function worker() {
    for (let task = queue.shift(); task; task = queue.shift()) {
      const st = state.get(task.itemId)!;
      if (st.failed) continue;
      try {
        await sendWithRetry(task.itemId, task.index);
        if (--st.remaining === 0) await complete(task.itemId);
      } catch (err) {
        if (!st.failed) fail(st.item, (err as Error).message);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.parallel, queue.length || 1)) }, worker));
  if (errors.length) throw new Error(errors.join('\n'));
}

export const newId = () => Math.random().toString(36).slice(2, 10);
