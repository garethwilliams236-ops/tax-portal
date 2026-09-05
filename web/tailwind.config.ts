import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', panel: 'var(--panel)', panel2: 'var(--panel2)',
        ink: 'var(--ink)', muted: 'var(--muted)', line: 'var(--line)',
        accent: 'var(--accent)',
        ok: 'var(--ok)', warn: 'var(--warn)', crit: 'var(--crit)', info: 'var(--info)',
      },
      fontFamily: { sans: ['ui-sans-serif', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
