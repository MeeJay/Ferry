import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { PublicConfig, ResolveResult } from '@ferry/shared';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { getSetting } from '../services/settings.js';
import { resolveSegments } from '../services/links.js';
import { checkShareAccess, loadShare, markUnlocked } from '../services/access.js';
import { createPendingShare, finalizeShare, HttpError, shareDTO, shareMailVars, type FileRow, type ShareRow } from '../services/shares.js';
import { effectiveParallel, getUser, verifyPassword } from '../services/users.js';
import { notifyEvent } from '../services/mail.js';
import { audit } from '../services/audit.js';
import { ah, baseUrl } from '../utils/http.js';
import { requestOpen, type RequestRow } from './requests.js';

export const publicRouter = Router();

const unlockLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
const dropLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });

publicRouter.get('/config', ah(async (_req, res) => {
  const [branding, auth, mail] = await Promise.all([getSetting('branding'), getSetting('auth'), getSetting('mail')]);
  const out: PublicConfig = {
    branding,
    localLogin: auth.localLogin,
    oidc: { enabled: auth.oidc.enabled && !!auth.oidc.clientId, buttonLabel: auth.oidc.buttonLabel },
    mailEnabled: mail.provider !== 'none',
    registration: {
      enabled: auth.registration.mode !== 'disabled' && auth.localLogin,
      requiresEmail: auth.registration.mode === 'email' || auth.registration.mode === 'email_approval',
      requiresApproval: auth.registration.mode === 'approval' || auth.registration.mode === 'email_approval',
      allowedDomains: auth.registration.allowedDomains,
    },
    version: config.version,
  };
  res.set('Cache-Control', 'no-cache').json(out);
}));

export function pathSegments(p: string): string[] {
  return p.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
}

export async function resolvePath(req: Request, path: string): Promise<ResolveResult> {
  const hit = await resolveSegments(pathSegments(path));
  if (!hit) return { kind: 'notfound' };

  if (hit.link.kind === 'request') {
    const r = await db<RequestRow>('requests').where({ id: hit.link.target_id }).first();
    if (!r) return { kind: 'notfound' };
    const closed = requestOpen(r);
    if (closed) return { kind: 'gone', reason: closed };
    const owner = await getUser(r.owner_id);
    return {
      kind: 'request',
      request: { id: r.id, title: r.title, message: r.message, hasPassword: !!r.password_hash, expiresAt: r.expires_at?.toISOString() ?? null, maxFiles: r.max_files, maxSizeMb: r.max_size_mb },
      owner: { displayName: owner?.display_name ?? '' },
      unlocked: !r.password_hash || !!req.session?.unlocked?.includes(r.id),
    };
  }

  const share = await loadShare(hit.link.target_id);
  if (!share) return { kind: 'notfound' };
  const access = checkShareAccess(req, share);
  if (!access.ok) {
    if (access.reason === 'login') return { kind: 'login' };
    if (access.reason === 'locked') return { kind: 'locked', target: 'share', title: share.title };
    if (access.reason === 'notfound') return { kind: 'notfound' };
    return { kind: 'gone', reason: access.reason };
  }
  if (hit.fileSlug && !(await db<FileRow>('files').where({ share_id: share.id, slug: hit.fileSlug }).first())) {
    return { kind: 'notfound' };
  }
  const owner = await getUser(share.owner_id);
  return { kind: 'share', share: await shareDTO(share), owner: { displayName: owner?.display_name ?? '' }, fileSlug: hit.fileSlug };
}

publicRouter.get('/resolve', ah(async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await resolvePath(req, String(req.query.path || '/')));
}));

publicRouter.post('/unlock', unlockLimiter, ah(async (req, res) => {
  const { path, password } = z.object({ path: z.string(), password: z.string() }).parse(req.body);
  const hit = await resolveSegments(pathSegments(path));
  if (!hit) throw new HttpError(404, 'Introuvable');
  const table = hit.link.kind === 'request' ? 'requests' : 'shares';
  const row = await db(table).where({ id: hit.link.target_id }).first('id', 'password_hash');
  if (!row?.password_hash || !(await verifyPassword(password, row.password_hash))) {
    throw new HttpError(401, 'Mot de passe incorrect');
  }
  markUnlocked(req, row.id);
  req.session.save(() => res.json({ ok: true }));
}));

// ── Reverse share: anonymous drop sessions ─────────────────────────────────

async function openRequest(req: Request, id: string): Promise<RequestRow> {
  const r = await db<RequestRow>('requests').where({ id }).first();
  if (!r) throw new HttpError(404, 'Demande introuvable');
  const closed = requestOpen(r);
  if (closed) throw new HttpError(410, closed === 'closed' ? 'Cette demande est fermée' : 'Cette demande a expiré');
  if (r.password_hash && !req.session?.unlocked?.includes(r.id)) throw new HttpError(401, 'Mot de passe requis');
  return r;
}

publicRouter.post('/requests/:id/session', dropLimiter, ah(async (req, res) => {
  const r = await openRequest(req, z.string().uuid().parse(req.params.id));
  const b = z.object({
    name: z.string().max(120).nullish(),
    email: z.string().email().max(200).nullish().or(z.literal('')),
    message: z.string().max(5000).nullish(),
    files: z.number().int().min(1).max(10_000),
  }).parse(req.body);
  if (r.max_files && b.files > r.max_files) throw new HttpError(413, `Maximum ${r.max_files} fichier(s)`);
  const owner = await getUser(r.owner_id);
  if (!owner || owner.disabled) throw new HttpError(410, 'Cette demande n’est plus disponible');
  const who = b.name?.trim() || b.email || 'anonyme';
  const share = await createPendingShare(owner, {
    source: 'request',
    title: `${r.title} — ${who}`,
    message: b.message ?? null,
    requestId: r.id,
    expectedFiles: b.files,
    uploader: { name: b.name, email: b.email || null, ip: req.ip ?? null },
  });
  res.status(201).json({ id: share.id, uploadToken: share.upload_token, chunkSize: req.app.get('chunkSize'), parallel: await effectiveParallel(null) });
}));

publicRouter.post('/requests/:id/session/:shareId/complete', ah(async (req, res) => {
  const r = await openRequest(req, z.string().uuid().parse(req.params.id));
  const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
  const share = await db<ShareRow>('shares').where({ id: z.string().uuid().parse(req.params.shareId), request_id: r.id, upload_token: token }).first();
  if (!share) throw new HttpError(404, 'Session de dépôt introuvable');
  const ready = await finalizeShare(share.id);
  await db('requests').where({ id: r.id }).increment('uploads_count', 1);
  audit(req, 'request.upload', ready.id, { request: r.id, files: ready.file_count, size: Number(ready.total_size), uploader: ready.uploader_name }, r.owner_id);

  const owner = await getUser(r.owner_id);
  if (r.notify && owner?.email) {
    notifyEvent('request_received', owner.email, {
      ...(await shareMailVars(req, ready)),
      title: r.title,
      uploader: ready.uploader_name || ready.uploader_email || 'Un expéditeur anonyme',
    }, baseUrl(req));
  }
  res.json({ ok: true, files: ready.file_count });
}));
