import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Check, Copy, Loader2, Lock, X } from 'lucide-react';
import toast from 'react-hot-toast';

// ── Button ─────────────────────────────────────────────────────────────────

type Variant = 'accent' | 'ink' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const variants: Record<Variant, string> = {
  accent: 'bg-grad text-white glow hover:brightness-110',
  ink: 'bg-surface-2 text-ink hover:bg-surface-3',
  outline: 'bg-surface-2 text-ink hover:bg-surface-3',
  ghost: 'bg-transparent text-ink hover:bg-ink/5',
  danger: 'bg-danger text-white hover:brightness-110',
};
const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  lg: 'h-9 px-4 text-[13px] gap-2 rounded-md',
  xl: 'h-11 px-6 text-[15px] gap-2 rounded-md',
};

const buttonBase = 'inline-flex items-center justify-center font-semibold whitespace-nowrap select-none transition-[background,filter,transform] duration-150 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none';

export const buttonClasses = (variant: Variant = 'outline', size: Size = 'md', className?: string) =>
  clsx(buttonBase, variants[variant], sizes[size], className);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', loading, icon, className, children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={clsx('inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:text-ink hover:bg-ink/5 transition disabled:opacity-40', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Form controls ──────────────────────────────────────────────────────────

const control = 'w-full bg-surface-2 rounded-md px-3 text-[13px] text-ink placeholder:text-ink-3 transition hover:bg-surface-3 focus:bg-surface-3 focus:ring-2 focus:ring-accent/50 focus:outline-none disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(control, 'h-9', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(control, 'py-2.5 min-h-[88px] resize-y', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(control, 'h-9 pr-9 appearance-none bg-no-repeat bg-[right_0.75rem_center] bg-[length:16px]', className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, locked, children, className }: { label: ReactNode; hint?: ReactNode; locked?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-ink">
        {label}
        {locked && <LockTag />}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, disabled, label, description }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: ReactNode; description?: ReactNode;
}) {
  const sw = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50',
        checked ? 'bg-grad' : 'bg-surface-3',
      )}
    >
      <span className={clsx('inline-block size-[18px] rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-[23px]' : 'translate-x-[3px]')} />
    </button>
  );
  if (!label) return sw;
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-semibold">{label}</div>
        {description && <div className="text-xs text-ink-3 mt-0.5">{description}</div>}
      </div>
      {sw}
    </div>
  );
}

export function Segmented<T extends string | number>({ value, onChange, options, disabled, size = 'md' }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; disabled?: boolean; size?: 'sm' | 'md';
}) {
  return (
    <div className={clsx('inline-flex flex-wrap gap-0.5 rounded-md bg-surface-2 p-0.5', disabled && 'opacity-50 pointer-events-none')}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded font-semibold transition',
            size === 'sm' ? 'px-2 h-6 text-[11px]' : 'px-3 h-7 text-xs',
            value === o.value ? 'bg-grad text-white' : 'text-ink-2 hover:text-ink hover:bg-surface-3',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Display ────────────────────────────────────────────────────────────────

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'warn' | 'ink'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2',
    accent: 'bg-grad text-white',
    success: 'bg-success/15 text-success',
    danger: 'bg-danger/15 text-danger',
    warn: 'bg-warn/20 text-ink',
    ink: 'bg-ink text-bg',
  };
  return <span className={clsx('inline-flex items-center gap-1 rounded px-1.5 h-5 text-[10px] font-bold uppercase tracking-wider', tones[tone], className)}>{children}</span>;
}

export function LockTag({ text = 'Imposé' }: { text?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-ink/[.06] px-1.5 h-5 text-[10px] font-bold uppercase tracking-wider text-ink-3" title="Option verrouillée par l’administrateur">
      <Lock className="size-3" /> {text}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-5 animate-spin text-ink-3', className)} />;
}

export function PageLoader() {
  return <div className="flex justify-center py-24"><Spinner className="size-7" /></div>;
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={clsx('h-2 w-full overflow-hidden rounded-full bg-surface-2', className)}>
      <div className="h-full rounded-full bg-grad glow transition-[width] duration-200" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card-soft border-dashed flex flex-col items-center text-center px-5 py-12">
      <div className="mb-4 flex size-14 items-center justify-center rounded-lg bg-grad-soft text-accent">{icon}</div>
      <div className="font-display text-base font-bold">{title}</div>
      {children && <div className="mt-1.5 max-w-sm text-sm text-ink-3">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export async function copyText(text: string, message = 'Lien copié') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast.success(message);
}

export function CopyLink({ url, size = 'md', className }: { url: string; size?: 'md' | 'lg'; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (done) { const t = setTimeout(() => setDone(false), 1500); return () => clearTimeout(t); } }, [done]);
  return (
    <div className={clsx('flex items-stretch rounded-md bg-surface-2 overflow-hidden', className)}>
      <div className={clsx('flex-1 min-w-0 truncate font-mono flex items-center', size === 'lg' ? 'px-4 text-base h-11' : 'px-3 text-[13px] h-10')} title={url}>
        {url.replace(/^https?:\/\//, '')}
      </div>
      <button
        onClick={() => { copyText(url); setDone(true); }}
        className={clsx('flex items-center gap-2 bg-grad text-white font-semibold transition hover:brightness-110', size === 'lg' ? 'px-5' : 'px-3 text-sm')}
      >
        {done ? <Check className="size-4" /> : <Copy className="size-4" />}
        {size === 'lg' && (done ? 'Copié' : 'Copier')}
      </button>
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-5">
      <div className="absolute inset-0 bg-[#07051a]/70 backdrop-blur-sm animate-[fade-up_150ms_ease-out]" onClick={onClose} />
      <div className={clsx('relative w-full card !bg-surface rounded-b-none sm:rounded-lg animate-pop max-h-[92vh] flex flex-col', width)}>
        <div className="flex items-center justify-between gap-4 px-5 pt-5 pb-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <IconButton label="Fermer" onClick={onClose}><X className="size-5" /></IconButton>
        </div>
        <div className="px-5 pb-6 overflow-y-auto scroll-thin">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({ open, onClose, onConfirm, title, children, confirmLabel = 'Supprimer', loading }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; children: ReactNode; confirmLabel?: string; loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="danger" loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <div className="text-sm text-ink-2">{children}</div>
    </Modal>
  );
}

export function SectionTitle({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold leading-[0.95]">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
