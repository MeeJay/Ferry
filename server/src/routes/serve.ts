import fs from 'node:fs';
import { Router, type Request, type Response } from 'express';
import archiver from 'archiver';
import { formatBytes, sanitizeSegment } from '@ferry/shared';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { logger } from '../logger.js';
import { resolveSegments, linkPath } from '../services/links.js';
import { checkShareAccess, loadShare } from '../services/access.js';
import { recordDownload, type FileRow, type ShareRow } from '../services/shares.js';
import { driverFor, type ByteRange } from '../services/storage.js';
import { thumbPath } from '../services/thumbs.js';
import { getSetting } from '../services/settings.js';
import { absoluteUrl, ah } from '../utils/http.js';
import { pathSegments } from './public.js';

// Everything reachable at the root: `/{prefix}/{slug}[/{file}]`.
//  - /raw/...            → the bytes (single file, one file of a share, or a zip)
//  - /... (Accept: html) → the SPA shell, with OpenGraph tags for public shares
//  - /... (other Accept) → the bytes, so `curl` and chat unfurlers get the file

export const serveRouter = Router();

/** Types the browser may render inline. Anything else (HTML, SVG, JS…) is forced to download. */
const INLINE_SAFE = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|video\/(mp4|webm|ogg|quicktime)|audio\/[a-z0-9.+-]+|application\/pdf|text\/plain)$/;

function contentDisposition(kind: 'inline' | 'attachment', name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start: number, end: number;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? 'invalid' : { start, end };
}

async function streamFile(req: Request, res: Response, share: ShareRow, file: FileRow) {
  const size = Number(file.size);
  const preview = req.query.preview !== undefined;
  const forceDownload = req.query.dl !== undefined;
  const inline = !forceDownload && INLINE_SAFE.test(file.mime);

  res.set({
    'Content-Type': inline ? (file.mime === 'text/plain' ? 'text/plain; charset=utf-8' : file.mime) : 'application/octet-stream',
    'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', file.name),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-cache',
    'X-Content-Type-Options': 'nosniff',
    // Uploaded content is never trusted to run anything on this origin.
    'Content-Security-Policy': file.mime === 'application/pdf' ? "default-src 'none'; object-src 'self'" : "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  });

  const range = parseRange(req.get('range'), size);
  if (range === 'invalid') {
    res.status(416).set('Content-Range', `bytes */${size}`).end();
    return;
  }
  if (!preview && (!range || range.start === 0)) await recordDownload(req, share, file);
  if (req.method === 'HEAD') {
    res.set('Content-Length', String(range ? range.end - range.start + 1 : size)).status(range ? 206 : 200).end();
    return;
  }
  const driver = await driverFor(file.storage_driver);
  const stream = await driver.get(file.storage_key, range ?? undefined);
  if (range) {
    res.status(206).set({ 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': String(range.end - range.start + 1) });
  } else {
    res.set('Content-Length', String(size));
  }
  stream.on('error', (err) => { logger.warn({ err: err.message, file: file.id }, 'stream error'); res.destroy(err); });
  stream.pipe(res);
}

async function streamZip(req: Request, res: Response, share: ShareRow, files: FileRow[]) {
  const name = `${sanitizeSegment(share.title || share.slug || 'partage', true)}.zip`;
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': contentDisposition('attachment', name), 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  await recordDownload(req, share, null);
  const zip = archiver('zip', { zlib: { level: 1 } });
  zip.on('error', (err) => { logger.warn({ err: err.message }, 'zip error'); res.destroy(err); });
  zip.pipe(res);
  for (const f of files) {
    const driver = await driverFor(f.storage_driver);
    zip.append(await driver.get(f.storage_key), { name: f.slug, date: f.created_at });
  }
  await zip.finalize();
}

async function serveRaw(req: Request, res: Response, segs: string[]) {
  const hit = await resolveSegments(segs);
  if (!hit || hit.link.kind !== 'share') return res.status(404).type('text').send('Not found');
  const share = await loadShare(hit.link.target_id);
  if (!share) return res.status(404).type('text').send('Not found');
  const access = checkShareAccess(req, share);
  const page = linkPath(hit.link.prefix, hit.link.slug, hit.fileSlug ?? undefined);
  // Browsers get redirected to a page; curl, ShareX and unfurlers get a plain status.
  const browser = (req.get('accept') || '').includes('text/html');
  if (!access.ok) {
    if (access.reason === 'login') {
      return browser ? res.redirect(`/login?next=${encodeURIComponent(page)}`) : res.status(401).type('text').send('Authentication required');
    }
    if (access.reason === 'locked') {
      return browser ? res.redirect(page) : res.status(401).type('text').send('Password required');
    }
    return res.status(access.reason === 'notfound' ? 404 : 410).type('text').send(access.reason === 'notfound' ? 'Not found' : 'Gone');
  }
  if (share.kind === 'url' && share.target_url) return res.redirect(302, share.target_url);

  const files = await db<FileRow>('files').where({ share_id: share.id }).orderBy('created_at');
  if (hit.fileSlug) {
    const file = files.find((f) => f.slug === hit.fileSlug);
    if (!file) return res.status(404).type('text').send('Not found');
    if (req.query.thumb !== undefined) return sendThumb(res, file);
    return streamFile(req, res, share, file);
  }
  if (files.length === 1) {
    if (req.query.thumb !== undefined) return sendThumb(res, files[0]);
    return streamFile(req, res, share, files[0]);
  }
  return streamZip(req, res, share, files);
}

function sendThumb(res: Response, file: FileRow) {
  if (!file.has_thumb) return res.status(404).end();
  res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600' });
  fs.createReadStream(thumbPath(file.id)).on('error', () => res.status(404).end()).pipe(res);
}

// ── SPA shell with OpenGraph ───────────────────────────────────────────────

/** Same policy as the client nginx applies to index.html. */
const SPA_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; object-src 'none'";

let shell: { html: string; at: number } | null = null;

async function indexHtml(): Promise<string | null> {
  if (shell && Date.now() - shell.at < 30_000) return shell.html;
  try {
    const res = await fetch(`${config.clientInternalUrl}/index.html`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    shell = { html: await res.text(), at: Date.now() };
    return shell.html;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'cannot fetch index.html from client container');
    return shell?.html ?? null;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

async function ogTags(req: Request, segs: string[]): Promise<string> {
  const branding = await getSetting('branding');
  const hit = await resolveSegments(segs);
  if (!hit || hit.link.kind !== 'share') return '';
  const share = await loadShare(hit.link.target_id);
  // Only public, password-less, live shares leak metadata to unfurlers.
  if (!share || share.visibility !== 'public' || share.password_hash || !checkShareAccess(req, share).ok) return '';
  const files = await db<FileRow>('files').where({ share_id: share.id }).orderBy('created_at');
  const file = hit.fileSlug ? files.find((f) => f.slug === hit.fileSlug) : files.length === 1 ? files[0] : null;
  const title = file?.name || share.title || `${files.length} fichiers`;
  const desc = `${files.length > 1 && !file ? `${files.length} fichiers · ` : ''}${formatBytes(Number(file?.size ?? share.total_size))} — ${branding.name}`;
  const raw = absoluteUrl(req, `/raw${linkPath(hit.link.prefix, hit.link.slug, hit.fileSlug ?? undefined)}`);
  const tags = [
    `<meta property="og:site_name" content="${esc(branding.name)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(absoluteUrl(req, req.path))}">`,
    `<meta name="theme-color" content="${esc(branding.accent)}">`,
  ];
  if (file && /^image\//.test(file.mime) && INLINE_SAFE.test(file.mime)) {
    tags.push(`<meta property="og:image" content="${esc(raw)}?preview">`, '<meta name="twitter:card" content="summary_large_image">');
  } else if (file && /^video\//.test(file.mime) && INLINE_SAFE.test(file.mime)) {
    tags.push(`<meta property="og:type" content="video.other">`, `<meta property="og:video" content="${esc(raw)}?preview">`, `<meta property="og:video:type" content="${esc(file.mime)}">`);
  }
  return tags.join('\n    ');
}

serveRouter.get(/^\/raw\/(.+)$/, ah(async (req, res) => {
  await serveRaw(req, res, pathSegments(req.params[0]));
}));

serveRouter.get('*', ah(async (req, res) => {
  const segs = pathSegments(req.path);
  const wantsHtml = (req.get('accept') || '').includes('text/html');
  if (!wantsHtml && segs.length) return serveRaw(req, res, segs);
  const html = await indexHtml();
  if (!html) return res.status(502).type('text').send('Client unavailable');
  const og = segs.length ? await ogTags(req, segs) : '';
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Security-Policy': SPA_CSP, 'X-Content-Type-Options': 'nosniff' })
    .send(og ? html.replace('</head>', `    ${og}\n  </head>`) : html);
}));
