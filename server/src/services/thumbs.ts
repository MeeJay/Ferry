import path from 'node:path';
import fsp from 'node:fs/promises';
import sharp from 'sharp';
import { config } from '../config.js';
import { logger } from '../logger.js';

const THUMBABLE = /^image\/(png|jpe?g|gif|webp|avif|tiff|bmp)$/;

export const thumbPath = (fileId: string) => path.join(config.dirs.thumbs, `${fileId}.webp`);

/** Builds a 480px WebP thumbnail from the local temp file. Thumbnails always stay on local disk. */
export async function makeThumb(fileId: string, localPath: string, mime: string): Promise<boolean> {
  if (!THUMBABLE.test(mime)) return false;
  try {
    await sharp(localPath, { animated: false, limitInputPixels: 100_000_000 })
      .rotate()
      .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(thumbPath(fileId));
    return true;
  } catch (err: any) {
    logger.debug({ err: err.message, fileId }, 'thumbnail failed');
    return false;
  }
}

export async function deleteThumb(fileId: string) {
  await fsp.rm(thumbPath(fileId), { force: true });
}
