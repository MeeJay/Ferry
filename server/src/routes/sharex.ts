import fsp from 'node:fs/promises';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import mime from 'mime-types';
import sharp from 'sharp';
import { z } from 'zod';
import type { CreateShareInput, EffectiveLimits, LinkOptions } from '@ferry/shared';
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
import { ah, baseUrl } from '../utils/http.js';

// ShareX / Xshare / Flameshot / curl compatible API (same shape as XBackBone & Zipline):
//   POST /api/sharex/upload   multipart "file"   → { url, raw_url, thumbnail_url, deletion_url }
//   POST /api/sharex/shorten  { url }            → { url, deletion_url }
//   GET  /api/sharex/delete/:id/:token           → deletes (link opened from ShareX history)
// Auth: `Authorization: Bearer <token>` (or `X-Ferry-Token`), token from the profile page.
//
// Optional headers, written by the config generator (all bounded by the user's
// limits and link-policy locks):
//   X-Ferry-Name-Format   original | random | original_random | words | timestamp | uuid
//   X-Ferry-Max-Views     download cap
//   X-Ferry-Expires       lifetime in hours (0 = never, if allowed)
//   X-Ferry-Visibility    public | private
//   X-Ferry-Image-Quality 1-100: recompress JPEG / WebP / PNG uploads
//   X-Ferry-Domain        one of the admin-declared ShareX domains

export const sharexRouter = Router();

const upload = multer({ dest: config.dirs.tmp, limits: { files: 1, fields: 20 } });

/** ShareX can be switched off globally or per quota profile. */
async function requireSharex(req: Request, res: Response, next: NextFunction) {
  try {
    const limits = await effectiveLimits(req.user!);
    if (!limits.sharexEnabled) return res.status(403).json({ error: 'ShareX n’est pas activé pour votre compte' });
    res.locals.limits = limits;
    next();
  } catch (err) { next(err); }
}

/** Busboy may hand over UTF-8 names decoded as latin1; undo that when it round-trips cleanly. */
function fixName(n: string) {
  const utf8 = Buffer.from(n, 'latin1').toString('utf8');
  return utf8.includes('�') ? n : utf8;
}

const headerSchema = z.object({
  'x-ferry-name-format': z.enum(['original', 'random', 'original_random', 'words', 'timestamp', 'uuid']).optional(),
  'x-ferry-max-views': z.coerce.number().int().min(1).max(1_000_000).optional(),
  'x-ferry-expires': z.coerce.number().int().min(0).max(24 * 365 * 10).optional(),
  'x-ferry-visibility': z.enum(['public', 'private']).optional(),
  'x-ferry-image-quality': z.coerce.number().int().min(1).max(100).optional(),
  'x-ferry-domain': z.string().trim().toLowerCase().optional(),
});

interface UploadOptions { share: Partial<CreateShareInput>; quality?: number; origin: string }

async function readOptions(req: Request, limits: EffectiveLimits): Promise<UploadOptions> {
  const h = headerSchema.parse(Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith('x-ferry-')).map(([k, v]) => [k, v === '' ? undefined : v])));
  const g = await getSetting('limits');
  const override: Partial<LinkOptions> = {};
  if (h['x-ferry-name-format']) override.nameMode = h['x-ferry-name-format'];
  const domain = h['x-ferry-domain'];
  if (domain && !limits.sharexDomains.includes(domain)) throw new HttpError(400, `Domaine non autorisé : ${domain}`);
  return {
    share: {
      visibility: h['x-ferry-visibility'] ?? g.sharexVisibility,
      expiryHours: h['x-ferry-expires'] ?? (g.sharexExpiryHours > 0 ? g.sharexExpiryHours : 0),
      maxDownloads: h['x-ferry-max-views'] ?? null,
      linkOverride: Object.keys(override).length ? override : null,
    },
    quality: h['x-ferry-image-quality'],
    origin: domain ? `${req.protocol}://${domain}` : baseUrl(req),
  };
}

/** Recompresses an image in place; keeps the original if it would not get smaller. */
async function compress(path: string, mimeType: string, quality: number): Promise<number | null> {
  const formats: Record<string, 'jpeg' | 'webp' | 'png'> = { 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/png': 'png' };
  const fmt = formats[mimeType];
  if (!fmt) return null;
  const input = await fsp.readFile(path);
  const img = sharp(input, { animated: fmt === 'webp' }).rotate();
  const out = await (fmt === 'jpeg' ? img.jpeg({ quality, mozjpeg: true })
    : fmt === 'webp' ? img.webp({ quality })
      : img.png({ quality, palette: true, compressionLevel: 9 })).toBuffer();
  if (out.length >= input.length) return null;
  await fsp.writeFile(path, out);
  return out.length;
}

sharexRouter.post('/upload', requireAuth, requireSharex, upload.single('file'), ah(async (req, res) => {
  const f = req.file;
  if (!f) throw new HttpError(400, 'Champ « file » manquant');
  const user = req.user!;
  const limits = res.locals.limits as EffectiveLimits;
  let opts: UploadOptions;
  try {
    opts = await readOptions(req, limits);
    assertCapacity(limits, 0, f.size, f.size);
  } catch (err) {
    await fsp.rm(f.path, { force: true });
    throw err;
  }
  const type = f.mimetype && f.mimetype !== 'application/octet-stream' ? f.mimetype : (mime.lookup(f.originalname) || 'application/octet-stream');
  const size = (opts.quality && opts.quality < 100 ? await compress(f.path, type, opts.quality).catch(() => null) : null) ?? f.size;

  const share = await createPendingShare(user, { source: 'sharex', ...opts.share, expectedFiles: 1 });
  await ingestFile(share, f.path, fixName(f.originalname), type, size);
  const ready = await finalizeShare(share.id);
  const dto = await shareDTO(ready);
  audit(req, 'share.created', ready.id, { files: 1, size, visibility: ready.visibility, source: 'sharex' });
  const file = dto.files[0];
  const abs = (p: string) => `${opts.origin}${p}`;
  res.json({
    url: abs(dto.url),
    raw_url: abs(file.rawUrl),
    thumbnail_url: abs(file.hasThumb ? `${file.rawUrl}?thumb` : file.rawUrl),
    deletion_url: abs(`/api/sharex/delete/${ready.id}/${ready.delete_token}`),
    expires_at: dto.expiresAt,
  });
}));

sharexRouter.post('/shorten', requireAuth, requireSharex, ah(async (req, res) => {
  const { url } = z.object({ url: z.string().url().refine((u) => /^https?:\/\//i.test(u), 'http(s) uniquement') }).parse(req.body);
  const opts = await readOptions(req, res.locals.limits as EffectiveLimits);
  const share = await createPendingShare(req.user!, {
    source: 'sharex', kind: 'url', targetUrl: url, title: new URL(url).hostname,
    ...opts.share,
    visibility: req.get('x-ferry-visibility') === 'private' ? 'private' : 'public',
  });
  const ready = await finalizeShare(share.id);
  audit(req, 'share.created', ready.id, { kind: 'url', source: 'sharex' });
  res.json({
    url: `${opts.origin}${(await shareDTO(ready)).url}`,
    deletion_url: `${opts.origin}/api/sharex/delete/${ready.id}/${ready.delete_token}`,
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
