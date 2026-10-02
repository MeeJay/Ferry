import { create } from 'zustand';

export type Theme = 'light' | 'dark';

function systemTheme(): Theme {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function stored(): Theme | null {
  try {
    const t = localStorage.getItem('ferry.theme');
    return t === 'light' || t === 'dark' ? t : null;
  } catch { return null; }
}

export const useTheme = create<{ theme: Theme; toggle: () => void }>((set, get) => ({
  theme: stored() ?? systemTheme(),
  toggle() {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem('ferry.theme', theme); } catch { /* private mode */ }
    set({ theme });
  },
}));

/** Sets the branding accent + a readable foreground (black or white) for it. */
export function applyAccent(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  const lum = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  const root = document.documentElement.style;
  root.setProperty('--accent', `${r} ${g} ${b}`);
  root.setProperty('--accent-ink', L > 0.4 ? '12 12 12' : '255 255 255');
}
