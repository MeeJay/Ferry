import clsx from 'clsx';
import { FileArchive, FileAudio, FileCode, FileImage, FileText, FileVideo, File as FileIcon, Link2 } from 'lucide-react';

export function iconFor(mime: string, name = '') {
  if (mime.startsWith('image/')) return FileImage;
  if (mime.startsWith('video/')) return FileVideo;
  if (mime.startsWith('audio/')) return FileAudio;
  if (/zip|tar|rar|7z|gzip|compressed/.test(mime) || /\.(zip|rar|7z|tar|gz)$/i.test(name)) return FileArchive;
  if (/json|javascript|xml|x-sh|typescript|x-python/.test(mime) || /\.(js|ts|py|sh|json|yml|yaml|go|rs|c|cpp|cs|java|php|rb|sql)$/i.test(name)) return FileCode;
  if (mime.startsWith('text/') || /pdf|word|document|sheet|presentation/.test(mime)) return FileText;
  return FileIcon;
}

export function extOf(name: string) {
  const m = /\.([a-z0-9]{1,6})$/i.exec(name);
  return m ? m[1].toUpperCase() : '';
}

export function FileThumb({ mime, name, thumb, className, kind }: { mime: string; name: string; thumb?: string | null; className?: string; kind?: 'url' }) {
  if (thumb) {
    return <img src={thumb} alt="" loading="lazy" className={clsx('object-cover bg-surface-2', className)} />;
  }
  const Icon = kind === 'url' ? Link2 : iconFor(mime, name);
  const ext = kind === 'url' ? 'URL' : extOf(name);
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-1 bg-surface-2 text-ink-2', className)}>
      <Icon className="size-[40%] max-h-10 max-w-10" strokeWidth={1.75} />
      {ext && <span className="text-[10px] font-bold tracking-widest text-ink-3">{ext}</span>}
    </div>
  );
}
