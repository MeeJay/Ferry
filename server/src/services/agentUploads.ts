import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Request } from 'express';
import type { Visibility } from '@ferry/shared';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { assertCapacity, createPendingShare, finalizeShare, HttpError, purgeShare, shareDTO, type PlannedFile, type ShareRow } from './shares.js';
import { effectiveLimits } from './users.js';
import { baseUrl } from '../utils/http.js';
import { sha256, type AiKeyContext } from './aiKeys.js';

// Uploads of AI agents. The agent announces its files through MCP and gets one
// upload URL per file; it then sends the bytes itself (curl -T), in one request
// or in resumable pieces (Content-Range). Bytes never go through MCP.
//   PUT {base}/api/agent-upload/{file token}   (routes/agentUpload.ts)
// Each file has its own random token (only its sha256 is kept in upload_plan):
// it accepts that one file, once (refused when the file is complete), until the
// upload window the agent chose closes or the share is published / cancelled.
// It is the only credential the sending machine needs: never the AI key. The
// share's own upload_token is never handed out (tus / chunks refuse 'mcp' shares).

export const MAX_AGENT_FILES = 50;
export const DEFAULT_WINDOW_MIN = 120;
export const MAX_WINDOW_MIN = 24 * 60;
const TOKEN_RE = /^fup_[A-Za-z0-9_-]{43}$/;
export const partPath = (shareId: string, index: number) => path.join(config.dirs.tus, `agent-${shareId}-${index}.part`);

export interface AgentUploadInput {
  files: { name: string; size?: number | null }[];
  title?: string | null;
  message?: string | null;
  visibility?: Visibility;
  expiryHours?: number | null;
  maxDownloads?: number | null;
  password?: string | null;
  notifyOnDownload?: boolean;
  /** How long the upload URLs work (minutes). */
  windowMinutes?: number | null;
}

const newFileToken = () => {
  const token = `fup_${crypto.randomBytes(32).toString('base64url')}`;
  return { token, key: sha256(token) };
};

export const uploadUrl = (req: Request, token: string) => `${baseUrl(req)}/api/agent-upload/${token}`;

/** The pending agent upload a file token belongs to, with the file's index. */
export async function findByFileToken(token: unknown): Promise<{ share: ShareRow; index: number } | null> {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const key = sha256(token);
  const share = await db<ShareRow>('shares').where({ status: 'pending', source: 'mcp' })
    .whereRaw('upload_plan @> ?::jsonb', [JSON.stringify([{ key }])]).first();
  const index = share?.upload_plan?.findIndex((f) => f.key === key) ?? -1;
  return share && index >= 0 ? { share, index } : null;
}

export const windowClosed = (share: ShareRow) => !!share.upload_expires_at && new Date(share.upload_expires_at).getTime() <= Date.now();

export async function createAgentUpload(req: Request, ctx: AiKeyContext, input: AgentUploadInput): Promise<{ share: ShareRow; urls: string[] }> {
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
    password: input.password || null,
    notifyOnDownload: !!input.notifyOnDownload,
    expectedFiles: input.files.length,
  });
  const tokens = input.files.map(() => newFileToken());
  const plan: PlannedFile[] = input.files.map((f, i) => ({ name: f.name.trim(), size: f.size ?? null, done: false, key: tokens[i].key }));
  const minutes = Math.min(Math.max(input.windowMinutes ?? DEFAULT_WINDOW_MIN, 5), MAX_WINDOW_MIN);
  const [row] = await db<ShareRow>('shares').where({ id: share.id }).update({
    upload_plan: JSON.stringify(plan) as any, ai_key_id: ctx.key.id, upload_expires_at: new Date(Date.now() + minutes * 60_000),
  }).returning('*');
  return { share: row, urls: tokens.map((t) => uploadUrl(req, t.token)) };
}

/**
 * New upload URLs for the files not complete yet; the previous ones stop
 * working (a leaked URL, or a lost answer). Bytes already stored are kept.
 * `minutes` reopens / extends the window.
 */
export async function renewUploadUrls(req: Request, share: ShareRow, minutes: number | null) {
  const urls: Record<number, string> = {};
  // Key by key (jsonb_set): a file completing meanwhile keeps its done flag.
  for (const [i, f] of (share.upload_plan ?? []).entries()) {
    if (f.done) continue;
    const t = newFileToken();
    const n = await db('shares').where({ id: share.id, status: 'pending' })
      .update({ upload_plan: db.raw('jsonb_set(upload_plan, ?, to_jsonb(?::text))', [`{${i},key}`, t.key]) });
    if (!n) throw new HttpError(409, 'This upload is already finished');
    urls[i] = uploadUrl(req, t.token);
  }
  if (minutes) {
    await db('shares').where({ id: share.id, status: 'pending' })
      .update({ upload_expires_at: new Date(Date.now() + Math.min(Math.max(minutes, 5), MAX_WINDOW_MIN) * 60_000) });
  }
  const row = await db<ShareRow>('shares').where({ id: share.id }).first();
  if (row?.status !== 'pending') throw new HttpError(409, 'This upload is already finished');
  return { share: row, urls };
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

export async function planStatus(share: ShareRow) {
  const plan = share.upload_plan ?? [];
  return Promise.all(plan.map(async (f, index) => ({
    index, name: f.name, size: f.size, done: f.done,
    received: f.done ? f.size : await receivedBytes(share, index),
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
