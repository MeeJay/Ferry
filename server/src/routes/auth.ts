import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { logger } from '../logger.js';
import { getSetting } from '../services/settings.js';
import { authorizeUrl, exchangeCode, randomUrlToken } from '../services/oidc.js';
import type { InvitePreview, RegisterResult } from '@ferry/shared';
import { checkHandle, hashPassword, newUserCode, toMe, uniqueUsername, verifyPassword, type UserRow } from '../services/users.js';
import { findInvite, notifyAdminsPending, sendVerification } from '../services/registration.js';
import { hashToken } from '../middleware/auth.js';
import { HttpError } from '../services/shares.js';
import { audit } from '../services/audit.js';
import { obligateBase, obligateReady, obligateSettings } from '../services/obligate.js';
import { ah, baseUrl } from '../utils/http.js';

export const authApi = Router();
export const authRedirects = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

export function establishSession(req: Request, userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const unlocked = req.session.unlocked;
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.unlocked = unlocked;
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

/** Only same-site relative paths are accepted as post-login destinations. */
export function safeNext(next: unknown): string {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/';
}

authApi.post('/login', loginLimiter, ah(async (req, res) => {
  const auth = await getSetting('auth');
  if (!auth.localLogin) return res.status(403).json({ error: 'Connexion locale désactivée' });
  const { username, password } = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
  // Identifier or e-mail address.
  const login = username.toLowerCase().trim();
  const user = await db<UserRow>('users').where({ auth_provider: 'local' })
    .where((q) => q.whereRaw('lower(username) = ?', [login]).orWhereRaw('lower(email) = ?', [login])).first();
  if (!user || user.disabled || !(await verifyPassword(password, user.password_hash))) {
    audit(req, 'auth.login_failed', username, {}, null);
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  // Only revealed once the password is right, so it says nothing about other accounts.
  if (!user.email_verified) return res.status(403).json({ error: 'Confirmez d’abord votre adresse e-mail (lien reçu à l’inscription).', code: 'verify_email' });
  if (user.pending_approval) return res.status(403).json({ error: 'Votre compte attend la validation d’un administrateur.', code: 'pending_approval' });
  await establishSession(req, user.id);
  await db('users').where({ id: user.id }).update({ last_login_at: db.fn.now() });
  audit(req, 'auth.login', user.username, { provider: 'local' }, user.id);
  res.json(await toMe(user));
}));

// ── Self-registration & invitations ────────────────────────────────────────

// Per client IP. Generous enough for an office behind one NAT address signing up
// at once, still a wall for scripted abuse. Verification links get their own budget.
const registerLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
const emailLinkLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

authApi.get('/invite/:token', ah(async (req, res) => {
  const invite = await findInvite(req.params.token);
  if (!invite) return res.status(404).json({ error: 'Invitation invalide, déjà utilisée ou expirée' });
  const [profile, inviter] = await Promise.all([
    invite.profile_id ? db('quota_profiles').where({ id: invite.profile_id }).first('name') : null,
    invite.created_by ? db('users').where({ id: invite.created_by }).first('display_name') : null,
  ]);
  const preview: InvitePreview = {
    email: invite.email, displayName: invite.display_name, profileName: profile?.name ?? null,
    invitedBy: inviter?.display_name ?? null, expiresAt: new Date(invite.expires_at).toISOString(),
  };
  res.json(preview);
}));

authApi.post('/register', registerLimiter, ah(async (req, res) => {
  const b = z.object({
    username: z.string().trim().toLowerCase().min(2).max(32),
    displayName: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().max(200),
    password: z.string().min(8).max(200),
    invite: z.string().optional(),
  }).parse(req.body);
  const auth = await getSetting('auth');
  const invite = b.invite ? await findInvite(b.invite) : null;
  if (b.invite && !invite) throw new HttpError(410, 'Invitation invalide, déjà utilisée ou expirée');
  if (!invite) {
    if (!auth.localLogin || auth.registration.mode === 'disabled') throw new HttpError(403, 'Les inscriptions sont fermées');
    const domain = b.email.split('@')[1];
    if (auth.registration.allowedDomains.length && !auth.registration.allowedDomains.includes(domain)) {
      throw new HttpError(403, `Inscription réservée aux adresses ${auth.registration.allowedDomains.map((d) => '@' + d).join(', ')}`);
    }
  } else if (invite.email && invite.email.toLowerCase() !== b.email) {
    throw new HttpError(400, 'Cette invitation est liée à une autre adresse e-mail');
  }
  const problem = await checkHandle(b.username);
  if (problem) throw new HttpError(400, problem);
  if (await db('users').whereRaw('lower(email) = ?', [b.email]).first()) throw new HttpError(409, 'Un compte existe déjà avec cette adresse e-mail');

  const mode = auth.registration.mode;
  const needsEmail = !invite && (mode === 'email' || mode === 'email_approval');
  const needsApproval = !invite && (mode === 'approval' || mode === 'email_approval');
  const user = await db.transaction(async (trx) => {
    const [u] = await trx<UserRow>('users').insert({
      username: b.username,
      display_name: b.displayName,
      email: b.email,
      password_hash: await hashPassword(b.password),
      role: invite?.role ?? 'user',
      auth_provider: 'local',
      user_code: await newUserCode(),
      quota_profile_id: invite ? invite.profile_id : auth.registration.defaultProfileId,
      email_verified: !needsEmail,
      pending_approval: needsApproval,
    }).returning('*');
    if (invite) {
      // Guarded update: two simultaneous sign-ups cannot both consume the invite.
      const n = await trx('invites').where({ id: invite.id, used_at: null }).update({ used_at: trx.fn.now(), used_by: u.id });
      if (!n) throw new HttpError(410, 'Invitation déjà utilisée');
    }
    return u;
  });
  audit(req, 'user.registered', user.username, { via: invite ? 'invite' : mode, role: user.role }, user.id);

  if (needsEmail) {
    await sendVerification(req, user);
    return res.status(201).json({ status: 'verify_email' } satisfies RegisterResult);
  }
  if (needsApproval) {
    await notifyAdminsPending(req, user);
    return res.status(201).json({ status: 'pending_approval' } satisfies RegisterResult);
  }
  await establishSession(req, user.id);
  res.status(201).json({ status: 'active', me: await toMe(user) } satisfies RegisterResult);
}));

authApi.post('/verify-email', emailLinkLimiter, ah(async (req, res) => {
  const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
  const row = await db('email_tokens').where({ token_hash: hashToken(token), purpose: 'verify' }).first();
  if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'Lien invalide ou expiré');
  await db('email_tokens').where({ id: row.id }).update({ used_at: db.fn.now() });
  const [user] = await db<UserRow>('users').where({ id: row.user_id }).update({ email_verified: true }).returning('*');
  audit(req, 'user.email_verified', user.username, {}, user.id);
  if (user.pending_approval) {
    await notifyAdminsPending(req, user);
    return res.json({ status: 'pending_approval' } satisfies RegisterResult);
  }
  await establishSession(req, user.id);
  res.json({ status: 'active', me: await toMe(user) } satisfies RegisterResult);
}));

/** Always answers the same way: does not reveal whether the address has an account. */
authApi.post('/resend-verification', emailLinkLimiter, ah(async (req, res) => {
  const { login } = z.object({ login: z.string().trim().toLowerCase().min(1) }).parse(req.body);
  const user = await db<UserRow>('users').where({ auth_provider: 'local', email_verified: false })
    .where((q) => q.whereRaw('lower(username) = ?', [login]).orWhereRaw('lower(email) = ?', [login])).first();
  if (user) await sendVerification(req, user);
  res.json({ ok: true });
}));

authApi.post('/logout', ah(async (req, res) => {
  // Obligate accounts also leave the Obligate session, then come back to our login page.
  let redirect: string | null = null;
  if (req.user?.auth_provider === 'obligate') {
    const s = await obligateSettings();
    if (obligateReady(s)) redirect = `${obligateBase(s)}/logout?redirect_uri=${encodeURIComponent(`${baseUrl(req)}/login`)}`;
  }
  req.session.destroy(() => res.json({ ok: true, redirect }));
}));

// ── Entra ID ───────────────────────────────────────────────────────────────

const redirectUri = (req: Request) => `${baseUrl(req)}/auth/oidc/callback`;

authRedirects.get('/oidc/login', ah(async (req, res) => {
  const { oidc } = await getSetting('auth');
  if (!oidc.enabled || !oidc.clientId || !oidc.tenantId) return res.redirect('/login?error=sso_disabled');
  const state = randomUrlToken();
  const nonce = randomUrlToken();
  const verifier = randomUrlToken(48);
  req.session.oidc = { state, nonce, verifier, next: safeNext(req.query.next) };
  req.session.save(() => res.redirect(authorizeUrl(oidc, redirectUri(req), state, nonce, verifier)));
}));

authRedirects.get('/oidc/callback', ah(async (req, res) => {
  const { oidc } = await getSetting('auth');
  const pending = req.session.oidc;
  delete req.session.oidc;
  const fail = (code: string, detail?: string) => {
    logger.warn({ code, detail }, 'oidc login failed');
    res.redirect(`/login?error=${code}`);
  };
  if (!oidc.enabled) return fail('sso_disabled');
  if (req.query.error) return fail('sso_denied', String(req.query.error_description || req.query.error));
  if (!pending || req.query.state !== pending.state || typeof req.query.code !== 'string') return fail('sso_state');

  let claims;
  try {
    claims = await exchangeCode(oidc, redirectUri(req), req.query.code, pending.verifier, pending.nonce);
  } catch (err: any) {
    return fail('sso_token', err.message);
  }

  const subject = `${claims.tid ?? oidc.tenantId}:${claims.oid ?? claims.sub}`;
  const groups = claims.groups ?? [];
  if (oidc.allowedGroups.length && !groups.some((g) => oidc.allowedGroups.includes(g))) return fail('sso_forbidden');

  const email = claims.email || (claims.preferred_username?.includes('@') ? claims.preferred_username : null) || null;
  const displayName = claims.name || claims.preferred_username || email || 'Utilisateur';

  // Group → profile mapping is re-evaluated at every login so Entra stays the source of truth.
  const profiles = await db('quota_profiles').whereRaw('cardinality(oidc_groups) > 0').orderBy('created_at');
  const mappedProfile = profiles.find((p: any) => p.oidc_groups.some((g: string) => groups.includes(g)));

  let user = await db<UserRow>('users').where({ oidc_sub: subject }).first();
  if (!user) {
    if (!oidc.autoCreate) return fail('sso_no_account');
    [user] = await db<UserRow>('users').insert({
      username: await uniqueUsername(claims.preferred_username || email || displayName),
      display_name: displayName,
      email,
      role: oidc.adminGroups.some((g) => groups.includes(g)) ? 'admin' : 'user',
      auth_provider: 'oidc',
      oidc_sub: subject,
      user_code: await newUserCode(),
      quota_profile_id: mappedProfile?.id ?? oidc.defaultProfileId ?? null,
    }).returning('*');
    audit(req, 'user.created', user.username, { provider: 'oidc' }, user.id);
  } else {
    if (user.disabled) return fail('account_disabled');
    const patch: Partial<UserRow> = { display_name: displayName, email, last_login_at: new Date() };
    if (oidc.adminGroups.length) patch.role = oidc.adminGroups.some((g) => groups.includes(g)) ? 'admin' : 'user';
    if (profiles.length && mappedProfile) patch.quota_profile_id = mappedProfile.id;
    [user] = await db<UserRow>('users').where({ id: user.id }).update(patch).returning('*');
  }

  await establishSession(req, user.id);
  audit(req, 'auth.login', user.username, { provider: 'oidc' }, user.id);
  res.redirect(pending.next);
}));

authApi.get('/me', ah(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Non connecté' });
  res.json(await toMe(req.user));
}));
