import * as tus from 'tus-js-client';

export interface UploadItem {
  id: string;
  file: File;
  progress: number; // 0..100
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
}

/**
 * Uploads files with tus (resumable, chunked). The chunk size comes from the
 * server so every request stays below the body limit of the reverse proxy.
 */
export async function uploadAll(
  items: UploadItem[],
  token: string,
  chunkSize: number,
  onUpdate: (id: string, patch: Partial<UploadItem>) => void,
  concurrency = 3,
): Promise<void> {
  const queue = [...items];
  const errors: string[] = [];

  const one = (item: UploadItem) => new Promise<void>((resolve) => {
    onUpdate(item.id, { status: 'uploading', progress: 0 });
    const upload = new tus.Upload(item.file, {
      endpoint: '/api/upload',
      chunkSize,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      removeFingerprintOnSuccess: true,
      metadata: {
        token,
        filename: item.file.name,
        filetype: item.file.type || 'application/octet-stream',
      },
      onProgress: (sent, total) => onUpdate(item.id, { progress: total ? (sent / total) * 100 : 100 }),
      onSuccess: () => { onUpdate(item.id, { status: 'done', progress: 100 }); resolve(); },
      onError: (err) => {
        let msg = err.message;
        const body = (err as tus.DetailedError).originalResponse?.getBody();
        try { msg = JSON.parse(body ?? '').error || msg; } catch { /* not json */ }
        errors.push(`${item.file.name} : ${msg}`);
        onUpdate(item.id, { status: 'error', error: msg });
        resolve();
      },
    });
    upload.start();
  });

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) await one(item);
  }));
  if (errors.length) throw new Error(errors.join('\n'));
}

export const newId = () => Math.random().toString(36).slice(2, 10);
