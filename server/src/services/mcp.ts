import type { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import type { AiKeyScope } from '@ferry/shared';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { logger } from '../logger.js';
import { authenticateKey, REFUSALS, type AiKeyContext } from './aiKeys.js';
import {
  cancelAgentUpload, createAgentUpload, DEFAULT_WINDOW_MIN, finishAgentUpload, MAX_AGENT_FILES, MAX_WINDOW_MIN, ownShare, planStatus,
  renewUploadUrls, shareLinks, windowClosed,
} from './agentUploads.js';
import { computeExpiry, HttpError, isExpired, purgeShare, resolveVisibility, shareMailVars, type ShareRow } from './shares.js';
import { effectiveLimits, hashPassword } from './users.js';
import { notifyEvent } from './mail.js';
import { getSetting } from './settings.js';
import { audit } from './audit.js';
import { baseUrl } from '../utils/http.js';
import { AGENT_GUIDE } from './mcpGuide.js';
import { mcpChallenge } from './oauth.js';

// ─── MCP server of the AI access keys ────────────────────────────────────────
//
// Stateless Streamable HTTP, like the MCP servers of the Obli* suite: POST /mcp
// takes JSON-RPC 2.0 (one message or a batch of at most 20) and answers JSON.
// Methods: initialize, ping, tools/list, tools/call; notifications get no reply.
// Auth: Authorization: Bearer frk_… (services/aiKeys.ts), checked on every call.
//
// Files never travel through MCP: create_upload hands out one upload URL per
// file and the agent sends the bytes itself with curl (routes/agentUpload.ts).

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BATCH = 20;

interface JsonRpcMessage { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
interface ToolResult { content: Array<{ type: 'text'; text: string }>; isError?: boolean }
interface Env { req: Request; ctx: AiKeyContext }

interface ToolDef {
  name: string;
  title: string;
  description: string;
  scope: AiKeyScope | null;
  readOnly: boolean;
  destructive?: boolean;
  args: z.ZodTypeAny;
  inputSchema: Record<string, unknown>;
  run(env: Env, args: any): Promise<unknown>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const SHARE_ID = { type: 'string', description: 'Share id (uuid), from create_upload / list_shares.' };

const GiB = 1024 ** 3;
const bytes = (n: number) => (n >= GiB ? `${(n / GiB).toFixed(1)} GiB` : `${Math.round(n / 1024 ** 2)} MiB`);

/** A share this key may change: the account's, sent by an AI agent. */
async function agentShare(ctx: AiKeyContext, id: unknown): Promise<ShareRow> {
  const share = await ownShare(ctx, id);
  if (share.source !== 'mcp') throw new HttpError(403, 'Only shares sent by an AI agent can be changed with a key: ask the human to do it in Ferry');
  return share;
}

function uploadEntry(index: number, name: string, size: number | null, url: string) {
  return {
    index, name, size, upload_url: url,
    curl: `curl --fail-with-body -sS -T "<path of ${name}>" "${url}"`,
  };
}

const tools: ToolDef[] = [
  {
    name: 'whoami',
    title: 'Who am I',
    description: 'The account this key acts as, its rights, its limits (file size, quota, expiry, public links), what this instance offers (passwords, e-mail) and the base URL. Call it first.',
    scope: null, readOnly: true,
    args: z.object({}).strict(),
    inputSchema: obj({}),
    async run({ req, ctx }) {
      const l = await effectiveLimits(ctx.user);
      const [branding, mail] = await Promise.all([getSetting('branding'), getSetting('mail')]);
      return {
        instance: { name: branding.name, baseUrl: baseUrl(req), version: config.version },
        account: { username: ctx.user.username.replace(/^og_/, ''), displayName: ctx.user.display_name, role: ctx.user.role },
        key: { name: ctx.key.name, kind: ctx.key.kind, rights: ctx.key.scopes, expiresAt: ctx.key.expires_at },
        limits: {
          maxFileSize: l.maxFileSize || null, maxShareSize: l.maxShareSize || null,
          storageQuota: l.storageQuota || null, storageUsed: l.storageUsed,
          storageFree: l.storageQuota ? Math.max(0, l.storageQuota - l.storageUsed) : null,
          defaultExpiryHours: l.defaultExpiryHours || null, maxExpiryHours: l.maxExpiryHours || null,
          neverExpireAllowed: l.allowNeverExpire, publicLinksAllowed: l.allowPublic,
          note: 'Sizes in bytes; null = unlimited.',
        },
        options: {
          publicLinks: l.allowPublic, privateLinks: true, passwords: true, maxDownloads: true,
          emailSending: mail.provider !== 'none', notifyOnDownload: mail.provider !== 'none',
          note: 'What a share can have. emailSending false = send_share is unavailable: give the links to the human instead.',
        },
        upload: {
          windowMinutesDefault: DEFAULT_WINDOW_MIN, windowMinutesMax: MAX_WINDOW_MIN,
          pieceSizeIfProxyLimits: config.uploadChunkMb * 1024 * 1024,
        },
        canModify: 'Only the shares sent by an AI agent (source mcp) can be changed, e-mailed or deleted with a key. The human\'s own shares are read-only here.',
        tools: tools.filter((t) => !t.scope || ctx.key.scopes.includes(t.scope)).map((t) => t.name),
      };
    },
  },
  {
    name: 'get_guide',
    title: 'Guide',
    description: 'How to send files to Ferry with curl (whole or in resumable pieces), get the direct download link and download it on other machines. Read it before your first upload.',
    scope: null, readOnly: true,
    args: z.object({}).strict(),
    inputSchema: obj({}),
    async run() { return AGENT_GUIDE; },
  },
  {
    name: 'create_upload',
    title: 'Start an upload',
    description: 'Announces the files of a new share and returns one upload URL per file. Then send each file with the curl command given (curl -T, raw bytes, NOT multipart). The answer of the last file contains the links (page + direct download). Files never go through MCP.',
    scope: 'upload', readOnly: false,
    args: z.object({
      files: z.array(z.object({ name: z.string().min(1).max(255), size: z.number().int().min(0).optional() }).strict()).min(1).max(MAX_AGENT_FILES),
      title: z.string().max(200).optional(),
      message: z.string().max(2000).optional(),
      visibility: z.enum(['public', 'private']).optional(),
      expires_hours: z.number().int().min(0).max(24 * 3650).optional(),
      max_downloads: z.number().int().min(1).max(1_000_000).optional(),
      password: z.string().min(4).max(200).optional(),
      notify_on_download: z.boolean().optional(),
      upload_window_minutes: z.number().int().min(5).max(MAX_WINDOW_MIN).optional(),
    }).strict(),
    inputSchema: obj({
      files: {
        type: 'array', minItems: 1, maxItems: MAX_AGENT_FILES,
        description: 'The files, by plain name (no folder). Give the size in bytes when you know it: limits are checked before you send anything and the upload must match it.',
        items: obj({ name: { type: 'string', description: 'File name as it will be downloaded, e.g. "setup-2.4.1.msi".' }, size: { type: 'integer', description: 'Size in bytes.' } }, ['name']),
      },
      title: { type: 'string', description: 'Title of the share (shown on its page). Useful with several files.' },
      message: { type: 'string', description: 'Message shown on the share page.' },
      visibility: { type: 'string', enum: ['public', 'private'], description: 'public (default when allowed) = anyone with the link can download, needed to curl it from other machines. private = a Ferry sign-in is required.' },
      expires_hours: { type: 'integer', description: 'Lifetime in hours (0 = never, if allowed). Default: the account default. Capped by the account maximum. Prefer the shortest that fits the task.' },
      max_downloads: { type: 'integer', description: 'The share disappears after this many downloads (e.g. the number of machines). Default: unlimited.' },
      password: { type: 'string', description: 'Protects the share (4-200 characters): the page asks for it, curl sends it with -H "X-Share-Password: ...". Give it to the human apart from the link, never in the share message.' },
      notify_on_download: { type: 'boolean', description: 'E-mails the account owner at each download (when e-mail is configured, see whoami).' },
      upload_window_minutes: { type: 'integer', description: `How long the upload URLs work, 5-${MAX_WINDOW_MIN} minutes, default ${DEFAULT_WINDOW_MIN}. Pick what the transfer needs: short for a small file, longer for a big one on a slow link.` },
    }, ['files']),
    async run({ req, ctx }, a) {
      const { share, urls } = await createAgentUpload(req, ctx, {
        files: a.files, title: a.title, message: a.message, visibility: a.visibility,
        expiryHours: a.expires_hours, maxDownloads: a.max_downloads, password: a.password,
        notifyOnDownload: a.notify_on_download, windowMinutes: a.upload_window_minutes,
      });
      audit(req, 'mcp.upload_started', share.id, { key: ctx.key.name, files: a.files.length });
      return {
        upload_id: share.id,
        visibility: share.visibility,
        hasPassword: !!share.password_hash,
        shareExpiresAt: share.expires_at,
        maxDownloads: share.max_downloads,
        uploadUrlsExpireAt: share.upload_expires_at,
        files: share.upload_plan!.map((f, index) => uploadEntry(index, f.name, f.size, urls[index])),
        next: [
          'Send each file with its curl command (on Windows: curl.exe, same options). The answer of the last one carries `share` with the links.',
          `If a request is refused for its size (HTTP 413 from a proxy) or keeps breaking, send pieces of ${config.uploadChunkMb} MiB with Content-Range (get_guide, "Large files"); GET upload_url tells how many bytes are stored.`,
          'File on another machine (remote shell, RMM such as Obliance): run the command ON that machine, it needs only the upload URL, never this key. Windows without curl.exe, or remote commands with a time limit: the resumable PowerShell loop of get_guide.',
          'finish_upload publishes what was received if you drop a file; cancel_upload abandons everything.',
          'Each upload URL is a single-use token for ONE file: it stops working once that file is complete, when the share is published or cancelled, or at uploadUrlsExpireAt. Keep them out of shares, tickets and chats. get_upload with renew_urls gives new ones (the old ones die).',
        ],
      };
    },
  },
  {
    name: 'get_upload',
    title: 'Upload status',
    description: 'Progress of an upload (bytes received per file), or its links once published. renew_urls: new upload URLs for the files still missing, the previous ones stop working (lost, leaked, or the window closed); bytes already received are kept.',
    scope: 'upload', readOnly: false,
    args: z.object({
      upload_id: z.string(),
      renew_urls: z.boolean().optional(),
      upload_window_minutes: z.number().int().min(5).max(MAX_WINDOW_MIN).optional(),
    }).strict(),
    inputSchema: obj({
      upload_id: { type: 'string', description: 'upload_id given by create_upload.' },
      renew_urls: { type: 'boolean', description: 'Issue new upload URLs for the missing files and revoke the previous ones.' },
      upload_window_minutes: { type: 'integer', description: `With renew_urls: the new window from now (default: unchanged, or ${DEFAULT_WINDOW_MIN} minutes if it was closed).` },
    }, ['upload_id']),
    async run({ req, ctx }, a) {
      let share = await ownShare(ctx, a.upload_id);
      if (share.status !== 'pending') return { status: 'published', share: await shareLinks(req, share) };
      if (!a.renew_urls) {
        return { status: 'receiving', uploadUrlsExpireAt: share.upload_expires_at, windowClosed: windowClosed(share), files: await planStatus(share) };
      }
      const renewed = await renewUploadUrls(req, share, a.upload_window_minutes ?? (windowClosed(share) ? DEFAULT_WINDOW_MIN : null));
      share = renewed.share;
      audit(req, 'mcp.upload_renewed', share.id, { key: ctx.key.name });
      const status = await planStatus(share);
      return {
        status: 'receiving', uploadUrlsExpireAt: share.upload_expires_at,
        files: status.map((f) => (renewed.urls[f.index] ? { ...f, ...uploadEntry(f.index, f.name, f.size, renewed.urls[f.index]) } : f)),
      };
    },
  },
  {
    name: 'finish_upload',
    title: 'Finish an upload',
    description: 'Publishes the upload with the files fully received so far (the others are dropped) and returns the links. Not needed when every announced file was sent: the share is then published by itself.',
    scope: 'upload', readOnly: false,
    args: z.object({ upload_id: z.string() }).strict(),
    inputSchema: obj({ upload_id: { type: 'string', description: 'upload_id given by create_upload.' } }, ['upload_id']),
    async run({ req, ctx }, a) {
      const share = await ownShare(ctx, a.upload_id);
      if (share.status === 'pending') {
        const ready = await finishAgentUpload(share);
        audit(req, 'share.created', ready.id, { files: ready.file_count, size: Number(ready.total_size), visibility: ready.visibility, source: 'mcp' });
        return shareLinks(req, ready);
      }
      return shareLinks(req, share);
    },
  },
  {
    name: 'cancel_upload',
    title: 'Cancel an upload',
    description: 'Abandons an upload that is not published yet: the bytes received are deleted and its upload URLs stop working.',
    scope: 'upload', readOnly: false, destructive: true,
    args: z.object({ upload_id: z.string() }).strict(),
    inputSchema: obj({ upload_id: { type: 'string', description: 'upload_id given by create_upload.' } }, ['upload_id']),
    async run({ req, ctx }, a) {
      const share = await ownShare(ctx, a.upload_id, { pending: true });
      await cancelAgentUpload(share);
      audit(req, 'mcp.upload_cancelled', share.id, { key: ctx.key.name });
      return { cancelled: true };
    },
  },
  {
    name: 'list_shares',
    title: 'List shares',
    description: 'Shares of the account, newest first, with their links. By default the active ones of every source (web, ShareX, agents, drop pages).',
    scope: 'read', readOnly: true,
    args: z.object({
      status: z.enum(['active', 'expired', 'all']).default('active'),
      source: z.enum(['web', 'sharex', 'request', 'mcp']).optional(),
      search: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }).strict(),
    inputSchema: obj({
      status: { type: 'string', enum: ['active', 'expired', 'all'], description: 'Default active.' },
      source: { type: 'string', enum: ['web', 'sharex', 'request', 'mcp'], description: 'mcp = sent by an AI agent; request = received on a drop page.' },
      search: { type: 'string', description: 'Part of a title or a file name.' },
      limit: { type: 'integer', description: '1-100, default 20.' },
    }),
    async run({ req, ctx }, a) {
      const q = db<ShareRow>('shares').where({ owner_id: ctx.user.id }).whereNot('status', 'pending').whereNot('status', 'deleted');
      if (a.status === 'active') q.where('status', 'ready').where((w) => w.whereNull('expires_at').orWhere('expires_at', '>', db.fn.now()))
        .where((w) => w.whereNull('max_downloads').orWhereRaw('download_count < max_downloads'));
      if (a.status === 'expired') q.where((w) => w.where('status', 'expired').orWhere('expires_at', '<=', db.fn.now()).orWhereRaw('download_count >= max_downloads'));
      if (a.source) q.where('source', a.source);
      if (a.search) {
        const like = `%${a.search.replace(/[\\%_]/g, (c: string) => `\\${c}`)}%`;
        q.where((w) => w.whereILike('title', like).orWhereExists(db('files').whereRaw('files.share_id = shares.id').whereILike('name', like)));
      }
      const rows = await q.orderBy('created_at', 'desc').limit(a.limit);
      return Promise.all(rows.map((s) => shareLinks(req, s)));
    },
  },
  {
    name: 'get_share',
    title: 'Get a share',
    description: 'One share of the account with its links (page, direct download of the whole share and of each file), expiry and download count.',
    scope: 'read', readOnly: true,
    args: z.object({ share_id: z.string() }).strict(),
    inputSchema: obj({ share_id: SHARE_ID }, ['share_id']),
    async run({ req, ctx }, a) {
      const share = await ownShare(ctx, a.share_id);
      if (share.status === 'pending') return { status: 'receiving', files: await planStatus(share) };
      return shareLinks(req, share);
    },
  },
  {
    name: 'update_share',
    title: 'Change a share',
    description: 'Changes a share sent by an AI agent (source mcp): title, message, visibility, password, expiry, download limit, download notification. Only the fields given change.',
    scope: 'upload', readOnly: false,
    args: z.object({
      share_id: z.string(),
      title: z.string().max(200).nullable().optional(),
      message: z.string().max(2000).nullable().optional(),
      visibility: z.enum(['public', 'private']).optional(),
      password: z.string().max(200).nullable().optional(),
      expires_hours: z.number().int().min(0).max(24 * 3650).optional(),
      max_downloads: z.number().int().min(0).max(1_000_000).optional(),
      notify_on_download: z.boolean().optional(),
    }).strict(),
    inputSchema: obj({
      share_id: SHARE_ID,
      title: { type: ['string', 'null'] },
      message: { type: ['string', 'null'] },
      visibility: { type: 'string', enum: ['public', 'private'] },
      password: { type: ['string', 'null'], description: 'New password (4-200 characters); "" or null removes it.' },
      expires_hours: { type: 'integer', description: 'New lifetime from NOW, in hours (0 = never, if allowed). Capped by the account maximum.' },
      max_downloads: { type: 'integer', description: 'New download limit, counted from the start; 0 = unlimited.' },
      notify_on_download: { type: 'boolean' },
    }, ['share_id']),
    async run({ req, ctx }, a) {
      const share = await agentShare(ctx, a.share_id);
      const limits = await effectiveLimits(ctx.user);
      const patch: Partial<ShareRow> = {};
      if (a.title !== undefined) patch.title = a.title?.trim() || null;
      if (a.message !== undefined) patch.message = a.message?.trim() || null;
      if (a.visibility !== undefined) {
        if (a.visibility === 'public' && !limits.allowPublic) throw new HttpError(403, 'Public links are not allowed for this account');
        patch.visibility = resolveVisibility(limits, a.visibility);
      }
      if (a.password !== undefined) {
        if (a.password && a.password.length < 4) throw new HttpError(400, 'A password has at least 4 characters');
        patch.password_hash = a.password ? await hashPassword(a.password) : null;
      }
      if (a.expires_hours !== undefined) {
        if (share.status === 'expired') throw new HttpError(409, 'The files of this share are already deleted: it cannot be extended');
        patch.expires_at = computeExpiry(limits, a.expires_hours);
      }
      if (a.max_downloads !== undefined) patch.max_downloads = a.max_downloads || null;
      if (a.notify_on_download !== undefined) patch.notify_on_download = a.notify_on_download;
      if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to change');
      const [row] = await db<ShareRow>('shares').where({ id: share.id }).update(patch).returning('*');
      audit(req, 'share.updated', share.id, { by: 'mcp', key: ctx.key.name, fields: Object.keys(patch) });
      return share.status === 'pending' ? { updated: Object.keys(patch), status: 'receiving' } : shareLinks(req, row);
    },
  },
  {
    name: 'send_share',
    title: 'E-mail a share',
    description: 'E-mails the link of a published share sent by an AI agent to people (Ferry sends it from the instance, with the title, message, size and expiry). Needs e-mail on the instance (whoami options.emailSending). Never e-mails a password: give it separately.',
    scope: 'upload', readOnly: false,
    args: z.object({ share_id: z.string(), recipients: z.array(z.string().trim().toLowerCase().email()).min(1).max(20) }).strict(),
    inputSchema: obj({
      share_id: SHARE_ID,
      recipients: { type: 'array', items: { type: 'string', format: 'email' }, minItems: 1, maxItems: 20, description: 'E-mail addresses (only those the human asked for).' },
    }, ['share_id', 'recipients']),
    async run({ req, ctx }, a) {
      const share = await agentShare(ctx, a.share_id);
      if (share.status !== 'ready' || isExpired(share)) throw new HttpError(409, 'Only a published, active share can be sent');
      if ((await getSetting('mail')).provider === 'none') throw new HttpError(409, 'E-mail is not configured on this instance: give the link to the human instead');
      const recipients = [...new Set<string>(a.recipients)];
      notifyEvent('share_invite', recipients, { ...(await shareMailVars(req, share)), sender: ctx.user.display_name }, baseUrl(req));
      audit(req, 'share.sent', share.id, { by: 'mcp', key: ctx.key.name, recipients: recipients.length });
      return { sent: recipients.length, recipients, hasPassword: !!share.password_hash };
    },
  },
  {
    name: 'delete_share',
    title: 'Delete a share',
    description: 'Deletes a share sent by an AI agent (source mcp): its links stop working and its files are erased. Shares the human created are never deletable with a key.',
    scope: 'delete', readOnly: false, destructive: true,
    args: z.object({ share_id: z.string() }).strict(),
    inputSchema: obj({ share_id: SHARE_ID }, ['share_id']),
    async run({ req, ctx }, a) {
      const share = await agentShare(ctx, a.share_id);
      if (share.status === 'pending') await cancelAgentUpload(share);
      else await purgeShare(share, 'deleted');
      audit(req, 'share.deleted', share.id, { by: 'mcp', key: ctx.key.name });
      return { deleted: true };
    },
  },
];

const byName = new Map(tools.map((t) => [t.name, t]));
const allowed = (t: ToolDef, ctx: AiKeyContext) => !t.scope || ctx.key.scopes.includes(t.scope);

function toolList(ctx: AiKeyContext) {
  return tools.filter((t) => allowed(t, ctx)).map((t) => ({
    name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: !!t.destructive, openWorldHint: false },
  }));
}

function text(value: unknown, isError = false): ToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) };
}

async function callTool(env: Env, params: Record<string, unknown> | undefined): Promise<ToolResult> {
  const name = String(params?.name ?? '');
  const tool = byName.get(name);
  if (!tool) return text(`Unknown tool: ${name}`, true);
  if (!allowed(tool, env.ctx)) return text(`This key does not have the "${tool.scope}" right needed by ${name}`, true);
  try {
    const args = tool.args.parse(params?.arguments ?? {});
    return text(await tool.run(env, args));
  } catch (err) {
    if (err instanceof ZodError) return text(`Invalid arguments: ${err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`, true);
    if (err instanceof HttpError) return text(err.message, true);
    logger.error({ err, tool: name }, 'mcp tool failed');
    return text('Internal error', true);
  }
}

function instructions(ctx: AiKeyContext) {
  return [
    'Ferry is a self-hosted file-sharing server. With this key you send files and get links: a page for humans and a direct download URL that curl can fetch on any machine.',
    `This key acts as the Ferry account "${ctx.user.username.replace(/^og_/, '')}" with its current limits. Rights: ${ctx.key.scopes.join(', ')}.`,
    'Files never go through MCP: create_upload gives one upload URL per file, send the bytes with curl -T, the last answer carries the links. The file may be on another machine you reach (remote shell, RMM): run the upload there, it needs only the upload URL.',
    'Shares can be public or private, password-protected, limited in time and in downloads, notify the owner, and be e-mailed: choose from the request and the situation (get_guide, "Choosing the options").',
    'Each upload URL is a single-use token for one file, valid for a window you choose: never copy this key to another machine.',
    'Call whoami, then get_guide before your first upload.',
  ].join(' ');
}

async function handle(env: Env, msg: JsonRpcMessage): Promise<object | null> {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined;
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return isNotification ? null : { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid request' } };
  }
  if (msg.method.startsWith('notifications/')) return null;
  const ok = (result: unknown) => (isNotification ? null : { jsonrpc: '2.0', id, result });
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '');
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'ferry', title: 'Ferry', version: config.version },
        instructions: instructions(env.ctx),
      });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: toolList(env.ctx) });
    case 'tools/call': return ok(await callTool(env, msg.params));
    default:
      return isNotification ? null : { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}

export async function mcpHandler(req: Request, res: Response) {
  const ctx = await authenticateKey(req);
  if (typeof ctx === 'string') {
    res.set('WWW-Authenticate', mcpChallenge(req, REFUSALS[ctx]));
    return res.status(ctx === 'disabled' ? 403 : 401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: REFUSALS[ctx] } });
  }
  req.user = ctx.user;
  const env: Env = { req, ctx };
  const body = req.body as JsonRpcMessage | JsonRpcMessage[] | undefined;
  if (Array.isArray(body)) {
    if (!body.length || body.length > MAX_BATCH) return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: `Batch of 1-${MAX_BATCH} messages` } });
    const out = (await Promise.all(body.map((m) => handle(env, m)))).filter(Boolean);
    return out.length ? res.json(out) : res.status(202).end();
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  const out = await handle(env, body);
  return out ? res.json(out) : res.status(202).end();
}
