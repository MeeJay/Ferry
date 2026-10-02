import path from 'node:path';
import fsp from 'node:fs/promises';
import { Server as TusServer } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { MB } from '@ferry/shared';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { logger } from '../logger.js';
import { assertCapacity, HttpError, ingestFile, type ShareRow } from '../services/shares.js';
import { effectiveLimits, getUser } from '../services/users.js';

// Resumable uploads (tus 1.0). Every upload carries the `token` of a pending
// share in its metadata: that is the only credential, so the same endpoint
// serves logged-in users and anonymous uploaders of a reverse share.

function reject(status: number, message: string): never {
  throw { status_code: status, body: JSON.stringify({ error: message }) };
}

async function pendingShare(token: string | null | undefined): Promise<ShareRow> {
  if (!token) reject(401, 'Jeton d’upload manquant');
  const share = await db<ShareRow>('shares').where({ upload_token: token, status: 'pending' }).first();
  if (!share) reject(403, 'Jeton d’upload invalide ou expiré');
  return share;
}

export const tus = new TusServer({
  path: '/api/upload',
  relativeLocation: true,
  datastore: new FileStore({ directory: config.dirs.tus, expirationPeriodInMilliseconds: 24 * 3600_000 }),

  async onUploadCreate(_req, upload) {
    const share = await pendingShare(upload.metadata?.token);
    if (upload.size === undefined) reject(400, 'Taille de fichier requise');
    if (!upload.metadata?.filename) reject(400, 'Nom de fichier requis');
    const owner = await getUser(share.owner_id);
    if (!owner || owner.disabled) reject(403, 'Compte indisponible');

    try {
      assertCapacity(await effectiveLimits(owner), Number(share.total_size), upload.size, upload.size);
    } catch (err) {
      if (err instanceof HttpError) reject(err.status, err.message);
      throw err;
    }
    if (share.request_id) {
      const r = await db('requests').where({ id: share.request_id }).first();
      if (r?.max_size_mb && Number(share.total_size) + upload.size > r.max_size_mb * MB) reject(413, 'Taille maximale du dépôt dépassée');
      if (r?.max_files && share.file_count >= r.max_files) reject(413, 'Nombre maximal de fichiers atteint');
    }
    if (share.expected_files && share.file_count >= share.expected_files) reject(400, 'Nombre de fichiers annoncé dépassé');
    return { metadata: { ...upload.metadata, shareId: share.id } };
  },

  async onUploadFinish(_req, upload) {
    const share = await pendingShare(upload.metadata?.token);
    const tmp = path.join(config.dirs.tus, upload.id);
    const name = String(upload.metadata?.filename || 'file');
    const mime = String(upload.metadata?.filetype || 'application/octet-stream');
    try {
      const file = await ingestFile(share, tmp, name, mime, upload.size ?? upload.offset);
      return { headers: { 'X-Ferry-File': file.id } };
    } catch (err: any) {
      logger.error({ err: err.message, share: share.id }, 'ingest failed');
      reject(err instanceof HttpError ? err.status : 500, err instanceof HttpError ? err.message : 'Échec de l’enregistrement');
    } finally {
      await fsp.rm(`${tmp}.json`, { force: true });
    }
  },
});

export async function cleanupTus() {
  try {
    const n = await tus.cleanUpExpiredUploads();
    if (n) logger.info({ n }, 'expired tus uploads removed');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'tus cleanup failed');
  }
}
