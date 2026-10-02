import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { StorageSettings } from '@ferry/shared';
import { config } from '../config.js';
import { getSetting } from './settings.js';

export type DriverName = 'local' | 's3';
export interface ByteRange { start: number; end: number }

export interface StorageDriver {
  name: DriverName;
  /** Moves (local) or uploads (s3) a finished temp file into storage. The temp file is consumed. */
  put(key: string, localPath: string, mime: string): Promise<void>;
  get(key: string, range?: ByteRange): Promise<Readable>;
  delete(key: string): Promise<void>;
}

const local: StorageDriver = {
  name: 'local',
  async put(key, localPath) {
    const dest = path.join(config.dirs.files, key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fsp.rename(localPath, dest);
    } catch (err: any) {
      if (err.code !== 'EXDEV') throw err;
      await fsp.copyFile(localPath, dest);
      await fsp.rm(localPath, { force: true });
    }
  },
  async get(key, range) {
    return fs.createReadStream(path.join(config.dirs.files, key), range ? { start: range.start, end: range.end } : undefined);
  },
  async delete(key) {
    await fsp.rm(path.join(config.dirs.files, key), { force: true });
  },
};

let s3Cache: { sig: string; client: S3Client } | null = null;

function s3Client(s: StorageSettings['s3']): S3Client {
  const sig = JSON.stringify(s);
  if (s3Cache?.sig === sig) return s3Cache.client;
  const client = new S3Client({
    region: s.region || 'us-east-1',
    endpoint: s.endpoint || undefined,
    forcePathStyle: s.forcePathStyle,
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
  });
  s3Cache = { sig, client };
  return client;
}

function s3Driver(s: StorageSettings['s3']): StorageDriver {
  const client = s3Client(s);
  const objectKey = (key: string) => (s.prefix ? `${s.prefix.replace(/\/+$/, '')}/${key}` : key);
  return {
    name: 's3',
    async put(key, localPath, mime) {
      await new Upload({
        client,
        params: { Bucket: s.bucket, Key: objectKey(key), Body: fs.createReadStream(localPath), ContentType: mime },
        queueSize: 4,
        partSize: 16 * 1024 * 1024,
      }).done();
      await fsp.rm(localPath, { force: true });
    },
    async get(key, range) {
      const out = await client.send(new GetObjectCommand({
        Bucket: s.bucket,
        Key: objectKey(key),
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }));
      return out.Body as Readable;
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: s.bucket, Key: objectKey(key) }));
    },
  };
}

/** Driver used for new uploads (admin setting). */
export async function activeDriver(): Promise<StorageDriver> {
  const s = await getSetting('storage');
  return s.driver === 's3' ? s3Driver(s.s3) : local;
}

/** Driver a stored file was written with — old files stay readable after a switch. */
export async function driverFor(name: string): Promise<StorageDriver> {
  if (name === 's3') return s3Driver((await getSetting('storage')).s3);
  return local;
}

export async function testS3(s: StorageSettings['s3']): Promise<void> {
  const client = new S3Client({
    region: s.region || 'us-east-1',
    endpoint: s.endpoint || undefined,
    forcePathStyle: s.forcePathStyle,
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
  });
  await client.send(new HeadBucketCommand({ Bucket: s.bucket }));
}

export async function ensureDirs() {
  for (const d of Object.values(config.dirs)) await fsp.mkdir(d, { recursive: true });
}
