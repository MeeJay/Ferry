import { create } from 'zustand';

export type Theme = 'light' | 'dark';

/** Dark is Ferry's signature theme: default unless the visitor chose light. */
function initialTheme(): Theme {
  try {
    return localStorage.getItem('ferry.theme') === 'light' ? 'light' : 'dark';
  } catch { return 'dark'; }
}

export const useTheme = create<{ theme: Theme; toggle: () => void }>((set, get) => ({
  theme: initialTheme(),
  toggle() {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem('ferry.theme', theme); } catch { /* private mode */ }
    set({ theme });
  },
}));

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255)) as [number, number, number];
}

/**
 * Sets the branding accent, a companion hue for gradients (−22° on the color
 * wheel: blue → sky, violet → indigo, orange → amber…) and a readable foreground.
 */
export function applyAccent(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  const [h, s, l] = rgbToHsl(r, g, b);
  const [r2, g2, b2] = hslToRgb((h + 338) % 360, Math.min(1, s * 1.05), Math.min(0.6, Math.max(0.48, l)));
  const lum = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  const root = document.documentElement.style;
  root.setProperty('--accent', `${r} ${g} ${b}`);
  root.setProperty('--accent-2', `${r2} ${g2} ${b2}`);
  root.setProperty('--accent-ink', L > 0.5 ? '23 19 48' : '255 255 255');
}
