import fsp from 'node:fs/promises';
import { Router } from 'express';
import multer from 'multer';
import mime from 'mime-types';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { requireAuth } from '../middleware/auth.js';
import {
  assertCapacity, createPendingShare, finalizeShare, HttpError, ingestFile, purgeShare, shareDTO,
  type ShareRow,
} from '../services/shares.js';
import { effectiveLimits } from '../services/users.js';
import { getSetting } from '../services/settings.js';
import { audit } from '../services/audit.js';
import { absoluteUrl, ah } from '../utils/http.js';

// ShareX / Flameshot / curl compatible API (same shape as XBackBone & Zipline):
//   POST /api/sharex/upload   multipart "file"   → { url, raw_url, thumbnail_url, deletion_url }
//   POST /api/sharex/shorten  { url }            → { url, deletion_url }
//   GET  /api/sharex/delete/:id/:token           → deletes (link opened from ShareX history)
// Auth: `Authorization: Bearer <token>` (or `X-Ferry-Token`), token from the profile page.

export const sharexRouter = Router();

const upload = multer({ dest: config.dirs.tmp, limits: { files: 1, fields: 20 } });

/** Busboy may hand over UTF-8 names decoded as latin1; undo that when it round-trips cleanly. */
function fixName(n: string) {
  const utf8 = Buffer.from(n, 'latin1').toString('utf8');
  return utf8.includes('�') ? n : utf8;
}

async function ingestOptions() {
  const l = await getSetting('limits');
  return { visibility: l.sharexVisibility, expiryHours: l.sharexExpiryHours > 0 ? l.sharexExpiryHours : 0 };
}

sharexRouter.post('/upload', requireAuth, upload.single('file'), ah(async (req, res) => {
  const f = req.file;
  if (!f) throw new HttpError(400, 'Champ « file » manquant');
  const user = req.user!;
  const limits = await effectiveLimits(user);
  try {
    assertCapacity(limits, 0, f.size, f.size);
  } catch (err) {
    await fsp.rm(f.path, { force: true });
    throw err;
  }
  const type = f.mimetype && f.mimetype !== 'application/octet-stream' ? f.mimetype : (mime.lookup(f.originalname) || 'application/octet-stream');
  const opts = await ingestOptions();
  const share = await createPendingShare(user, { source: 'sharex', ...opts, expectedFiles: 1 });
  await ingestFile(share, f.path, fixName(f.originalname), type, f.size);
  const ready = await finalizeShare(share.id);
  const dto = await shareDTO(ready);
  audit(req, 'share.created', ready.id, { files: 1, size: f.size, visibility: ready.visibility, source: 'sharex' });
  const file = dto.files[0];
  res.json({
    url: absoluteUrl(req, dto.url),
    raw_url: absoluteUrl(req, file.rawUrl),
    thumbnail_url: file.hasThumb ? absoluteUrl(req, `${file.rawUrl}?thumb`) : absoluteUrl(req, file.rawUrl),
    deletion_url: absoluteUrl(req, `/api/sharex/delete/${ready.id}/${ready.delete_token}`),
    expires_at: dto.expiresAt,
  });
}));

sharexRouter.post('/shorten', requireAuth, ah(async (req, res) => {
  const { url } = z.object({ url: z.string().url().refine((u) => /^https?:\/\//i.test(u), 'http(s) uniquement') }).parse(req.body);
  const opts = await ingestOptions();
  const share = await createPendingShare(req.user!, {
    source: 'sharex', kind: 'url', targetUrl: url, title: new URL(url).hostname, visibility: 'public', expiryHours: opts.expiryHours,
  });
  const ready = await finalizeShare(share.id);
  audit(req, 'share.created', ready.id, { kind: 'url', source: 'sharex' });
  res.json({
    url: absoluteUrl(req, (await shareDTO(ready)).url),
    deletion_url: absoluteUrl(req, `/api/sharex/delete/${ready.id}/${ready.delete_token}`),
  });
}));

sharexRouter.get('/delete/:id/:token', ah(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const share = id.success ? await db<ShareRow>('shares').where({ id: id.data, delete_token: req.params.token }).first() : null;
  if (!share || share.status === 'deleted') return res.status(404).type('text').send('Introuvable ou déjà supprimé.');
  await purgeShare(share, 'deleted');
  audit(req, 'share.deleted', share.id, { by: 'deletion_url' }, share.owner_id);
  res.type('text').send('Fichier supprimé.');
}));
