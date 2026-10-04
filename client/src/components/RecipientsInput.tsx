import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** E-mail addresses as chips: Enter, comma, space or paste to add; Backspace removes the last one. */
export function RecipientsInput({ value, onChange, placeholder = 'nom@exemple.fr' }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  function commit(raw: string) {
    const parts = raw.split(/[\s,;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
    const good = parts.filter((p) => EMAIL.test(p));
    setInvalid(parts.length > good.length);
    if (good.length) onChange([...new Set([...value, ...good])].slice(0, 50));
    setDraft(parts.filter((p) => !EMAIL.test(p)).join(' '));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (['Enter', ',', ';', ' ', 'Tab'].includes(e.key) && draft.trim()) {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className={`flex min-h-9 flex-wrap items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1.5 transition focus-within:bg-surface-3 focus-within:ring-2 ${invalid ? 'focus-within:ring-danger/60' : 'focus-within:ring-accent/50'}`}>
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded bg-grad-soft px-1.5 py-0.5 text-xs font-semibold">
          {v}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="text-ink-3 hover:text-danger" aria-label={`Retirer ${v}`}><X className="size-3" /></button>
        </span>
      ))}
      <input
        type="email"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
        onKeyDown={onKey}
        onBlur={() => draft.trim() && commit(draft)}
        onPaste={(e) => { e.preventDefault(); commit(draft + ' ' + e.clipboardData.getData('text')); }}
        placeholder={value.length ? '' : placeholder}
        className="min-w-[140px] flex-1 bg-transparent px-1 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
      />
    </div>
  );
}
