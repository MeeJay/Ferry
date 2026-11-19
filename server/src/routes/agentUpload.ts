import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { Router, type Request, type Response } from 'express';
import mime from 'mime-types';
import { db } from '../db/knex.js';
import { logger } from '../logger.js';
import { assertCapacity, HttpError, ingestFile, type ShareRow } from '../services/shares.js';
import { effectiveLimits, getUser } from '../services/users.js';
import { findByFileToken, finishAgentUpload, partPath, receivedBytes, shareLinks, windowClosed } from '../services/agentUploads.js';
import { audit } from '../services/audit.js';
import { ah } from '../utils/http.js';

// Bytes of the files an AI agent announced through MCP (services/agentUploads.ts).
//
//   PUT {base}/api/agent-upload/{file token}    the whole file:  curl -T file URL
//       with Content-Range: bytes a-b/total     one piece, appended at a (resumable)
//   GET {base}/api/agent-upload/{file token}    → { offset, size, done }
//
// The token belongs to ONE announced file (services/agentUploads.ts): it is the
// only credential, works until the upload window closes, and is refused once
// that file is complete. Pieces
// must follow each other (a = bytes already received); a piece already stored
// is acknowledged again, so a retry after a lost answer is harmless. The file
// is stored once complete; the last file of the share publishes it and the
// answer carries its links.

export const agentUploadRouter = Router();

const busy = new Set<string>();

async function target(req: Request): Promise<{ share: ShareRow; index: number }> {
  const hit = await findByFileToken(req.params.token);
  if (!hit) throw new HttpError(404, 'Unknown upload URL, or the upload is finished or was renewed');
  if (windowClosed(hit.share)) throw new HttpError(410, 'The upload window is closed: ask the agent for new URLs (get_upload with renew_urls)');
  return hit;
}

function parseRange(h: string | undefined): { start: number; end: number; total: number } | null {
  if (!h) return null;
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(h.trim());
  if (!m) throw new HttpError(400, 'Content-Range: expected "bytes start-end/total"');
  const [start, end, total] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (start > end || end >= total) throw new HttpError(400, 'Content-Range out of bounds');
  return { start, end, total };
}

agentUploadRouter.get('/:token', ah(async (req, res) => {
  const { share, index } = await target(req);
  const f = share.upload_plan![index];
  res.json({ name: f.name, size: f.size, offset: f.done ? f.size : await receivedBytes(share, index), done: f.done });
}));

agentUploadRouter.put('/:token', ah(async (req, res) => {
  const { share, index } = await target(req);
  const plan = share.upload_plan![index];
  if (plan.done) {
    req.resume();
    return res.status(409).json({ error: `${plan.name} is already stored`, done: true });
  }
  const lock = `${share.id}:${index}`;
  if (busy.has(lock)) {
    req.resume();
    throw new HttpError(409, `${plan.name} is already being sent by another request`);
  }
  busy.add(lock);
  try {
    await receive(req, res, share, index);
  } finally {
    busy.delete(lock);
  }
}));

async function receive(req: Request, res: Response, share: ShareRow, index: number) {
  const plan = share.upload_plan![index];
  const range = parseRange(req.get('content-range'));
  const length = req.get('content-length') !== undefined ? Number(req.get('content-length')) : null;
  const total = range?.total ?? plan.size ?? length;
  if (total === null || !Number.isSafeInteger(total)) throw new HttpError(411, 'Unknown size: send Content-Length (curl -T does) or announce the size');
  if (plan.size !== null && total !== plan.size) throw new HttpError(400, `${plan.name}: ${plan.size} bytes announced, ${total} sent`);
  if (total === 0 && range) throw new HttpError(400, 'An empty file is sent without Content-Range');

  const start = range?.start ?? 0;
  const expected = range ? range.end - range.start + 1 : total;
  if (length !== null && length !== expected) throw new HttpError(400, `Content-Length ${length} does not match the ${expected} bytes expected`);
  const have = range ? await receivedBytes(share, index) : 0;
  if (range && range.end < have) {
    // Already stored (a retry after a lost answer).
    req.resume();
    return res.json({ name: plan.name, offset: have, size: total, done: false });
  }
  if (range && start !== have) {
    req.resume();
    return res.status(409).json({ error: `${plan.name}: next piece must start at byte ${have}`, offset: have, size: total });
  }
  if (start === 0) {
    const owner = await getUser(share.owner_id);
    if (!owner || owner.disabled) throw new HttpError(403, 'Account disabled');
    assertCapacity(await effectiveLimits(owner), Number(share.total_size), total, total);
  }

  let written = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      written += chunk.length;
      if (written > expected) return cb(new HttpError(400, 'More bytes than announced'));
      cb(null, chunk);
    },
  });
  const file = partPath(share.id, index);
  try {
    await pipeline(req, counter, fs.createWriteStream(file, { flags: start === 0 ? 'w' : 'a' }));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    logger.warn({ err: (err as Error).message, share: share.id, index }, 'agent upload interrupted');
    throw new HttpError(400, `Transfer interrupted after ${written} bytes: ask for the offset and resume`);
  }
  const offset = start + written;
  if (written !== expected) {
    return res.status(400).json({ error: `Incomplete: ${written}/${expected} bytes received`, offset, size: total });
  }
  if (offset < total) return res.json({ name: plan.name, offset, size: total, done: false });

  // Complete: store it, tick it in the plan, publish when it was the last one.
  const type = mime.lookup(plan.name) || 'application/octet-stream';
  await ingestFile(share, file, plan.name, type, total);
  const [row] = await db<ShareRow>('shares').where({ id: share.id })
    .update({ upload_plan: db.raw(`jsonb_set(upload_plan, ?, 'true')`, [`{${index},done}`]) as any })
    .returning('*');
  const remaining = row.upload_plan!.filter((f) => !f.done).map((f) => f.name);
  if (remaining.length) return res.json({ name: plan.name, size: total, done: true, remaining });

  const ready = await finishAgentUpload(row);
  const owner = await getUser(ready.owner_id);
  audit(req, 'share.created', ready.id, { files: ready.file_count, size: Number(ready.total_size), visibility: ready.visibility, source: 'mcp' }, owner?.id);
  res.json({ name: plan.name, size: total, done: true, remaining: [], share: await shareLinks(req, ready) });
}
