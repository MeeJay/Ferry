import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { requireAuth, isOwnerOrAdmin } from '../middleware/auth.js';
import {
  assertCapacity, computeExpiry, createPendingShare, finalizeShare, HttpError, purgeShare, resolveVisibility, shareDTO, shareMailVars,
  type FileRow, type ShareRow,
} from '../services/shares.js';
import { effectiveLimits, hashPassword } from '../services/users.js';
import { audit } from '../services/audit.js';
import { getSetting } from '../services/settings.js';
import { notifyEvent } from '../services/mail.js';
import { ah, baseUrl } from '../utils/http.js';
import { recipientsSchema, shareOptionsSchema, uuid } from '../utils/schemas.js';

export const sharesRouter = Router();
sharesRouter.use(requireAuth);

async function ownShare(userId: string, id: string, admin = false): Promise<ShareRow> {
  uuid.parse(id);
  const share = await db<ShareRow>('shares').where({ id }).first();
  if (!share || share.status === 'deleted' || (!admin && share.owner_id !== userId)) throw new HttpError(404, 'Partage introuvable');
  return share;
}

sharesRouter.get('/', ah(async (req, res) => {
  const status = String(req.query.status || 'active');
  const q = db<ShareRow>('shares').where({ owner_id: req.user!.id }).whereNot({ status: 'deleted' }).orderBy('created_at', 'desc').limit(500);
  if (status === 'active') {
    q.where({ status: 'ready' }).where((w) => w.whereNull('expires_at').orWhere('expires_at', '>', db.fn.now()));
  } else if (status === 'expired') {
    q.where((w) => w.where({ status: 'expired' }).orWhere((x) => x.where({ status: 'ready' }).where('expires_at', '<=', db.fn.now())));
  } else {
    q.whereNot({ status: 'pending' });
  }
  if (req.query.source) q.where('source', String(req.query.source));
  const rows = await q;
  const files = rows.length ? await db<FileRow>('files').whereIn('share_id', rows.map((r) => r.id)).orderBy('created_at') : [];
  res.json(await Promise.all(rows.map((r) => shareDTO(r, { files: files.filter((f) => f.share_id === r.id) }))));
}));

/** Step 1: announce the files; returns the upload token used for the tus uploads. */
sharesRouter.post('/', ah(async (req, res) => {
  const body = shareOptionsSchema.extend({
    files: z.array(z.object({ name: z.string().min(1).max(255), size: z.number().int().min(0) })).min(1).max(1000),
  }).parse(req.body);
  const limits = await effectiveLimits(req.user!);
  const total = body.files.reduce((s, f) => s + f.size, 0);
  for (const f of body.files) assertCapacity(limits, 0, 0, f.size);
  assertCapacity(limits, 0, total);

  const share = await createPendingShare(req.user!, { ...body, source: 'web', expectedFiles: body.files.length });
  res.status(201).json({ id: share.id, uploadToken: share.upload_token, chunkSize: req.app.get('chunkSize'), parallel: (await getSetting('limits')).uploadParallel });
}));

/** Step 2: once every tus upload finished, publish the link. */
sharesRouter.post('/:id/finalize', ah(async (req, res) => {
  const share = await ownShare(req.user!.id, req.params.id);
  const { recipients } = z.object({ recipients: recipientsSchema }).parse(req.body ?? {});
  const ready = await finalizeShare(share.id);
  if (recipients.length) {
    notifyEvent('share_invite', recipients, { ...(await shareMailVars(req, ready)), sender: req.user!.display_name }, baseUrl(req));
    audit(req, 'share.sent', ready.id, { recipients: recipients.length });
  }
  audit(req, 'share.created', ready.id, { files: ready.file_count, size: Number(ready.total_size), visibility: ready.visibility, source: 'web' });
  res.json(await shareDTO(ready));
}));

sharesRouter.get('/:id', ah(async (req, res) => {
  const share = await ownShare(req.user!.id, req.params.id, req.user!.role === 'admin');
  res.json(await shareDTO(share, { withOwner: true }));
}));

sharesRouter.patch('/:id', ah(async (req, res) => {
  const share = await ownShare(req.user!.id, req.params.id, req.user!.role === 'admin');
  const body = shareOptionsSchema.omit({ linkOverride: true }).parse(req.body);
  const limits = await effectiveLimits(req.user!);
  const patch: Partial<ShareRow> = {};
  if (body.title !== undefined) patch.title = body.title?.trim() || null;
  if (body.message !== undefined) patch.message = body.message?.trim() || null;
  if (body.visibility !== undefined && share.source !== 'request') patch.visibility = resolveVisibility(limits, body.visibility);
  if (body.password !== undefined) patch.password_hash = body.password ? await hashPassword(body.password) : null;
  if (body.expiryHours !== undefined) patch.expires_at = computeExpiry(limits, body.expiryHours);
  if (body.maxDownloads !== undefined) patch.max_downloads = body.maxDownloads || null;
  if (body.notifyOnDownload !== undefined) patch.notify_on_download = body.notifyOnDownload;
  if (share.status === 'expired' && patch.expires_at !== undefined) throw new HttpError(409, 'Fichiers déjà supprimés : impossible de prolonger');
  const [row] = await db<ShareRow>('shares').where({ id: share.id }).update(patch).returning('*');
  audit(req, 'share.updated', share.id, { fields: Object.keys(patch) });
  res.json(await shareDTO(row));
}));

sharesRouter.delete('/:id', ah(async (req, res) => {
  const share = await ownShare(req.user!.id, req.params.id, req.user!.role === 'admin');
  if (!isOwnerOrAdmin(req.user, share.owner_id)) throw new HttpError(403, 'Interdit');
  await purgeShare(share, 'deleted');
  audit(req, 'share.deleted', share.id, { by: req.user!.id === share.owner_id ? 'owner' : 'admin' });
  res.json({ ok: true });
}));
