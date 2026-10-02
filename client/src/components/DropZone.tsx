import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ArrowUp } from 'lucide-react';

/** Big drop target; also catches files dropped anywhere on the window. */
export function DropZone({ onFiles, children, compact, className }: {
  onFiles: (files: File[]) => void; children?: ReactNode; compact?: boolean; className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const enter = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { depth.current++; setOver(true); } };
    const leave = () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); };
    const prevent = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) onFiles(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', drop);
    };
  }, [onFiles]);

  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={clsx(
          'group relative w-full rounded-[28px] border-[3px] border-dashed transition-colors text-left',
          over ? 'border-accent bg-accent/10' : 'border-line hover:border-accent hover:bg-accent/[.04]',
          compact ? 'px-6 py-6' : 'px-6 py-16 sm:py-24',
          className,
        )}
      >
        {children ?? (
          <div className="flex flex-col items-center text-center">
            <span className={clsx('flex items-center justify-center rounded-[30%] bg-accent text-accent-ink transition-transform group-hover:-translate-y-1', compact ? 'size-12' : 'size-20')}>
              <ArrowUp className={compact ? 'size-6' : 'size-10'} strokeWidth={2.75} />
            </span>
            <span className={clsx('mt-6 font-display font-extrabold tracking-tight', compact ? 'text-xl' : 'text-3xl sm:text-4xl')}>
              Glissez vos fichiers ici
            </span>
            <span className="mt-2 text-ink-2">ou <span className="font-bold text-ink underline decoration-accent decoration-[3px] underline-offset-4">parcourez votre ordinateur</span></span>
          </div>
        )}
      </button>
      <input ref={input} type="file" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) onFiles(f); e.target.value = ''; }} />
      {over && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-accent/90 text-accent-ink animate-[fade-up_120ms_ease-out]">
          <div className="text-center">
            <ArrowUp className="mx-auto size-24" strokeWidth={2.5} />
            <div className="mt-4 font-display text-5xl font-extrabold">Lâchez pour ajouter</div>
          </div>
        </div>
      )}
    </>
  );
}
