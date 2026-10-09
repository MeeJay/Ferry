import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { MAIL_EVENTS, MAIL_THEMES, type AdminStats, type AdminUser, type AuditEntry, type MailEventKey, type MailTheme, type Paged, type QuotaProfile, type SettingsKey } from '@ferry/shared';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { requireAdmin } from '../middleware/auth.js';
import { getSetting, maskSecrets, setSetting, withStoredSecrets } from '../services/settings.js';
import { HttpError, purgeShare, shareDTO, type FileRow, type ShareRow } from '../services/shares.js';
import { checkHandle, hashPassword, newUserCode, type ProfileRow, type UserRow } from '../services/users.js';
import { deliver, notifyEvent, renderFor } from '../services/mail.js';
import { fmtDate, inviteDTO, newSecret, type InviteRow } from '../services/registration.js';
import { hashToken } from '../middleware/auth.js';
import { DEFAULT_MAIL_TEMPLATES, MAIL_VARIABLES, SAMPLE_VARS, renderEvent } from '../services/mailTemplates.js';
import { testS3 } from '../services/storage.js';
import { audit } from '../services/audit.js';
import { announceSelfInfo, obligateBase, obligateClientId, obligateReachable } from '../services/obligate.js';
import { absoluteUrl, ah, baseUrl } from '../utils/http.js';
import { policyLayerSchema, uuid } from '../utils/schemas.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// ── Dashboard ──────────────────────────────────────────────────────────────

adminRouter.get('/stats', ah(async (_req, res) => {
  const live = () => db('shares').where({ status: 'ready' }).where((w) => w.whereNull('expires_at').orWhere('expires_at', '>', db.fn.now()));
  const [users, active, files, storage, byDay, bySource, top] = await Promise.all([
    db('users').count({ n: '*' }).first(),
    live().count({ n: '*' }).first(),
    db('files').join('shares', 'shares.id', 'files.share_id').whereIn('shares.status', ['ready', 'pending']).count({ n: '*' }).first(),
    db('shares').whereIn('status', ['ready', 'pending']).sum({ s: 'total_size' }).first(),
    db.raw(`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day, count(s.id)::int AS count, coalesce(sum(s.total_size), 0)::bigint AS bytes
      FROM generate_series(current_date - interval '29 days', current_date, interval '1 day') AS d(day)
      LEFT JOIN shares s ON s.created_at::date = d.day::date AND s.status <> 'pending'
      GROUP BY d.day ORDER BY d.day`),
    db('shares').whereNot({ status: 'pending' }).where('created_at', '>', db.raw("now() - interval '30 days'")).select('source').count({ count: '*' }).groupBy('source'),
    db('shares').join('users', 'users.id', 'shares.owner_id').whereIn('shares.status', ['ready', 'pending'])
      .groupBy('users.id').select('users.id', 'users.username', 'users.display_name')
      .sum({ bytes: 'shares.total_size' }).count({ shares: 'shares.id' }).orderBy('bytes', 'desc').limit(5),
  ]);
  const out: AdminStats = {
    users: Number(users?.n ?? 0),
    activeShares: Number(active?.n ?? 0),
    files: Number(files?.n ?? 0),
    storageUsed: Number(storage?.s ?? 0),
    uploadsByDay: byDay.rows.map((r: any) => ({ day: r.day, count: Number(r.count), bytes: Number(r.bytes) })),
    bySource: bySource.map((r: any) => ({ source: r.source, count: Number(r.count) })),
    topUsers: top.map((r: any) => ({ id: r.id, username: r.username, displayName: r.display_name, bytes: Number(r.bytes), shares: Number(r.shares) })),
  };
  res.json(out);
}));

// ── Every share, XBackBone style ───────────────────────────────────────────

adminRouter.get('/shares', ah(async (req, res) => {
  const q = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(48),
    search: z.string().optional(),
    source: z.enum(['web', 'sharex', 'request']).optional(),
    status: z.enum(['active', 'expired', 'deleted', 'all']).default('active'),
    owner: z.string().uuid().optional(),
    type: z.enum(['image', 'video', 'audio', 'document', 'archive', 'other']).optional(),
  }).parse(req.query);

  const base = db<ShareRow>('shares as s').whereNot('s.status', 'pending');
  if (q.status === 'active') base.where('s.status', 'ready').where((w) => w.whereNull('s.expires_at').orWhere('s.expires_at', '>', db.fn.now()));
  if (q.status === 'expired') base.where((w) => w.where('s.status', 'expired').orWhere((x) => x.where('s.status', 'ready').where('s.expires_at', '<=', db.fn.now())));
  if (q.status === 'deleted') base.where('s.status', 'deleted');
  if (q.source) base.where('s.source', q.source);
  if (q.owner) base.where('s.owner_id', q.owner);
  if (q.search) {
    const like = `%${q.search.replace(/[%_]/g, '\\$&')}%`;
    base.where((w) => w.whereILike('s.title', like).orWhereILike('s.slug', like).orWhereILike('s.uploader_name', like)
      .orWhereExists(db('files').whereRaw('files.share_id = s.id').whereILike('files.name', like))
      .orWhereExists(db('users').whereRaw('users.id = s.owner_id').where((u) => u.whereILike('users.username', like).orWhereILike('users.display_name', like))));
  }
  if (q.type) {
    const patterns: Record<string, string> = {
      image: 'image/%', video: 'video/%', audio: 'audio/%',
      document: 'application/pdf', archive: 'application/%zip%',
    };
    if (q.type === 'other') {
      base.whereNotExists(db('files').whereRaw('files.share_id = s.id').where((w) => w.whereILike('mime', 'image/%').orWhereILike('mime', 'video/%').orWhereILike('mime', 'audio/%')));
    } else {
      base.whereExists(db('files').whereRaw('files.share_id = s.id').whereILike('mime', patterns[q.type]));
    }
  }

  const total = Number((await base.clone().count({ n: '*' }).first())?.n ?? 0);
  const rows = await base.select('s.*').orderBy('s.created_at', 'desc').limit(q.pageSize).offset((q.page - 1) * q.pageSize);
  const files = rows.length ? await db<FileRow>('files').whereIn('share_id', rows.map((r) => r.id)).orderBy('created_at') : [];
  const items = await Promise.all(rows.map((r) => shareDTO(r, { withOwner: true, files: files.filter((f) => f.share_id === r.id) })));
  const out: Paged<typeof items[number]> = { items, total, page: q.page, pageSize: q.pageSize };
  res.json(out);
}));

// ── Users ──────────────────────────────────────────────────────────────────

async function adminUsers(): Promise<AdminUser[]> {
  const rows = await db('users as u')
    .leftJoin('shares as s', function () { this.on('s.owner_id', 'u.id').andOnIn('s.status', ['ready', 'pending']); })
    .groupBy('u.id').select('u.*').sum({ used: 's.total_size' }).count({ shares: 's.id' })
    .orderBy('u.created_at');
  return rows.map((u: any) => ({
    id: u.id, username: u.username, displayName: u.display_name, email: u.email, role: u.role,
    authProvider: u.auth_provider, disabled: u.disabled, quotaProfileId: u.quota_profile_id,
    emailVerified: u.email_verified, pendingApproval: u.pending_approval,
    storageUsed: Number(u.used ?? 0), shareCount: Number(u.shares ?? 0),
    createdAt: new Date(u.created_at).toISOString(), lastLoginAt: u.last_login_at ? new Date(u.last_login_at).toISOString() : null,
  }));
}

adminRouter.get('/users', ah(async (_req, res) => res.json(await adminUsers())));

const userBody = z.object({
  username: z.string().min(2).max(32),
  displayName: z.string().min(1).max(100),
  email: z.string().email().nullish().or(z.literal('')),
  password: z.string().min(8).max(200).optional(),
  role: z.enum(['admin', 'user']).default('user'),
  quotaProfileId: z.string().uuid().nullish(),
  disabled: z.boolean().optional(),
});

adminRouter.post('/users', ah(async (req, res) => {
  const b = userBody.required({ password: true }).parse(req.body);
  const username = b.username.toLowerCase().trim();
  const problem = await checkHandle(username);
  if (problem) throw new HttpError(400, problem);
  const [u] = await db<UserRow>('users').insert({
    username, display_name: b.displayName.trim(), email: b.email || null, password_hash: await hashPassword(b.password),
    role: b.role, auth_provider: 'local', user_code: await newUserCode(), quota_profile_id: b.quotaProfileId ?? null,
  }).returning('*');
  audit(req, 'user.created', u.username, { provider: 'local', role: u.role });
  res.status(201).json((await adminUsers()).find((x) => x.id === u.id));
}));

adminRouter.patch('/users/:id', ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const b = userBody.partial().parse(req.body);
  const user = await db<UserRow>('users').where({ id }).first();
  if (!user) throw new HttpError(404, 'Utilisateur introuvable');
  if (id === req.user!.id && (b.role === 'user' || b.disabled)) throw new HttpError(400, 'Vous ne pouvez pas vous retirer vos propres droits');
  if (user.auth_provider === 'obligate') {
    // Identity, role and status come from Obligate at every sign-in: only the quota profile is Ferry's.
    const changed = [
      b.username !== undefined && b.username.toLowerCase().trim() !== user.username,
      b.displayName !== undefined && b.displayName.trim() !== user.display_name,
      b.email !== undefined && (b.email || null) !== user.email,
      b.role !== undefined && b.role !== user.role,
      b.disabled !== undefined && b.disabled !== user.disabled,
      !!b.password,
    ];
    if (changed.some(Boolean)) throw new HttpError(400, 'Compte géré par Obligate : identité, rôle et statut se modifient dans Obligate');
  }
  const patch: Partial<UserRow> = {};
  if (b.username !== undefined && b.username !== user.username) {
    const username = b.username.toLowerCase().trim();
    const problem = await checkHandle(username, id);
    if (problem) throw new HttpError(400, problem);
    patch.username = username;
  }
  if (b.displayName !== undefined) patch.display_name = b.displayName.trim();
  if (b.email !== undefined) patch.email = b.email || null;
  if (b.role !== undefined) patch.role = b.role;
  if (b.quotaProfileId !== undefined) patch.quota_profile_id = b.quotaProfileId ?? null;
  if (b.disabled !== undefined) patch.disabled = b.disabled;
  if (b.password) {
    if (user.auth_provider !== 'local') throw new HttpError(400, 'Compte SSO : pas de mot de passe local');
    patch.password_hash = await hashPassword(b.password);
  }
  await db('users').where({ id }).update(patch);
  audit(req, 'user.updated', user.username, { fields: Object.keys(patch).filter((k) => k !== 'password_hash').concat(b.password ? ['password'] : []) });
  res.json((await adminUsers()).find((x) => x.id === id));
}));

adminRouter.delete('/users/:id', ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  if (id === req.user!.id) throw new HttpError(400, 'Impossible de supprimer votre propre compte');
  const user = await db<UserRow>('users').where({ id }).first();
  if (!user) throw new HttpError(404, 'Utilisateur introuvable');
  const shares = await db<ShareRow>('shares').where({ owner_id: id }).whereIn('status', ['ready', 'pending']);
  for (const s of shares) await purgeShare(s, 'deleted');
  await db('links').whereIn('target_id', db('requests').where({ owner_id: id }).select('id')).delete();
  await db('users').where({ id }).delete();
  audit(req, 'user.deleted', user.username, { shares: shares.length });
  res.json({ ok: true });
}));

/** Approves an account created through approval-mode registration. */
adminRouter.post('/users/:id/approve', ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const [user] = await db<UserRow>('users').where({ id }).update({ pending_approval: false }).returning('*');
  if (!user) throw new HttpError(404, 'Utilisateur introuvable');
  audit(req, 'user.approved', user.username);
  if (user.email && user.email_verified) {
    notifyEvent('account_approved', user.email, { name: user.display_name, link: absoluteUrl(req, '/login') }, baseUrl(req));
  }
  res.json((await adminUsers()).find((x) => x.id === id));
}));

/** Marks an account's e-mail as verified (e.g. the verification mail never arrived). */
adminRouter.post('/users/:id/verify-email', ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const n = await db('users').where({ id }).update({ email_verified: true });
  if (!n) throw new HttpError(404, 'Utilisateur introuvable');
  audit(req, 'user.email_verified', id, { by: 'admin' });
  res.json((await adminUsers()).find((x) => x.id === id));
}));

// ── Invitations (work even when self-registration is closed) ───────────────

adminRouter.get('/invites', ah(async (_req, res) => {
  const rows = await db<InviteRow>('invites').orderBy('created_at', 'desc').limit(200);
  res.json(rows.map(inviteDTO));
}));

adminRouter.post('/invites', ah(async (req, res) => {
  const b = z.object({
    email: z.string().trim().toLowerCase().email().nullish().or(z.literal('')),
    displayName: z.string().trim().max(100).nullish(),
    role: z.enum(['admin', 'user']).default('user'),
    profileId: z.string().uuid().nullish(),
    note: z.string().trim().max(1000).nullish(),
    expiryHours: z.number().int().min(1).max(24 * 90).default(168),
    send: z.boolean().default(false),
  }).parse(req.body);
  const email = b.email || null;
  if (email && await db('users').whereRaw('lower(email) = ?', [email]).first()) throw new HttpError(409, 'Un compte existe déjà avec cette adresse e-mail');
  if (b.send && !email) throw new HttpError(400, 'Adresse e-mail requise pour envoyer l’invitation');
  const token = newSecret();
  const [row] = await db<InviteRow>('invites').insert({
    token_hash: hashToken(token), email, display_name: b.displayName || null, role: b.role, profile_id: b.profileId ?? null,
    note: b.note || null, expires_at: new Date(Date.now() + b.expiryHours * 3600_000), created_by: req.user!.id,
  }).returning('*');
  const link = absoluteUrl(req, `/register?invite=${token}`);
  if (b.send && email) {
    notifyEvent('account_invite', email, {
      inviter: req.user!.display_name, message: row.note ?? '', expires: fmtDate(new Date(row.expires_at)), link,
    }, baseUrl(req));
  }
  audit(req, 'invite.created', email ?? row.id, { role: row.role, profile: row.profile_id, sent: b.send });
  res.status(201).json({ ...inviteDTO(row), link });
}));

adminRouter.delete('/invites/:id', ah(async (req, res) => {
  const n = await db('invites').where({ id: uuid.parse(req.params.id) }).delete();
  if (!n) throw new HttpError(404, 'Invitation introuvable');
  audit(req, 'invite.revoked', req.params.id);
  res.json({ ok: true });
}));

// ── Quota profiles ─────────────────────────────────────────────────────────

function profileDTO(p: ProfileRow & { user_count?: string | number }): QuotaProfile {
  return {
    id: p.id, name: p.name, description: p.description,
    maxFileSizeMb: p.max_file_size_mb, maxShareSizeMb: p.max_share_size_mb, storageQuotaMb: p.storage_quota_mb,
    defaultExpiryHours: p.default_expiry_hours, maxExpiryHours: p.max_expiry_hours,
    allowNeverExpire: p.allow_never_expire, allowPublic: p.allow_public, sharexEnabled: p.sharex_enabled,
    linkPolicy: p.link_policy ?? {}, oidcGroups: p.oidc_groups ?? [], isDefault: p.is_default,
    userCount: Number(p.user_count ?? 0),
  };
}

const profileBody = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  maxFileSizeMb: z.number().int().min(0).nullable().default(null),
  maxShareSizeMb: z.number().int().min(0).nullable().default(null),
  storageQuotaMb: z.number().int().min(0).nullable().default(null),
  defaultExpiryHours: z.number().int().min(0).nullable().default(null),
  maxExpiryHours: z.number().int().min(0).nullable().default(null),
  allowNeverExpire: z.boolean().nullable().default(null),
  allowPublic: z.boolean().nullable().default(null),
  sharexEnabled: z.boolean().nullable().default(null),
  linkPolicy: policyLayerSchema.default({}),
  oidcGroups: z.array(z.string().min(1)).default([]),
  isDefault: z.boolean().default(false),
});

function profileRow(b: Partial<z.infer<typeof profileBody>>) {
  const map: Record<string, string> = {
    name: 'name', description: 'description', maxFileSizeMb: 'max_file_size_mb', maxShareSizeMb: 'max_share_size_mb',
    storageQuotaMb: 'storage_quota_mb', defaultExpiryHours: 'default_expiry_hours', maxExpiryHours: 'max_expiry_hours',
    allowNeverExpire: 'allow_never_expire', allowPublic: 'allow_public', sharexEnabled: 'sharex_enabled', oidcGroups: 'oidc_groups', isDefault: 'is_default',
  };
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (k === 'linkPolicy') row.link_policy = JSON.stringify(v);
    else if (map[k]) row[map[k]] = v;
  }
  return row;
}

async function listProfiles() {
  const rows = await db('quota_profiles as p').leftJoin('users as u', 'u.quota_profile_id', 'p.id')
    .groupBy('p.id').select('p.*').count({ user_count: 'u.id' }).orderBy('p.created_at');
  return rows.map((r) => profileDTO(r as any));
}

adminRouter.get('/profiles', ah(async (_req, res) => res.json(await listProfiles())));

adminRouter.post('/profiles', ah(async (req, res) => {
  const b = profileBody.parse(req.body);
  const [row] = await db.transaction(async (trx) => {
    if (b.isDefault) await trx('quota_profiles').update({ is_default: false });
    return trx('quota_profiles').insert(profileRow(b)).returning('*');
  });
  audit(req, 'profile.created', row.name);
  res.status(201).json((await listProfiles()).find((p) => p.id === row.id));
}));

adminRouter.patch('/profiles/:id', ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const b = profileBody.partial().parse(req.body);
  await db.transaction(async (trx) => {
    if (b.isDefault) await trx('quota_profiles').whereNot({ id }).update({ is_default: false });
    const n = await trx('quota_profiles').where({ id }).update(profileRow(b));
    if (!n) throw new HttpError(404, 'Profil introuvable');
  });
  audit(req, 'profile.updated', id, { fields: Object.keys(b) });
  res.json((await listProfiles()).find((p) => p.id === id));
}));

adminRouter.delete('/profiles/:id', ah(async (req, res) => {
  const n = await db('quota_profiles').where({ id: uuid.parse(req.params.id) }).delete();
  if (!n) throw new HttpError(404, 'Profil introuvable');
  audit(req, 'profile.deleted', req.params.id);
  res.json({ ok: true });
}));

// ── Settings ───────────────────────────────────────────────────────────────

const mailEventSchema = z.object({ subject: z.string().max(300), heading: z.string().max(300), body: z.string().max(5000), button: z.string().max(80) });
const obligateSchema = z.object({
  enabled: z.boolean(),
  url: z.string().trim().max(300).refine((v) => !v || /^https?:\/\/[^/\s]+/i.test(v), 'URL invalide (http:// ou https://)').transform((v) => v.replace(/\/+$/, '')),
  apiKey: z.string().max(500), inboundSecret: z.string().max(500),
  buttonLabel: z.string().max(60), autoRedirect: z.boolean(), autoCreate: z.boolean(),
  defaultProfileId: z.string().uuid().nullable(),
});

const mailTemplatesSchema = z.object({
  theme: z.enum(MAIL_THEMES as [MailTheme, ...MailTheme[]]),
  showLogo: z.boolean(),
  footer: z.string().max(400),
  events: z.object(Object.fromEntries(MAIL_EVENTS.map((e) => [e, mailEventSchema])) as Record<MailEventKey, typeof mailEventSchema>),
});

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue');
const settingSchemas: Record<SettingsKey, z.ZodTypeAny> = {
  branding: z.object({
    name: z.string().min(1).max(60), tagline: z.string().max(120), welcome: z.string().max(400), accent: hex, footer: z.string().max(400),
    logoLight: z.string().nullable(), logoDark: z.string().nullable(), favicon: z.string().nullable(),
  }),
  limits: z.object({
    maxFileSizeMb: z.number().int().min(0), maxShareSizeMb: z.number().int().min(0), storageQuotaMb: z.number().int().min(0),
    defaultExpiryHours: z.number().int().min(0), maxExpiryHours: z.number().int().min(0), allowNeverExpire: z.boolean(),
    allowPublic: z.boolean(), defaultVisibility: z.enum(['private', 'public']),
    sharexEnabled: z.boolean(), sharexExpiryHours: z.number().int().min(0), sharexVisibility: z.enum(['private', 'public']),
    uploadParallel: z.number().int().min(0).max(32),
    uploadParallelMax: z.number().int().min(1).max(32),
    sharexDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+(:d+)?$/, 'Nom d’hôte invalide')).max(20), requestMaxExpiryHours: z.number().int().min(0),
  }),
  auth: z.object({
    localLogin: z.boolean(),
    oidc: z.object({
      enabled: z.boolean(), tenantId: z.string().max(100), clientId: z.string().max(100), clientSecret: z.string().max(500),
      buttonLabel: z.string().max(60), autoCreate: z.boolean(), adminGroups: z.array(z.string()), allowedGroups: z.array(z.string()),
      defaultProfileId: z.string().uuid().nullable(),
    }),
    obligate: obligateSchema,
    registration: z.object({
      mode: z.enum(['disabled', 'open', 'email', 'approval', 'email_approval']),
      allowedDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Domaine invalide')).max(50),
      defaultProfileId: z.string().uuid().nullable(),
    }),
  }),
  mail: z.object({
    provider: z.enum(['none', 'smtp', 'graph']), from: z.string().max(200),
    smtp: z.object({ host: z.string(), port: z.number().int().min(1).max(65535), secure: z.boolean(), user: z.string(), pass: z.string() }),
    graph: z.object({ tenantId: z.string(), clientId: z.string(), clientSecret: z.string(), sender: z.string() }),
    templates: mailTemplatesSchema,
  }),
  storage: z.object({
    driver: z.enum(['local', 's3']),
    s3: z.object({
      endpoint: z.string(), region: z.string(), bucket: z.string(), accessKeyId: z.string(), secretAccessKey: z.string(),
      forcePathStyle: z.boolean(), prefix: z.string(),
    }),
  }),
  links: z.object({
    sources: z.object({ web: policyLayerSchema, sharex: policyLayerSchema, request: policyLayerSchema }),
    publicMinRandom: z.number().int().min(0).max(32),
    reserved: z.array(z.string().min(1).max(32)),
  }),
};

adminRouter.get('/settings', ah(async (_req, res) => {
  const keys = Object.keys(settingSchemas) as SettingsKey[];
  const entries = await Promise.all(keys.map(async (k) => [k, maskSecrets(k, await getSetting(k))]));
  res.json(Object.fromEntries(entries));
}));

adminRouter.put('/settings/:key', ah(async (req, res) => {
  const key = req.params.key as SettingsKey;
  if (!settingSchemas[key]) throw new HttpError(404, 'Réglage inconnu');
  const value = settingSchemas[key].parse(req.body);
  if (key === 'auth' && !value.localLogin && !value.oidc.enabled && !value.obligate.enabled) throw new HttpError(400, 'Au moins un mode de connexion doit rester actif');
  if (key === 'storage' && value.driver === 's3') {
    const current = await getSetting('storage');
    const s3 = { ...value.s3, secretAccessKey: value.s3.secretAccessKey.startsWith('•') ? current.s3.secretAccessKey : value.s3.secretAccessKey };
    await testS3(s3).catch((err) => { throw new HttpError(400, `S3 injoignable : ${err.message}`); });
  }
  const saved = await setSetting(key, value);
  audit(req, 'settings.updated', key);
  if (key === 'auth' || key === 'branding') void announceSelfInfo();
  res.json(maskSecrets(key, saved));
}));

const eventKey = z.enum(MAIL_EVENTS as [MailEventKey, ...MailEventKey[]]);

/** Sends a sample of one event to check delivery and look (uses the saved settings). */
/** Checks the (possibly unsaved) Obligate settings: reachable, API key accepted, redirect URI to register. */
adminRouter.post('/settings/obligate/test', ah(async (req, res) => {
  const { settings } = z.object({ settings: settingSchemas.auth }).parse(req.body);
  const s = (await withStoredSecrets('auth', settings)).obligate;
  if (!s.url) throw new HttpError(400, 'Renseignez l’URL d’Obligate');
  const reachable = await obligateReachable(s);
  let keyAccepted: boolean | null = null;
  if (reachable && s.apiKey) {
    try {
      const r = await fetch(`${obligateBase(s)}/api/apps/connected`, { headers: { Authorization: `Bearer ${s.apiKey}` }, signal: AbortSignal.timeout(5000) });
      keyAccepted = r.ok;
    } catch { keyAccepted = false; }
  }
  res.json({
    reachable, keyAccepted,
    clientId: s.apiKey ? obligateClientId(s.apiKey) : null,
    baseUrl: baseUrl(req), callbackUrl: `${baseUrl(req)}/auth/callback`,
  });
}));

adminRouter.post('/settings/mail/test', ah(async (req, res) => {
  const { to, event, settings } = z.object({
    to: z.string().email(),
    event: eventKey.default('share_invite'),
    /** Unsaved form values: lets the admin test before saving (masked secrets = stored ones). */
    settings: settingSchemas.mail.optional(),
  }).parse(req.body);
  const sample = { ...SAMPLE_VARS, link: `${baseUrl(req)}/`, sender: req.user!.display_name };
  try {
    if (settings) {
      const mail = await withStoredSecrets('mail', settings);
      if (mail.provider === 'none') throw new Error('choisissez SMTP ou Microsoft Graph');
      const branding = await getSetting('branding');
      await deliver(to, renderEvent(event, sample, { branding, templates: mail.templates, baseUrl: baseUrl(req) }), mail);
    } else {
      await deliver(to, await renderFor(event, sample, baseUrl(req)));
    }
  } catch (err: any) {
    throw new HttpError(400, `Échec de l’envoi : ${err.message}`);
  }
  res.json({ ok: true });
}));

/** Live preview for the template editor: renders unsaved edits with sample data. */
adminRouter.post('/mail/preview', ah(async (req, res) => {
  const b = z.object({ event: eventKey, templates: mailTemplatesSchema }).parse(req.body);
  const branding = await getSetting('branding');
  const out = renderEvent(b.event, { ...SAMPLE_VARS, sender: req.user!.display_name }, { branding, templates: b.templates, baseUrl: baseUrl(req) });
  res.json(out);
}));

adminRouter.get('/mail/meta', (_req, res) => {
  res.json({ variables: MAIL_VARIABLES, defaults: DEFAULT_MAIL_TEMPLATES });
});

// ── Branding assets ────────────────────────────────────────────────────────

const brandingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, f, cb) => cb(null, /^image\/(png|jpeg|webp|svg\+xml|x-icon|vnd\.microsoft\.icon|gif)$/.test(f.mimetype)),
});
const SLOTS = ['logoLight', 'logoDark', 'favicon'] as const;

adminRouter.post('/branding/:slot', brandingUpload.single('file'), ah(async (req, res) => {
  const slot = z.enum(SLOTS).parse(req.params.slot);
  if (!req.file) throw new HttpError(400, 'Image PNG, JPEG, WebP, SVG ou ICO attendue (2 Mo max)');
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' }[req.file.mimetype] ?? 'ico';
  const name = `${slot}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  await fsp.writeFile(path.join(config.dirs.branding, name), req.file.buffer);
  const branding = await getSetting('branding');
  await removeBrandingFile(branding[slot]);
  const saved = await setSetting('branding', { ...branding, [slot]: `/branding/${name}` });
  audit(req, 'branding.updated', slot);
  res.json(saved);
}));

adminRouter.delete('/branding/:slot', ah(async (req, res) => {
  const slot = z.enum(SLOTS).parse(req.params.slot);
  const branding = await getSetting('branding');
  await removeBrandingFile(branding[slot]);
  res.json(await setSetting('branding', { ...branding, [slot]: null }));
}));

async function removeBrandingFile(url: string | null) {
  if (url?.startsWith('/branding/')) await fsp.rm(path.join(config.dirs.branding, path.basename(url)), { force: true });
}

// ── Audit ──────────────────────────────────────────────────────────────────

adminRouter.get('/audit', ah(async (req, res) => {
  const q = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    action: z.string().optional(),
  }).parse(req.query);
  const base = db('audit_log as a').leftJoin('users as u', 'u.id', 'a.user_id');
  if (q.action) base.where('a.action', 'like', `${q.action}%`);
  const total = Number((await base.clone().count({ n: '*' }).first())?.n ?? 0);
  const rows = await base.select('a.*', 'u.username').orderBy('a.id', 'desc').limit(q.pageSize).offset((q.page - 1) * q.pageSize);
  const items: AuditEntry[] = rows.map((r: any) => ({
    id: Number(r.id), action: r.action, target: r.target, ip: r.ip, meta: r.meta ?? {},
    createdAt: new Date(r.created_at).toISOString(), user: r.user_id ? { id: r.user_id, username: r.username } : null,
  }));
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
}));
