import type { LinkOptions, LinkSettings, PolicyLayer, ResolvedLinkPolicy, UserLinkPrefs, LinkSource } from './links.js';

export type Role = 'admin' | 'user';
export type Visibility = 'private' | 'public';
export type ShareSource = 'web' | 'sharex' | 'request';
export type ShareKind = 'files' | 'url';

// ── Settings (key/value rows in `settings`) ─────────────────────────────────

export interface BrandingSettings {
  name: string;
  tagline: string;
  welcome: string;
  accent: string;
  footer: string;
  logoLight: string | null;
  logoDark: string | null;
  favicon: string | null;
}

export interface LimitSettings {
  maxFileSizeMb: number;      // 0 = unlimited
  maxShareSizeMb: number;     // 0 = unlimited
  storageQuotaMb: number;     // per user, 0 = unlimited
  defaultExpiryHours: number; // 0 = never
  maxExpiryHours: number;     // 0 = no cap
  allowNeverExpire: boolean;
  allowPublic: boolean;
  defaultVisibility: Visibility;
  sharexEnabled: boolean;     // default for users without a profile override
  sharexExpiryHours: number;  // 0 = never
  sharexVisibility: Visibility;
  /** Extra hostnames (pointing to this instance) ShareX configs may return links on. */
  sharexDomains: string[];
  requestMaxExpiryHours: number;
}

export interface OidcSettings {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  buttonLabel: string;
  autoCreate: boolean;
  adminGroups: string[];
  allowedGroups: string[];
}

export interface AuthSettings {
  localLogin: boolean;
  oidc: OidcSettings;
}

export type MailTheme = 'signal' | 'minimal' | 'corporate' | 'sunset';
export const MAIL_THEMES: MailTheme[] = ['signal', 'minimal', 'corporate', 'sunset'];

export type MailEventKey = 'share_invite' | 'request_invite' | 'request_received' | 'share_downloaded';
export const MAIL_EVENTS: MailEventKey[] = ['share_invite', 'request_invite', 'request_received', 'share_downloaded'];

/** Editable copy of one e-mail. Supports {{variables}}; the body keeps line breaks. */
export interface MailEventTemplate { subject: string; heading: string; body: string; button: string }

export interface MailTemplateSettings {
  theme: MailTheme;
  showLogo: boolean;
  footer: string;
  events: Record<MailEventKey, MailEventTemplate>;
}

export interface MailSettings {
  provider: 'none' | 'smtp' | 'graph';
  from: string;
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string };
  graph: { tenantId: string; clientId: string; clientSecret: string; sender: string };
  templates: MailTemplateSettings;
}

export interface StorageSettings {
  driver: 'local' | 's3';
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    prefix: string;
  };
}

export interface SettingsMap {
  branding: BrandingSettings;
  limits: LimitSettings;
  auth: AuthSettings;
  mail: MailSettings;
  storage: StorageSettings;
  links: LinkSettings;
}
export type SettingsKey = keyof SettingsMap;

/** Secret fields are never sent back to the browser; this placeholder means "unchanged". */
export const SECRET_PLACEHOLDER = '••••••••';

export interface QuotaProfile {
  id: string;
  name: string;
  description: string;
  maxFileSizeMb: number | null;
  maxShareSizeMb: number | null;
  storageQuotaMb: number | null;
  defaultExpiryHours: number | null;
  maxExpiryHours: number | null;
  allowNeverExpire: boolean | null;
  allowPublic: boolean | null;
  sharexEnabled: boolean | null;
  linkPolicy: PolicyLayer;
  oidcGroups: string[];
  isDefault: boolean;
  userCount?: number;
}

export interface EffectiveLimits {
  maxFileSize: number;  // bytes, 0 = unlimited
  maxShareSize: number;
  storageQuota: number;
  storageUsed: number;
  defaultExpiryHours: number;
  maxExpiryHours: number;
  allowNeverExpire: boolean;
  allowPublic: boolean;
  defaultVisibility: Visibility;
  sharexEnabled: boolean;
  sharexDomains: string[];
}

// ── API DTOs ─────────────────────────────────────────────────────────────────

export interface PublicConfig {
  branding: BrandingSettings;
  localLogin: boolean;
  oidc: { enabled: boolean; buttonLabel: string };
  /** A mail provider is configured: links can be sent by e-mail. */
  mailEnabled: boolean;
  version: string;
}

export interface Me {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: Role;
  authProvider: 'local' | 'oidc';
  userCode: string;
  vanity: string | null;
  linkPrefs: UserLinkPrefs;
  limits: EffectiveLimits;
  linkPolicies: Record<LinkSource, ResolvedLinkPolicy>;
  publicMinRandom: number;
}

export interface FileDTO {
  id: string;
  name: string;
  slug: string;
  mime: string;
  size: number;
  hasThumb: boolean;
  url: string;
  rawUrl: string;
  downloads: number;
}

export interface ShareDTO {
  id: string;
  kind: ShareKind;
  prefix: string;
  slug: string;
  url: string;
  title: string | null;
  message: string | null;
  visibility: Visibility;
  hasPassword: boolean;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloads: number;
  source: ShareSource;
  status: 'pending' | 'ready' | 'expired' | 'deleted';
  totalSize: number;
  fileCount: number;
  files: FileDTO[];
  targetUrl: string | null;
  createdAt: string;
  owner?: { id: string; username: string; displayName: string };
  uploader?: { name: string | null; email: string | null; ip: string | null } | null;
  requestId?: string | null;
  notifyOnDownload?: boolean;
}

export interface RequestDTO {
  id: string;
  prefix: string;
  slug: string;
  url: string;
  title: string;
  message: string | null;
  hasPassword: boolean;
  expiresAt: string | null;
  maxFiles: number | null;
  maxSizeMb: number | null;
  active: boolean;
  uploadsCount: number;
  createdAt: string;
}

export interface CreateShareInput {
  title?: string | null;
  message?: string | null;
  visibility?: Visibility;
  password?: string | null;
  expiryHours?: number | null;
  maxDownloads?: number | null;
  notifyOnDownload?: boolean;
  linkOverride?: Partial<LinkOptions> | null;
  /** E-mail addresses that receive the link once the share is ready. */
  recipients?: string[];
}

/** Answer of GET /api/public/resolve — tells the SPA what lives at a path. */
export type ResolveResult =
  | { kind: 'share'; share: ShareDTO; owner: { displayName: string }; fileSlug?: string | null }
  | { kind: 'request'; request: Pick<RequestDTO, 'id' | 'title' | 'message' | 'hasPassword' | 'expiresAt' | 'maxFiles' | 'maxSizeMb'>; owner: { displayName: string }; unlocked: boolean }
  | { kind: 'locked'; target: 'share'; title: string | null }
  | { kind: 'login'; }
  | { kind: 'gone'; reason: 'expired' | 'limit' | 'deleted' | 'closed' }
  | { kind: 'notfound' };

export interface AdminStats {
  users: number;
  activeShares: number;
  files: number;
  storageUsed: number;
  uploadsByDay: { day: string; count: number; bytes: number }[];
  bySource: { source: ShareSource; count: number }[];
  topUsers: { id: string; username: string; displayName: string; bytes: number; shares: number }[];
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: Role;
  authProvider: 'local' | 'oidc';
  disabled: boolean;
  quotaProfileId: string | null;
  storageUsed: number;
  shareCount: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuditEntry {
  id: number;
  action: string;
  target: string | null;
  ip: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  user: { id: string; username: string } | null;
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
