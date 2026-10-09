import crypto from 'node:crypto';
import type { Request } from 'express';
import {
  cleanExtension, formatBytes, randomString, sanitizeSegment, splitExtension,
  type CreateShareInput, type EffectiveLimits, type FileDTO, type LinkOptions, type ShareDTO, type ShareSource, type Visibility,
} from '@ferry/shared';
import { db } from '../db/knex.js';
import { logger } from '../logger.js';
import { activeDriver, driverFor } from './storage.js';
import { allocateLink, linkPath } from './links.js';
import { deleteThumb, makeThumb } from './thumbs.js';
import { effectiveLimits, getUser, hashPassword, type UserRow } from './users.js';
import { notifyEvent } from './mail.js';
import { absoluteUrl, baseUrl } from '../utils/http.js';

export interface ShareRow {
  id: string;
  owner_id: string;
  kind: 'files' | 'url';
  prefix: string | null;
  slug: string | null;
  title: string | null;
  message: string | null;
  visibility: Visibility;
  password_hash: string | null;
  expires_at: Date | null;
  max_downloads: number | null;
  download_count: number;
  source: ShareSource;
  status: 'pending' | 'ready' | 'expired' | 'deleted';
  request_id: string | null;
  upload_token: string | null;
  delete_token: string;
  total_size: string | number;
  file_count: number;
  expected_files: number | null;
  target_url: string | null;
  notify_on_download: boolean;
  download_notified: boolean;
  link_override: Partial<LinkOptions> | null;
  uploader_name: string | null;
  uploader_email: string | null;
  uploader_ip: string | null;
  created_at: Date;
  finalized_at: Date | null;
  purged_at: Date | null;
}

export interface FileRow {
  id: string;
  share_id: string;
  name: string;
  slug: string;
  mime: string;
  size: string | number;
  storage_driver: string;
  storage_key: string;
  has_thumb: boolean;
  download_count: number;
  created_at: Date;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// ── Policy helpers ─────────────────────────────────────────────────────────

export function computeExpiry(limits: Pick<EffectiveLimits, 'defaultExpiryHours' | 'maxExpiryHours' | 'allowNeverExpire'>, hours: number | null | undefined): Date | null {
  let h = hours === undefined || hours === null ? limits.defaultExpiryHours : hours;
  if (h <= 0) {
    if (limits.allowNeverExpire) return null;
    h = limits.maxExpiryHours > 0 ? limits.maxExpiryHours : limits.defaultExpiryHours || 168;
  }
  if (limits.maxExpiryHours > 0) h = Math.min(h, limits.maxExpiryHours);
  return new Date(Date.now() + h * 3600_000);
}

export function resolveVisibility(limits: EffectiveLimits, v: Visibility | undefined): Visibility {
  const wanted = v ?? limits.defaultVisibility;
  return wanted === 'public' && !limits.allowPublic ? 'private' : wanted;
}

/** Checks that `incoming` more bytes fit the user's quota and per-share cap. */
export function assertCapacity(limits: EffectiveLimits, shareSize: number, incoming: number, fileSize?: number) {
  if (fileSize !== undefined && limits.maxFileSize > 0 && fileSize > limits.maxFileSize) {
    throw new HttpError(413, 'Fichier trop volumineux');
  }
  if (limits.maxShareSize > 0 && shareSize + incoming > limits.maxShareSize) {
    throw new HttpError(413, 'Taille maximale du partage dépassée');
  }
  if (limits.storageQuota > 0 && limits.storageUsed + incoming > limits.storageQuota) {
    throw new HttpError(413, 'Quota de stockage atteint');
  }
}

export function isExpired(s: Pick<ShareRow, 'expires_at' | 'max_downloads' | 'download_count'>): false | 'expired' | 'limit' {
  if (s.expires_at && new Date(s.expires_at).getTime() <= Date.now()) return 'expired';
  if (s.max_downloads && s.download_count >= s.max_downloads) return 'limit';
  return false;
}

export function displayStatus(s: ShareRow): ShareDTO['status'] {
  if (s.status === 'ready' && isExpired(s)) return 'expired';
  return s.status;
}

// ── DTO ────────────────────────────────────────────────────────────────────

function fileDTO(share: ShareRow, f: FileRow): FileDTO {
  const single = share.file_count <= 1;
  const page = single ? linkPath(share.prefix, share.slug) : linkPath(share.prefix, share.slug, f.slug);
  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    mime: f.mime,
    size: Number(f.size),
    hasThumb: f.has_thumb,
    url: page,
    rawUrl: `/raw${page}`,
    downloads: f.download_count,
  };
}

export async function shareDTO(share: ShareRow, opts: { withOwner?: boolean; files?: FileRow[] } = {}): Promise<ShareDTO> {
  const files = opts.files ?? (await db<FileRow>('files').where({ share_id: share.id }).orderBy('created_at'));
  const dto: ShareDTO = {
    id: share.id,
    kind: share.kind,
    prefix: share.prefix ?? '',
    slug: share.slug ?? '',
    url: share.slug ? linkPath(share.prefix, share.slug) : '',
    title: share.title,
    message: share.message,
    visibility: share.visibility,
    hasPassword: !!share.password_hash,
    expiresAt: share.expires_at ? new Date(share.expires_at).toISOString() : null,
    maxDownloads: share.max_downloads,
    downloads: share.download_count,
    source: share.source,
    status: displayStatus(share),
    totalSize: Number(share.total_size),
    fileCount: share.file_count,
    files: files.map((f) => fileDTO(share, f)),
    targetUrl: share.target_url,
    createdAt: new Date(share.created_at).toISOString(),
    requestId: share.request_id,
    notifyOnDownload: share.notify_on_download,
    uploader: share.source === 'request'
      ? { name: share.uploader_name, email: share.uploader_email, ip: share.uploader_ip }
      : null,
  };
  if (opts.withOwner) {
    const o = await db('users').where({ id: share.owner_id }).first('id', 'username', 'display_name');
    if (o) dto.owner = { id: o.id, username: o.username, displayName: o.display_name };
  }
  return dto;
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

export const newToken = () => crypto.randomBytes(24).toString('base64url');

export async function createPendingShare(owner: UserRow, input: CreateShareInput & {
  source: ShareSource;
  expectedFiles?: number | null;
  requestId?: string | null;
  uploader?: { name?: string | null; email?: string | null; ip?: string | null };
  expiresAt?: Date | null;
  kind?: ShareRow['kind'];
  targetUrl?: string | null;
}): Promise<ShareRow> {
  const limits = await effectiveLimits(owner);
  const visibility = input.source === 'request' ? 'private' : resolveVisibility(limits, input.visibility);
  const expiresAt = input.expiresAt !== undefined ? input.expiresAt : computeExpiry(limits, input.expiryHours);
  const [row] = await db<ShareRow>('shares').insert({
    owner_id: owner.id,
    kind: input.kind ?? 'files',
    title: input.title?.trim() || null,
    message: input.message?.trim() || null,
    visibility,
    password_hash: input.password ? await hashPassword(input.password) : null,
    expires_at: expiresAt,
    max_downloads: input.maxDownloads && input.maxDownloads > 0 ? input.maxDownloads : null,
    source: input.source,
    status: 'pending',
    request_id: input.requestId ?? null,
    upload_token: newToken(),
    delete_token: newToken(),
    expected_files: input.expectedFiles ?? null,
    target_url: input.targetUrl ?? null,
    notify_on_download: !!input.notifyOnDownload,
    link_override: input.linkOverride ? JSON.stringify(input.linkOverride) as any : null,
    uploader_name: input.uploader?.name?.trim() || null,
    uploader_email: input.uploader?.email?.trim() || null,
    uploader_ip: input.uploader?.ip ?? null,
  }).returning('*');
  return row;
}

/** Moves a completed temp file into storage and attaches it to the share. */
export async function ingestFile(share: ShareRow, tmpPath: string, name: string, mime: string, size: number): Promise<FileRow> {
  const id = crypto.randomUUID();
  const hasThumb = await makeThumb(id, tmpPath, mime);
  const driver = await activeDriver();
  const key = `${share.id}/${id}`;
  await driver.put(key, tmpPath, mime);

  const [base, ext] = splitExtension(name);
  const cleanBase = sanitizeSegment(base, true);
  const cleanExt = cleanExtension(ext);
  for (let i = 0; i < 100; i++) {
    const slug = `${i ? `${cleanBase}-${i + 1}` : cleanBase}${cleanExt}`;
    const inserted = await db<FileRow>('files')
      .insert({ id, share_id: share.id, name: name.slice(0, 255), slug, mime, size, storage_driver: driver.name, storage_key: key, has_thumb: hasThumb })
      .onConflict(['share_id', 'slug']).ignore()
      .returning('*');
    if (inserted.length) {
      await db('shares').where({ id: share.id }).update({
        total_size: db.raw('total_size + ?', [size]),
        file_count: db.raw('file_count + 1'),
      });
      return inserted[0];
    }
  }
  await driver.delete(key);
  throw new HttpError(409, 'Nom de fichier en conflit');
}

// ── Background ingestion ────────────────────────────────────────────────────
// The last tus chunk is acknowledged immediately and the file is moved into
// storage in the background (an S3 upload of a large file can outlast any
// proxy timeout). finalizeShare() waits for these jobs before publishing.

const ingesting = new Map<string, Set<Promise<void>>>();
const ingestErrors = new Map<string, string[]>();

export function trackIngest(shareId: string, job: Promise<void>, fileName: string) {
  const jobs = ingesting.get(shareId) ?? new Set();
  const tracked = job.catch((err: any) => {
    ingestErrors.set(shareId, [...(ingestErrors.get(shareId) ?? []), `« ${fileName} » : ${err instanceof HttpError ? err.message : 'échec de l’enregistrement'}`]);
  }).finally(() => {
    jobs.delete(tracked);
    if (!jobs.size) ingesting.delete(shareId);
  });
  jobs.add(tracked);
  ingesting.set(shareId, jobs);
}

async function waitForIngest(shareId: string) {
  for (let jobs = ingesting.get(shareId); jobs?.size; jobs = ingesting.get(shareId)) await Promise.all([...jobs]);
  const errors = ingestErrors.get(shareId);
  if (errors?.length) {
    ingestErrors.delete(shareId);
    throw new HttpError(500, `Échec de l’enregistrement — ${errors.join(' ; ')}`);
  }
}

export async function finalizeShare(shareId: string): Promise<ShareRow> {
  await waitForIngest(shareId);
  const share = await db<ShareRow>('shares').where({ id: shareId }).first();
  if (!share) throw new HttpError(404, 'Partage introuvable');
  if (share.status !== 'pending') return share;
  const owner = await getUser(share.owner_id);
  if (!owner) throw new HttpError(404, 'Propriétaire introuvable');

  let original: string;
  if (share.kind === 'url') {
    // A hostname title ("www.example.fr") must not yield a ".fr" extension.
    original = (share.title || 'lien').replace(/\./g, '-');
  } else {
    const files = await db<FileRow>('files').where({ share_id: share.id }).orderBy('created_at');
    if (!files.length) throw new HttpError(400, 'Aucun fichier reçu');
    original = files.length === 1 ? files[0].name : share.title || 'partage';
  }

  const linkSource = share.source === 'request' ? 'web' : share.source;
  const { prefix, slug } = await allocateLink({
    owner, source: linkSource, kind: 'share', targetId: share.id, original,
    visibility: share.visibility, override: share.link_override,
  });
  const [row] = await db<ShareRow>('shares').where({ id: share.id }).update({
    prefix, slug, status: 'ready', upload_token: null, finalized_at: db.fn.now() as any,
  }).returning('*');
  return row;
}

/** Deletes stored bytes. `status` records why (expired keeps the row for the admin history). */
export async function purgeShare(share: ShareRow, status: 'expired' | 'deleted', dropLink = status === 'deleted') {
  const files = await db<FileRow>('files').where({ share_id: share.id });
  for (const f of files) {
    try {
      await (await driverFor(f.storage_driver)).delete(f.storage_key);
    } catch (err: any) {
      logger.warn({ err: err.message, file: f.id }, 'storage delete failed');
    }
    await deleteThumb(f.id);
  }
  await db('shares').where({ id: share.id }).update({ status, purged_at: db.fn.now(), upload_token: null });
  if (dropLink) await db('links').where({ target_id: share.id, kind: 'share' }).delete();
}

export async function recordDownload(req: Request, share: ShareRow, file: FileRow | null) {
  await db('shares').where({ id: share.id }).increment('download_count', 1);
  if (file) await db('files').where({ id: file.id }).increment('download_count', 1);
  if (share.notify_on_download && !share.download_notified) {
    const updated = await db('shares').where({ id: share.id, download_notified: false }).update({ download_notified: true });
    const owner = updated ? await getUser(share.owner_id) : null;
    if (owner?.email) {
      const label = share.title || file?.name || share.slug || 'votre partage';
      notifyEvent('share_downloaded', owner.email, { title: label, link: absoluteUrl(req, linkPath(share.prefix, share.slug)) }, baseUrl(req));
    }
  }
}

export const randomSuffix = () => randomString(6, 'unambiguous');

const fmtDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Template variables describing a ready share (share_invite / request_received). */
export async function shareMailVars(req: Request, share: ShareRow): Promise<Record<string, string>> {
  const files = await db<FileRow>('files').where({ share_id: share.id }).orderBy('created_at');
  return {
    title: share.title || (files.length === 1 ? files[0].name : `${files.length} fichiers`),
    message: share.message ?? '',
    files: `${files.length} fichier${files.length > 1 ? 's' : ''}`,
    size: formatBytes(Number(share.total_size)),
    expires: share.expires_at ? fmtDate(new Date(share.expires_at)) : '',
    link: absoluteUrl(req, linkPath(share.prefix, share.slug)),
  };
}
