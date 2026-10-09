import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { LINK_SOURCES, type UserLinkPrefs } from '@ferry/shared';
import { db } from '../db/knex.js';
import { hashToken, requireAuth } from '../middleware/auth.js';
import { checkHandle, hashPassword, linkPolicies, toMe, verifyPassword, type UserRow } from '../services/users.js';
import { HttpError } from '../services/shares.js';
import { audit } from '../services/audit.js';
import { ah } from '../utils/http.js';
import { userLinkOptions, uuid } from '../utils/schemas.js';

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.patch('/', ah(async (req, res) => {
  const b = z.object({
    displayName: z.string().min(1).max(100).optional(),
    vanity: z.string().max(32).nullable().optional(),
    /** null = follow the admin default. Clamped to the admin ceiling at use. */
    uploadParallel: z.number().int().min(1).max(32).nullable().optional(),
  }).parse(req.body);
  const user = req.user!;
  const patch: Partial<UserRow> = {};
  if (b.displayName !== undefined) patch.display_name = b.displayName.trim();
  if (b.uploadParallel !== undefined) patch.upload_parallel = b.uploadParallel;
  if (b.vanity !== undefined) {
    const policies = await linkPolicies(user);
    const allowed = LINK_SOURCES.some((s) => policies[s].options.prefixMode === 'vanity' || !policies[s].locked.prefixMode);
    if (!allowed) throw new HttpError(403, 'Les alias sont désactivés par l’administrateur');
    const v = b.vanity?.trim().toLowerCase() || null;
    if (v) {
      const problem = await checkHandle(v, user.id);
      if (problem) throw new HttpError(400, problem);
    }
    patch.vanity = v;
  }
  const [row] = await db<UserRow>('users').where({ id: user.id }).update(patch).returning('*');
  res.json(await toMe(row));
}));

/** Personal link preferences. Locked options are silently ignored at resolution time. */
meRouter.put('/link-prefs', ah(async (req, res) => {
  const prefs = z.object(Object.fromEntries(LINK_SOURCES.map((s) => [s, userLinkOptions.optional()]))).parse(req.body) as UserLinkPrefs;
  const [row] = await db<UserRow>('users').where({ id: req.user!.id }).update({ link_prefs: JSON.stringify(prefs) as any }).returning('*');
  res.json(await toMe(row));
}));

meRouter.put('/password', ah(async (req, res) => {
  const { current, next } = z.object({ current: z.string(), next: z.string().min(8).max(200) }).parse(req.body);
  const user = req.user!;
  if (user.auth_provider !== 'local') throw new HttpError(400, 'Compte SSO : mot de passe géré par Microsoft');
  if (!(await verifyPassword(current, user.password_hash))) throw new HttpError(400, 'Mot de passe actuel incorrect');
  await db('users').where({ id: user.id }).update({ password_hash: await hashPassword(next) });
  audit(req, 'user.password_changed', user.username);
  res.json({ ok: true });
}));

// ── API tokens (ShareX, scripts) ───────────────────────────────────────────

meRouter.get('/tokens', ah(async (req, res) => {
  const rows = await db('api_tokens').where({ user_id: req.user!.id }).orderBy('created_at', 'desc');
  res.json(rows.map((t) => ({ id: t.id, name: t.name, hint: t.token_hint, createdAt: t.created_at, lastUsedAt: t.last_used_at })));
}));

meRouter.post('/tokens', ah(async (req, res) => {
  const { name } = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
  const token = `fry_${crypto.randomBytes(24).toString('base64url')}`;
  const [row] = await db('api_tokens').insert({
    user_id: req.user!.id, name: name.trim(), token_hash: hashToken(token), token_hint: `${token.slice(0, 8)}…${token.slice(-4)}`,
  }).returning('*');
  audit(req, 'token.created', row.id, { name: row.name });
  res.status(201).json({ id: row.id, name: row.name, hint: row.token_hint, createdAt: row.created_at, lastUsedAt: null, token });
}));

meRouter.delete('/tokens/:id', ah(async (req, res) => {
  const n = await db('api_tokens').where({ id: uuid.parse(req.params.id), user_id: req.user!.id }).delete();
  if (!n) throw new HttpError(404, 'Jeton introuvable');
  audit(req, 'token.revoked', req.params.id);
  res.json({ ok: true });
}));
