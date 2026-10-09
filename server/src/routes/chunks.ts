import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { MB } from '@ferry/shared';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { logger } from '../logger.js';
import { assertCapacity, HttpError, ingestFile, trackIngest, type ShareRow } from '../services/shares.js';
import { effectiveLimits, getUser } from '../services/users.js';
import { ah } from '../utils/http.js';

// Parallel chunked uploads (web UI and drop pages).
//
// The target file is pre-sized at session start; every chunk is written in
// place at index × chunkSize, so chunks may arrive in any order and several at
// once — no reassembly step and no second copy on disk. Each chunk is a plain
// PUT (no JSON body parser): retried on its own by the client, and small enough
// to stay under any reverse-proxy body limit.
//
//   POST /api/chunks                 { filename, filetype, size }   → { id, chunkSize, count }
//   PUT  /api/chunks/:id/:index      raw bytes of chunk #index
//   GET  /api/chunks/:id             → { received: number[] }        (resume)
//   POST /api/chunks/:id/complete    → 202, file stored in the background
// Credential: the share's upload token in the X-Upload-Token header.

interface Session {
  id: string;
  shareId: string;
  token: string;
  name: string;
  mime: string;
  size: number;
  chunkSize: number;
  count: number;
  received: number[];
  createdAt: number;
}

const sessions = new Map<string, Session>();
const dataPath = (id: string) => path.join(config.dirs.tus, `${id}.chunks`);
const metaPath = (id: string) => path.join(config.dirs.tus, `${id}.chunks.json`);

async function persist(s: Session) {
  await fsp.writeFile(metaPath(s.id), JSON.stringify(s));
}

/** In memory, or reloaded from disk after a server restart. */
async function getSession(id: string): Promise<Session | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const cached = sessions.get(id);
  if (cached) return cached;
  try {
    const s = JSON.parse(await fsp.readFile(metaPath(id), 'utf8')) as Session;
    sessions.set(id, s);
    return s;
  } catch { return null; }
}

async function authorize(req: Request, id: string): Promise<{ session: Session; share: ShareRow }> {
  const session = await getSession(id);
  const token = req.get('x-upload-token');
  if (!session || !token || token !== session.token) throw new HttpError(404, 'Session d’envoi introuvable');
  const share = await db<ShareRow>('shares').where({ id: session.shareId, upload_token: token, status: 'pending' }).first();
  if (!share) throw new HttpError(410, 'Le partage n’accepte plus d’envois');
  return { session, share };
}

/** Bytes announced by sessions of a share that are not stored yet. */
function inFlight(shareId: string): number {
  let n = 0;
  for (const s of sessions.values()) if (s.shareId === shareId) n += s.size;
  return n;
}

// Only the session creation carries JSON (parsed per route): chunk PUTs keep the raw stream.
export const chunksRouter = Router();

chunksRouter.post('/', express.json({ limit: '16kb' }), ah(async (req, res) => {
  const b = z.object({
    filename: z.string().min(1).max(255),
    filetype: z.string().max(200).optional(),
    size: z.number().int().min(0),
  }).parse(req.body);
  const token = req.get('x-upload-token');
  const share = token ? await db<ShareRow>('shares').where({ upload_token: token, status: 'pending' }).first() : null;
  if (!share) throw new HttpError(403, 'Jeton d’envoi invalide ou expiré');
  const owner = await getUser(share.owner_id);
  if (!owner || owner.disabled) throw new HttpError(403, 'Compte indisponible');

  assertCapacity(await effectiveLimits(owner), Number(share.total_size) + inFlight(share.id), b.size, b.size);
  if (share.request_id) {
    const r = await db('requests').where({ id: share.request_id }).first();
    if (r?.max_size_mb && Number(share.total_size) + inFlight(share.id) + b.size > r.max_size_mb * MB) throw new HttpError(413, 'Taille maximale du dépôt dépassée');
  }
  const open = [...sessions.values()].filter((s) => s.shareId === share.id).length;
  if (share.expected_files && share.file_count + open >= share.expected_files) throw new HttpError(400, 'Nombre de fichiers annoncé dépassé');

  const chunkSize = req.app.get('chunkSize') as number;
  const session: Session = {
    id: crypto.randomUUID(), shareId: share.id, token: token!, name: b.filename,
    mime: b.filetype || 'application/octet-stream', size: b.size, chunkSize,
    count: Math.ceil(b.size / chunkSize), received: [], createdAt: Date.now(),
  };
  // Pre-size the file: chunks are then written in place, in any order.
  const fh = await fsp.open(dataPath(session.id), 'w');
  await fh.truncate(b.size);
  await fh.close();
  sessions.set(session.id, session);
  await persist(session);
  res.status(201).json({ id: session.id, chunkSize, count: session.count });
}));

chunksRouter.get('/:id', ah(async (req, res) => {
  const { session } = await authorize(req, req.params.id);
  res.json({ received: session.received, count: session.count, chunkSize: session.chunkSize });
}));

chunksRouter.put('/:id/:index', ah(async (req, res) => {
  const { session } = await authorize(req, req.params.id);
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= session.count) throw new HttpError(400, 'Index de fragment invalide');
  const start = index * session.chunkSize;
  const expected = Math.min(session.chunkSize, session.size - start);
  const declared = Number(req.get('content-length'));
  if (!Number.isFinite(declared) || declared !== expected) throw new HttpError(400, `Fragment ${index} : ${expected} octets attendus`);

  let written = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      written += chunk.length;
      if (written > expected) return cb(new HttpError(400, 'Fragment trop long'));
      cb(null, chunk);
    },
  });
  await pipeline(req, counter, fs.createWriteStream(dataPath(session.id), { flags: 'r+', start }));
  if (written !== expected) throw new HttpError(400, `Fragment ${index} incomplet (${written}/${expected} octets)`);

  if (!session.received.includes(index)) {
    session.received.push(index);
    await persist(session);
  }
  res.json({ received: session.received.length, count: session.count });
}));

chunksRouter.post('/:id/complete', ah(async (req, res) => {
  const { session, share } = await authorize(req, req.params.id);
  if (session.received.length !== session.count) {
    throw new HttpError(409, `Fragments manquants : ${session.count - session.received.length}`);
  }
  sessions.delete(session.id);
  await fsp.rm(metaPath(session.id), { force: true });
  // Stored in the background; finalizeShare() waits for it.
  const job = ingestFile(share, dataPath(session.id), session.name, session.mime, session.size)
    .then(() => undefined)
    .catch((err) => {
      logger.error({ err: err.message, share: share.id, file: session.name }, 'ingest failed');
      throw err;
    });
  trackIngest(share.id, job, session.name);
  res.status(202).json({ ok: true });
}));

/** Removes chunk sessions abandoned for more than 24 h (and their pre-sized files). */
export async function cleanupChunkSessions() {
  const cutoff = Date.now() - 24 * 3600_000;
  for (const f of await fsp.readdir(config.dirs.tus).catch(() => [] as string[])) {
    if (!f.endsWith('.chunks.json') && !f.endsWith('.chunks')) continue;
    const p = path.join(config.dirs.tus, f);
    const st = await fsp.stat(p).catch(() => null);
    if (st && st.mtimeMs < cutoff) {
      await fsp.rm(p, { force: true });
      sessions.delete(f.replace(/\.chunks(\.json)?$/, ''));
    }
  }
}

