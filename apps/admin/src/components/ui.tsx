'use client';

import type {
  ButtonHTMLAttributes, FormEvent, InputHTMLAttributes, ReactNode,
  SelectHTMLAttributes, TextareaHTMLAttributes,
} from 'react';
import { formatAbsolute, formatRelative } from '@/lib/format';

/* ---------------------------------------------------------------- headings */

export function PageHeader({ eyebrow, title, lede, actions }: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        {eyebrow && (
          <p className="text-micro tracking-[0.12em] uppercase text-signal font-medium mb-1.5">{eyebrow}</p>
        )}
        <h2 className="font-semibold text-page leading-tight tracking-tight">{title}</h2>
        {lede && <p className="text-body text-ink-2 max-w-[72ch] mt-1.5">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 items-center pt-1">{actions}</div>}
    </div>
  );
}

export function Section({ title, note, actions, children, className = '' }: {
  title?: string;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-card border border-rule rounded-md p-4 sm:p-6 shadow-card [&_section]:shadow-none [&_.shadow-card]:shadow-none ${className}`}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            {title && <h3 className="font-semibold text-title">{title}</h3>}
            {note && <p className="text-meta text-ink-3 mt-0.5 max-w-[70ch]">{note}</p>}
          </div>
          {actions && <div className="flex gap-2 items-center shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* ----------------------------------------------------------------- buttons */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-card border border-ink hover:bg-ink-2',
  secondary: 'bg-card text-ink border border-rule hover:bg-paper hover:border-ink-3',
  ghost: 'bg-transparent text-ink-2 border border-rule hover:bg-paper hover:text-ink',
  danger: 'bg-transparent text-deny border border-deny hover:bg-deny-soft',
};

export function Button({ variant = 'secondary', className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`font-semibold text-body px-3.5 py-1.5 rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}

/* ------------------------------------------------------------------ inputs */

const FIELD = 'w-full border border-rule rounded-sm px-3 py-1.5 text-body bg-card focus:outline-none focus:border-signal focus:ring-2 focus:ring-signal/20';

export function Field({ label, hint, children, className = '' }: {
  label: string; hint?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-micro uppercase tracking-[0.1em] text-ink-3 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-meta text-ink-3 mt-1">{hint}</span>}
    </label>
  );
}

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`${FIELD} ${className}`} />;
}

/* -------------------------------------------------------------- form grid */

/**
 * One grid for reading and for editing.
 *
 * Read mode used to be a two-column `DefList` and edit mode a two-column form,
 * and the two disagreed about where a label sits — so pressing Edit reflowed
 * the whole card and the eye lost its place. Both now render into this grid:
 * a fixed label column, then the value or the input on one shared left edge.
 * Pressing Edit swaps controls and moves nothing.
 */
export function FormGrid({ children, className = '', onSubmit }: {
  children: ReactNode;
  className?: string;
  /** Supply it and the grid is a `<form>`; omit it and the grid is read mode. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const GRID = `grid grid-cols-1 sm:grid-cols-[168px_minmax(0,1fr)] items-start ${className}`;
  if (onSubmit) return <form onSubmit={onSubmit} className={GRID}>{children}</form>;
  return <div className={GRID}>{children}</div>;
}

/**
 * One row. `label` is the column; `children` is the value or the control.
 *
 * `width` is not decoration: a field sized to its content is how the form
 * reads as deliberate. A two-letter country code in a half-card-wide box is
 * the thing that actually looks broken.
 */
const WIDTHS = {
  full: 'w-full',
  name: 'w-full max-w-[340px]',
  email: 'w-full max-w-[280px]',
  short: 'w-full max-w-[110px]',
  tiny: 'w-full max-w-[88px]',
} as const;

export type FieldWidth = keyof typeof WIDTHS;

export function Row({ label, hint, htmlFor, width = 'full', children }: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  width?: FieldWidth;
  children: ReactNode;
}) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <>
      <Label
        {...(htmlFor ? { htmlFor } : {})}
        className="text-micro uppercase tracking-[0.1em] text-ink-3 pt-[15px] pb-1 sm:py-[15px] sm:pr-4
                   border-t border-rule sm:border-t [&:first-of-type]:border-t-0"
      >
        {label}
      </Label>
      <div className="min-h-[38px] flex flex-wrap items-center gap-x-2 gap-y-1 py-2 sm:border-t sm:border-rule">
        <div className={WIDTHS[width]}>{children}</div>
        {hint && <p className="basis-full text-meta text-ink-3 m-0">{hint}</p>}
      </div>
    </>
  );
}

/**
 * Actions on the card's bottom edge, right-aligned, primary last.
 *
 * They used to float wherever the grid happened to end, which on a form with
 * an odd number of fields put Save in the middle of the card.
 */
export function FormBar({ children }: { children: ReactNode }) {
  return (
    <div className="sm:col-span-2 flex flex-wrap justify-end gap-2 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 mt-4
                    px-4 sm:px-6 py-3 border-t border-rule bg-paper rounded-b-md">
      {children}
    </div>
  );
}

export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`${FIELD} ${className}`} />;
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={`${FIELD} ${className}`}>{children}</select>;
}

export function Toggle({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 text-micro uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors disabled:opacity-50 ${
        checked ? 'bg-allow-soft border-allow text-allow' : 'bg-paper-2 border-rule text-ink-2'
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${checked ? 'bg-allow' : 'bg-ink-3'}`} />
      {checked ? 'on' : 'off'}
    </button>
  );
}

/* ------------------------------------------------------------------- pills */

export type PillTone = 'neutral' | 'signal' | 'allow' | 'deny' | 'warn';

const TONES: Record<PillTone, string> = {
  neutral: 'bg-paper-2 text-ink-2 border-rule',
  signal: 'bg-signal-soft text-signal border-signal/40',
  allow: 'bg-allow-soft text-allow border-allow/40',
  deny: 'bg-deny-soft text-deny border-deny/40',
  warn: 'bg-warn-soft text-warn border-warn/40',
};

export function Pill({ tone = 'neutral', children, title }: {
  tone?: PillTone; children: ReactNode; title?: string;
}) {
  return (
    <span title={title} className={`inline-block text-micro uppercase tracking-[0.08em] px-1.5 py-[2px] rounded-sm border ${TONES[tone]}`}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, PillTone> = {
  active: 'allow',
  trial: 'signal',
  pending: 'warn',
  stale: 'warn',
  suspended: 'deny',
  disabled: 'deny',
  expired: 'deny',
  cancelled: 'deny',
  churned: 'neutral',
  rejected: 'deny',
  approved: 'allow',
};

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={STATUS_TONE[status] ?? 'neutral'}>{status}</Pill>;
}

/* -------------------------------------------------------------------- time */

/** Relative by default, absolute on hover — the spec's rule for timestamps. */
export function TimeAgo({ value, className = '' }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className={`text-ink-3 ${className}`}>never</span>;
  return (
    <time
      dateTime={value}
      title={formatAbsolute(value)}
      suppressHydrationWarning
      className={`cursor-help decoration-dotted underline-offset-2 hover:underline ${className}`}
    >
      {formatRelative(value)}
    </time>
  );
}

/* ------------------------------------------------------------------ states */

export function EmptyState({ title, children, action }: {
  title: string; children: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="border border-dashed border-rule bg-paper-2 rounded-md px-6 py-10 text-center">
      <p className="font-semibold text-title text-ink-2">{title}</p>
      <p className="text-body text-ink-3 max-w-[56ch] mx-auto mt-1.5">{children}</p>
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="bg-deny-soft text-deny text-body border border-deny/30 px-3 py-2 rounded-sm mb-3">
      {children}
    </p>
  );
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <p className="text-ink-3 text-body py-6">{what}…</p>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-meta text-ink-3 mt-2 max-w-[80ch]">{children}</p>;
}

/** Key/value grid used on every detail screen. */
export function DefList({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-micro uppercase tracking-[0.1em] text-ink-3">{label}</dt>
          <dd className="text-body mt-0.5 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
