import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { logger } from '../logger.js';
import { purgeShare, type ShareRow } from './shares.js';
import { cleanupTus } from '../routes/upload.js';

/**
 * Periodic housekeeping:
 *  - expired / exhausted shares → bytes deleted, row kept for the admin history
 *  - pending shares older than 24h (abandoned uploads) → removed entirely
 *  - link rows of shares purged > 30 days ago → freed for reuse
 *  - stale tus chunks and multer temp files
 */
export async function runCleanup() {
  const expired = await db<ShareRow>('shares')
    .where({ status: 'ready' })
    .where((w) => w.where('expires_at', '<=', db.fn.now())
      .orWhere((x) => x.whereNotNull('max_downloads').whereRaw('download_count >= max_downloads')));
  for (const s of expired) await purgeShare(s, 'expired');

  const abandoned = await db<ShareRow>('shares').where({ status: 'pending' }).where('created_at', '<', db.raw("now() - interval '24 hours'"));
  for (const s of abandoned) {
    await purgeShare(s, 'deleted');
    await db('shares').where({ id: s.id }).delete();
  }

  await db('links').where({ kind: 'share' })
    .whereIn('target_id', db('shares').whereIn('status', ['expired', 'deleted']).where('purged_at', '<', db.raw("now() - interval '30 days'")).select('id'))
    .delete();

  await cleanupTus();
  const cutoff = Date.now() - 24 * 3600_000;
  for (const f of await fsp.readdir(config.dirs.tmp).catch(() => [] as string[])) {
    const p = path.join(config.dirs.tmp, f);
    const st = await fsp.stat(p).catch(() => null);
    if (st && st.mtimeMs < cutoff) await fsp.rm(p, { force: true, recursive: true });
  }
  if (expired.length || abandoned.length) logger.info({ expired: expired.length, abandoned: abandoned.length }, 'cleanup done');
}

export function startCleanupLoop() {
  const tick = () => runCleanup().catch((err) => logger.error({ err }, 'cleanup failed'));
  setTimeout(tick, 10_000);
  setInterval(tick, 5 * 60_000).unref();
}
