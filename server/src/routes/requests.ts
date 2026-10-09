import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { RequestDTO } from '@ferry/shared';
import { db } from '../db/knex.js';
import { requireAuth } from '../middleware/auth.js';
import { allocateLink, linkPath } from '../services/links.js';
import { HttpError } from '../services/shares.js';
import { hashPassword } from '../services/users.js';
import { getSetting } from '../services/settings.js';
import { audit } from '../services/audit.js';
import { notifyEvent } from '../services/mail.js';
import { absoluteUrl, ah, baseUrl } from '../utils/http.js';
import { recipientsSchema, userLinkOptions, uuid } from '../utils/schemas.js';

export interface RequestRow {
  id: string;
  owner_id: string;
  prefix: string;
  slug: string;
  title: string;
  message: string | null;
  password_hash: string | null;
  expires_at: Date | null;
  max_files: number | null;
  max_size_mb: number | null;
  active: boolean;
  notify: boolean;
  uploads_count: number;
  created_at: Date;
}

export function requestDTO(r: RequestRow): RequestDTO {
  return {
    id: r.id,
    prefix: r.prefix,
    slug: r.slug,
    url: linkPath(r.prefix, r.slug),
    title: r.title,
    message: r.message,
    hasPassword: !!r.password_hash,
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    maxFiles: r.max_files,
    maxSizeMb: r.max_size_mb,
    active: r.active,
    uploadsCount: r.uploads_count,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export function requestOpen(r: RequestRow): false | 'closed' | 'expired' {
  if (!r.active) return 'closed';
  if (r.expires_at && new Date(r.expires_at).getTime() <= Date.now()) return 'expired';
  return false;
}

export const requestsRouter = Router();
requestsRouter.use(requireAuth);

const body = z.object({
  title: z.string().min(1).max(200),
  message: z.string().max(5000).nullish(),
  password: z.string().max(200).nullish(),
  expiryHours: z.number().int().min(0).max(24 * 365 * 10).nullish(),
  maxFiles: z.number().int().min(0).max(10_000).nullish(),
  maxSizeMb: z.number().int().min(0).max(10_000_000).nullish(),
  notify: z.boolean().optional(),
  active: z.boolean().optional(),
  linkOverride: userLinkOptions.nullish(),
  recipients: recipientsSchema.optional(),
});

async function expiryFor(hours: number | null | undefined): Promise<Date | null> {
  const limits = await getSetting('limits');
  let h = hours ?? 0;
  if (limits.requestMaxExpiryHours > 0 && (h <= 0 || h > limits.requestMaxExpiryHours)) h = limits.requestMaxExpiryHours;
  return h > 0 ? new Date(Date.now() + h * 3600_000) : null;
}

async function own(userId: string, id: string): Promise<RequestRow> {
  uuid.parse(id);
  const r = await db<RequestRow>('requests').where({ id, owner_id: userId }).first();
  if (!r) throw new HttpError(404, 'Demande introuvable');
  return r;
}

requestsRouter.get('/', ah(async (req, res) => {
  const rows = await db<RequestRow>('requests').where({ owner_id: req.user!.id }).orderBy('created_at', 'desc');
  res.json(rows.map(requestDTO));
}));

requestsRouter.post('/', ah(async (req, res) => {
  const b = body.parse(req.body);
  const id = crypto.randomUUID();
  const row = await db.transaction(async (trx) => {
    const { prefix, slug } = await allocateLink({
      owner: req.user!, source: 'request', kind: 'request', targetId: id, original: b.title,
      visibility: 'public', override: b.linkOverride, trx,
    });
    const [r] = await trx<RequestRow>('requests').insert({
      id,
      owner_id: req.user!.id,
      prefix,
      slug,
      title: b.title.trim(),
      message: b.message?.trim() || null,
      password_hash: b.password ? await hashPassword(b.password) : null,
      expires_at: await expiryFor(b.expiryHours),
      max_files: b.maxFiles || null,
      max_size_mb: b.maxSizeMb || null,
      notify: b.notify ?? true,
    }).returning('*');
    return r;
  });
  audit(req, 'request.created', row.id, { title: row.title });
  if (b.recipients?.length) {
    notifyEvent('request_invite', b.recipients, {
      sender: req.user!.display_name,
      title: row.title,
      message: row.message ?? '',
      expires: row.expires_at ? new Date(row.expires_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '',
      link: absoluteUrl(req, linkPath(row.prefix, row.slug)),
    }, baseUrl(req));
  }
  res.status(201).json(requestDTO(row));
}));

requestsRouter.patch('/:id', ah(async (req, res) => {
  const r = await own(req.user!.id, req.params.id);
  const b = body.partial().parse(req.body);
  const patch: Partial<RequestRow> = {};
  if (b.title !== undefined) patch.title = b.title.trim();
  if (b.message !== undefined) patch.message = b.message?.trim() || null;
  if (b.password !== undefined) patch.password_hash = b.password ? await hashPassword(b.password) : null;
  if (b.expiryHours !== undefined) patch.expires_at = await expiryFor(b.expiryHours);
  if (b.maxFiles !== undefined) patch.max_files = b.maxFiles || null;
  if (b.maxSizeMb !== undefined) patch.max_size_mb = b.maxSizeMb || null;
  if (b.notify !== undefined) patch.notify = b.notify;
  if (b.active !== undefined) patch.active = b.active;
  const [row] = await db<RequestRow>('requests').where({ id: r.id }).update(patch).returning('*');
  res.json(requestDTO(row));
}));

requestsRouter.delete('/:id', ah(async (req, res) => {
  const r = await own(req.user!.id, req.params.id);
  await db.transaction(async (trx) => {
    await trx('links').where({ target_id: r.id, kind: 'request' }).delete();
    await trx('requests').where({ id: r.id }).delete();
  });
  audit(req, 'request.deleted', r.id);
  res.json({ ok: true });
}));
