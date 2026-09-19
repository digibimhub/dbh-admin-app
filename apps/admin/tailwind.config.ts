import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    /**
     * The type ladder, measured off the Autodesk Account portal
     * (`docs/design/autodesk-portal-reference.md`). Replaced outright rather
     * than extended: the default names are gone, so a stray `text-lg` renders
     * at browser default — a loud failure instead of a silent one.
     *
     *   micro    12/16  footer, mono ids
     *   label    12/18  form labels
     *   meta     14/21  secondary text, breadcrumbs, table strips
     *   small    14/20  small buttons, nav tabs, link buttons
     *   body     16/24  body copy, table cells
     *   control  16/20  buttons, inputs, table headers, in-page tabs
     *   dialog   20/26  dialog titles
     *   title    21/26  section headings
     *   page     28/34  list-page H1
     *   record   34/41  record-page H1
     *   kpi      36/40  KPI numerals
     */
    fontSize: {
      micro: ['12px', '16px'],
      label: ['12px', '18px'],
      meta: ['14px', '21px'],
      small: ['14px', '20px'],
      body: ['16px', '24px'],
      control: ['16px', '20px'],
      dialog: ['20px', '26px'],
      title: ['21px', '26px'],
      page: ['28px', '34px'],
      record: ['34px', '41px'],
      kpi: ['36px', '40px'],
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
        link: 'rgb(var(--link) / <alpha-value>)',
        focus: 'rgb(var(--focus) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        'info-soft': 'rgb(var(--info-soft) / <alpha-value>)',
        allow: 'rgb(var(--allow) / <alpha-value>)',
        'allow-soft': 'rgb(var(--allow-soft) / <alpha-value>)',
        deny: 'rgb(var(--deny) / <alpha-value>)',
        'deny-soft': 'rgb(var(--deny-soft) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        'warn-soft': 'rgb(var(--warn-soft) / <alpha-value>)',
        tooltip: 'rgb(var(--tooltip) / <alpha-value>)',
        nav: 'rgb(var(--nav) / <alpha-value>)',
        'nav-active': 'rgb(var(--nav-active) / <alpha-value>)',
        /** Alias of `link` for one release while the old name is swept out. */
        signal: 'rgb(var(--link) / <alpha-value>)',
        'signal-soft': 'rgb(var(--info-soft) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Segoe UI', 'system-ui', 'sans-serif'],
        /**
         * Mono keeps its job (hashes, IDs, slugs, keys) but has no webfont:
         * Consolas is on every Windows box, which is where this is read.
         */
        mono: ['Consolas', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      /** Two radii: 4 on controls and dialogs, 8 on cards. */
      borderRadius: {
        sm: '4px',
        md: '8px',
      },
      /** One shadow, on the one thing that floats: dialogs and menus. Cards are bordered. */
      boxShadow: {
        pop: '0 16px 48px rgba(0, 0, 0, 0.25)',
      },
    },
  },
  corePlugins: {
    /**
     * `card` is a colour token, so Tailwind would also emit a `shadow-card`
     * *colour* utility. Nothing here ever colours a shadow, so the whole
     * plugin goes rather than renaming the scale.
     */
    boxShadowColor: false,
  },
  plugins: [],
} satisfies Config;
