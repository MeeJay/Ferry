import { create } from 'zustand';
import toast from 'react-hot-toast';
import type { CreateShareInput, LinkOptions, ShareDTO, Visibility } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';
import { useChunkLane } from '@/components/ChunkLane';
import { newId, uploadAll, type UploadItem } from '@/lib/upload';

// The "Envoyer" page state lives here, not in the page component, so a
// transfer survives navigation: the sidebar shows it, and coming back to
// /  shows the same transfer (or its link once done).

export type TransferPhase = 'pick' | 'configure' | 'uploading' | 'done';

export interface TransferForm {
  title: string;
  message: string;
  /** null = the user's default (from their limits). */
  visibility: Visibility | null;
  expiry: number | null;
  password: string;
  usePassword: boolean;
  maxDownloads: string;
  notify: boolean;
  recipients: string[];
  linkOverride: Partial<LinkOptions>;
}

const EMPTY_FORM: TransferForm = {
  title: '', message: '', visibility: null, expiry: null, password: '', usePassword: false,
  maxDownloads: '', notify: false, recipients: [], linkOverride: {},
};

interface TransferState extends TransferForm {
  phase: TransferPhase;
  items: UploadItem[];
  result: ShareDTO | null;
  /** Chunks in flight right now (moves during an auto transfer). */
  parallel: number;
  /** Adaptive mode: the uploader picks `parallel` from the measured speed. */
  auto: boolean;
  /** Recipients the finished share was mailed to (for the done screen). */
  sentTo: number;
  set: <K extends keyof TransferForm>(key: K, value: TransferForm[K]) => void;
  addFiles: (files: File[]) => void;
  removeItem: (id: string) => void;
  reset: () => void;
  send: (options: CreateShareInput) => Promise<void>;
}

export const useTransfer = create<TransferState>((set, get) => ({
  ...EMPTY_FORM,
  phase: 'pick',
  items: [],
  result: null,
  parallel: 1,
  auto: false,
  sentTo: 0,

  set: (key, value) => set({ [key]: value } as Partial<TransferState>),

  addFiles(files) {
    const { items, phase } = get();
    if (phase === 'uploading') return;
    const known = new Set(items.map((i) => `${i.file.name}:${i.file.size}`));
    const added = files.filter((f) => !known.has(`${f.name}:${f.size}`)).map((file) => ({ id: newId(), file, progress: 0, status: 'queued' as const }));
    set({
      items: phase === 'done' ? added : [...items, ...added],
      phase: 'configure',
      ...(phase === 'done' ? { ...EMPTY_FORM, result: null } : {}),
    });
  },

  removeItem(id) {
    const items = get().items.filter((i) => i.id !== id);
    set({ items, phase: items.length ? get().phase : 'pick' });
  },

  reset() {
    if (get().phase === 'uploading') return;
    set({ ...EMPTY_FORM, phase: 'pick', items: [], result: null, sentTo: 0 });
  },

  async send(options) {
    const { items, recipients } = get();
    if (!items.length || get().phase === 'uploading') return;
    set({ phase: 'uploading' });
    const update = (id: string, patch: Partial<UploadItem>) =>
      set({ items: get().items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
    try {
      const share = await api.post<{ id: string; uploadToken: string; parallel: number; parallelMax: number }>('/api/shares', {
        ...options,
        files: items.map((i) => ({ name: i.file.name, size: i.file.size })),
      });
      set({ auto: !share.parallel, parallel: share.parallel || 1 });
      useChunkLane.getState().clear();
      await uploadAll(items, share.uploadToken, { parallel: share.parallel, max: share.parallelMax, onParallel: (parallel) => set({ parallel }) },
        update, useChunkLane.getState().push);
      const done = await api.post<ShareDTO>(`/api/shares/${share.id}/finalize`, { recipients });
      set({ result: done, phase: 'done', sentTo: recipients.length });
      useApp.getState().refreshMe();
      // Visible even when the user is on another page.
      toast.success('Transfert terminé, le lien est prêt');
    } catch (err) {
      toast.error(errorMessage(err), { duration: 6000 });
      set({ items: get().items.map((i) => ({ ...i, status: 'queued', progress: 0, chunks: undefined })), phase: 'configure' });
    }
  },
}));

/** Weighted progress (0..100) of the current batch. */
export function batchProgress(items: UploadItem[]): number {
  const total = items.reduce((s, i) => s + i.file.size, 0);
  if (!total) return items.length && items.every((i) => i.status === 'done') ? 100 : 0;
  return (items.reduce((s, i) => s + (i.status === 'done' ? i.file.size : (i.progress / 100) * i.file.size), 0) / total) * 100;
}
