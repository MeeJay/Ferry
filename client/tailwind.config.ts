import type { Config } from 'tailwindcss';

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: { DEFAULT: v('surface'), 2: v('surface-2'), 3: v('surface-3') },
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3') },
        line: { DEFAULT: v('line'), soft: v('line-soft') },
        accent: { DEFAULT: v('accent'), 2: v('accent-2'), ink: v('accent-ink') },
        warm: { 1: v('warm-1'), 2: v('warm-2') },
        danger: v('danger'),
        success: v('success'),
        warn: v('warn'),
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
        display: ['"Inter Tight Variable"', '"Inter Variable"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      borderWidth: { 3: '3px' },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'pop': { '0%': { transform: 'scale(.96)', opacity: '0' }, '100%': { transform: 'none', opacity: '1' } },
        // A finished chunk drops into the overall progress bar below it.
        'chunk-land': {
          '0%': { transform: 'translateY(0) scaleX(1)', opacity: '1' },
          '60%': { transform: 'translateY(16px) scaleX(.85)', opacity: '1' },
          '100%': { transform: 'translateY(24px) scaleX(.4)', opacity: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 220ms cubic-bezier(.2,.8,.2,1) both',
        pop: 'pop 160ms cubic-bezier(.2,.8,.2,1) both',
        'chunk-land': 'chunk-land 520ms cubic-bezier(.5,0,.75,0) forwards',
      },
    },
  },
  plugins: [],
} satisfies Config;
