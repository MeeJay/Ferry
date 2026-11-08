import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Request } from 'express';
import type { Visibility } from '@ferry/shared';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { assertCapacity, createPendingShare, finalizeShare, HttpError, purgeShare, shareDTO, type PlannedFile, type ShareRow } from './shares.js';
import { effectiveLimits } from './users.js';
import { baseUrl } from '../utils/http.js';
import type { AiKeyContext } from './aiKeys.js';

// Uploads of AI agents. The agent announces its files through MCP and gets one
// upload URL per file; it then sends the bytes itself (curl -T), in one request
// or in resumable pieces (Content-Range). Bytes never go through MCP.
//   PUT {base}/api/agent-upload/{upload token}/{index}   (routes/agentUpload.ts)
// The upload token is the pending share's own token: a capability that only
// accepts the announced files and dies with the share (finalized, cancelled,
// or swept after 24 h).

export const MAX_AGENT_FILES = 50;
export const partPath = (shareId: string, index: number) => path.join(config.dirs.tus, `agent-${shareId}-${index}.part`);

export interface AgentUploadInput {
  files: { name: string; size?: number | null }[];
  title?: string | null;
  message?: string | null;
  visibility?: Visibility;
  expiryHours?: number | null;
  maxDownloads?: number | null;
}

export function uploadUrl(req: Request, share: ShareRow, index: number) {
  return `${baseUrl(req)}/api/agent-upload/${share.upload_token}/${index}`;
}

export async function createAgentUpload(req: Request, ctx: AiKeyContext, input: AgentUploadInput): Promise<ShareRow> {
  const limits = await effectiveLimits(ctx.user);
  const names = new Set<string>();
  let total = 0;
  for (const f of input.files) {
    const n = f.name.trim();
    if (!n || n.length > 255 || /[\\/\0]/.test(n)) throw new HttpError(400, `Invalid file name: ${JSON.stringify(f.name)} (a plain name, no folder)`);
    if (names.has(n)) throw new HttpError(400, `File announced twice: ${n}`);
    names.add(n);
    if (f.size != null) {
      if (limits.maxFileSize && f.size > limits.maxFileSize) throw new HttpError(413, `${n}: larger than the per-file limit`);
      total += f.size;
    }
  }
  assertCapacity(limits, 0, total);
  if (input.visibility === 'public' && !limits.allowPublic) throw new HttpError(403, 'Public links are not allowed for this account: the share would need a sign-in to download');

  const share = await createPendingShare(ctx.user, {
    source: 'mcp',
    title: input.title,
    message: input.message,
    visibility: input.visibility ?? (limits.allowPublic ? 'public' : 'private'),
    expiryHours: input.expiryHours,
    maxDownloads: input.maxDownloads,
    expectedFiles: input.files.length,
  });
  const plan: PlannedFile[] = input.files.map((f) => ({ name: f.name.trim(), size: f.size ?? null, done: false }));
  const [row] = await db<ShareRow>('shares').where({ id: share.id })
    .update({ upload_plan: JSON.stringify(plan) as any, ai_key_id: ctx.key.id }).returning('*');
  return row;
}

/** A share of the key's owner; `pending` = still receiving files. */
export async function ownShare(ctx: AiKeyContext, id: unknown, opts: { pending?: boolean } = {}): Promise<ShareRow> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'A share id (uuid) is expected');
  const share = await db<ShareRow>('shares').where({ id, owner_id: ctx.user.id }).first();
  if (!share || share.status === 'deleted') throw new HttpError(404, 'Share not found');
  if (opts.pending && (share.status !== 'pending' || !share.upload_plan)) throw new HttpError(409, 'This upload is already finished');
  return share;
}

export async function receivedBytes(share: ShareRow, index: number): Promise<number> {
  const st = await fsp.stat(partPath(share.id, index)).catch(() => null);
  return st?.size ?? 0;
}

export async function planStatus(req: Request, share: ShareRow) {
  const plan = share.upload_plan ?? [];
  return Promise.all(plan.map(async (f, index) => ({
    index, name: f.name, size: f.size, done: f.done,
    received: f.done ? f.size : await receivedBytes(share, index),
    ...(f.done || share.status !== 'pending' ? {} : { uploadUrl: uploadUrl(req, share, index) }),
  })));
}

/** What an agent needs to hand a share to someone, or to curl it on a machine. */
export async function shareLinks(req: Request, share: ShareRow) {
  const dto = await shareDTO(share);
  const abs = (p: string) => `${baseUrl(req)}${p}`;
  return {
    id: dto.id,
    status: dto.status,
    title: dto.title,
    page: dto.url ? abs(dto.url) : null,
    // One file: its bytes; several: a zip of all of them.
    download: dto.url ? abs(`/raw${dto.url}`) : null,
    visibility: dto.visibility,
    signInRequired: dto.visibility === 'private',
    hasPassword: dto.hasPassword,
    expiresAt: dto.expiresAt,
    maxDownloads: dto.maxDownloads,
    downloads: dto.downloads,
    totalSize: dto.totalSize,
    source: dto.source,
    createdAt: dto.createdAt,
    files: dto.files.map((f) => ({ name: f.name, size: f.size, mime: f.mime, download: abs(f.rawUrl), page: abs(f.url) })),
  };
}

// One finalization at a time per share (the last two files may land together).
const finishing = new Map<string, Promise<ShareRow>>();

/** Publishes the share with the files received so far; parts never completed are dropped. */
export function finishAgentUpload(share: ShareRow): Promise<ShareRow> {
  const running = finishing.get(share.id);
  if (running) return running;
  const job = (async () => {
    const fresh = await db<ShareRow>('shares').where({ id: share.id }).first();
    if (!fresh) throw new HttpError(404, 'Share not found');
    if (fresh.status !== 'pending') return fresh;
    if (!fresh.file_count) throw new HttpError(409, 'No file received yet: send at least one file before finishing');
    await dropParts(fresh);
    return finalizeShare(fresh.id);
  })().finally(() => finishing.delete(share.id));
  finishing.set(share.id, job);
  return job;
}

export async function cancelAgentUpload(share: ShareRow) {
  await dropParts(share);
  await purgeShare(share, 'deleted');
}

async function dropParts(share: ShareRow) {
  for (let i = 0; i < (share.upload_plan?.length ?? 0); i++) await fsp.rm(partPath(share.id, i), { force: true });
}

/** Parts of uploads abandoned for more than 24 h (their pending share is swept by cleanup.ts). */
export async function cleanupAgentParts() {
  const cutoff = Date.now() - 24 * 3600_000;
  for (const f of await fsp.readdir(config.dirs.tus).catch(() => [] as string[])) {
    if (!f.startsWith('agent-') || !f.endsWith('.part')) continue;
    const p = path.join(config.dirs.tus, f);
    const st = await fsp.stat(p).catch(() => null);
    if (st && st.mtimeMs < cutoff) await fsp.rm(p, { force: true });
  }
}
