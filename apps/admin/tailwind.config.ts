import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    /**
     * Six steps, replacing 17 arbitrary `text-[Npx]` sizes. Replaced outright
     * rather than extended: the default names are gone, so a stray `text-lg`
     * renders at browser default — a loud failure instead of a silent one.
     */
    fontSize: {
      micro: ['11px', '16px'],
      meta: ['12px', '18px'],
      body: ['14px', '22px'],
      title: ['16px', '22px'],
      page: ['24px', '30px'],
      kpi: ['30px', '32px'],
    },
    extend: {
      /**
       * Channel triplets, defined in `globals.css`. The `<alpha-value>`
       * placeholder is load-bearing: without it Tailwind emits `rgb(var(--x))`
       * and every opacity modifier (`bg-ink/30`, `border-deny/40`, …) is
       * silently dropped — no build error, no warning, just flat colour.
       */
      colors: {
        paper: 'rgb(var(--paper) / <alpha-value>)',
        'paper-2': 'rgb(var(--paper-2) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)',
        'ink-3': 'rgb(var(--ink-3) / <alpha-value>)',
        rule: 'rgb(var(--rule) / <alpha-value>)',
        signal: 'rgb(var(--signal) / <alpha-value>)',
        'signal-soft': 'rgb(var(--signal-soft) / <alpha-value>)',
        allow: 'rgb(var(--allow) / <alpha-value>)',
        'allow-soft': 'rgb(var(--allow-soft) / <alpha-value>)',
        deny: 'rgb(var(--deny) / <alpha-value>)',
        'deny-soft': 'rgb(var(--deny-soft) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        'warn-soft': 'rgb(var(--warn-soft) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        /**
         * Mono keeps its job (hashes, IDs, slugs, keys) but loses its webfont:
         * Consolas is on every Windows box, which is where this is read.
         */
        mono: ['Consolas', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
      },
      /** Two only: `card` on surfaces, `pop` on things that float above them. */
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.07)',
        pop: '0 10px 15px -3px rgb(15 23 42 / 0.12), 0 4px 6px -4px rgb(15 23 42 / 0.10)',
      },
    },
  },
  corePlugins: {
    /**
     * `card` is a colour token, so Tailwind would also emit a `shadow-card`
     * *colour* utility — and, being generated later, it wins and repaints the
     * card shadow white. Nothing here ever colours a shadow, so the whole
     * plugin goes rather than renaming the scale.
     */
    boxShadowColor: false,
  },
  plugins: [],
} satisfies Config;
