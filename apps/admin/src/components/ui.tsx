'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type {
  ButtonHTMLAttributes, FormEvent, InputHTMLAttributes, KeyboardEvent, ReactNode,
  SelectHTMLAttributes, TextareaHTMLAttributes,
} from 'react';
import { formatAbsolute, formatRelative } from '@/lib/format';
import type { MemberStatus, PendingReason } from '@/lib/types';

/* ---------------------------------------------------------------- headings */

/** `Organisations / Acme Engineering` — 14 px grey above a record title. */
export function Breadcrumb({ items, className = '' }: {
  items: { label: string; href?: string }[];
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={`text-meta text-ink-3 mb-4 ${className}`}>
      <ol className="flex flex-wrap items-center">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center">
            {i > 0 && <span aria-hidden className="mx-1.5">/</span>}
            {item.href
              ? <Link href={item.href} className="hover:text-link hover:underline">{item.label}</Link>
              : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The top of every screen. `list` is a 28/700 title with actions on its
 * baseline; `record` adds a 48 px avatar, a 34/800 title and a grey sub-line.
 */
export function PageHeader({ title, breadcrumb, lede, actions, avatar, subline, variant = 'list' }: {
  title: string;
  breadcrumb?: { label: string; href?: string }[];
  lede?: ReactNode;
  actions?: ReactNode;
  avatar?: ReactNode;
  subline?: ReactNode;
  variant?: 'list' | 'record';
}) {
  const record = variant === 'record';
  return (
    <div className="mb-6">
      {breadcrumb && <Breadcrumb items={breadcrumb} />}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className={`min-w-0 ${record ? 'flex items-center gap-4' : ''}`}>
          {record && avatar}
          <div className="min-w-0">
            <h1 className={`text-ink ${record ? 'text-record font-extrabold' : 'text-page font-bold'} [text-wrap:balance]`}>
              {title}
            </h1>
            {subline && <p className="text-meta text-ink-3 mt-0.5">{subline}</p>}
            {lede && <p className="text-body text-ink-2 max-w-[65ch] mt-2">{lede}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap gap-3 items-center">{actions}</div>}
      </div>
    </div>
  );
}

/** A bordered card. No shadow: the only shadow in the product is on dialogs. */
export function Section({ title, note, actions, children, className = '' }: {
  title?: string;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-card border border-rule rounded-md p-6 ${className}`}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            {title && <h2 className="text-title font-bold text-ink">{title}</h2>}
            {note && <p className="text-meta text-ink-3 mt-1 max-w-[70ch]">{note}</p>}
          </div>
          {actions && <div className="flex gap-3 items-center shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* ----------------------------------------------------------------- avatar */

export function initialsOf(name?: string | null, email?: string | null): string {
  const n = name?.trim();
  if (n) {
    const parts = n.split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '')).toUpperCase();
  }
  return (email ?? '?').slice(0, 2).toUpperCase();
}

/** Two-letter initials on a disc. Light on cards, dark in the header. */
export function Avatar({ name, email, size = 40, dark = false, className = '' }: {
  name?: string | null;
  email?: string | null;
  size?: 24 | 40 | 44 | 48;
  dark?: boolean;
  className?: string;
}) {
  const text = size === 24 ? 'text-[10px]' : size === 48 ? 'text-[17px]' : size === 44 ? 'text-[15px]' : 'text-small';
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`inline-grid place-items-center rounded-full font-bold shrink-0 ${text} ${
        dark ? 'bg-nav-active text-card' : 'bg-paper-2 text-ink'
      } ${className}`}
    >
      {initialsOf(name, email)}
    </span>
  );
}

/* --------------------------------------------------------------- KPI strip */

export type KpiItem = {
  label: string;
  value: ReactNode;
  /** Render the value at 16/600 instead of 36/700 — for words and dates. */
  small?: boolean;
  /** The 12 px italic helper line under the value. */
  help?: ReactNode;
  /** A bottom-anchored ⊕ link. */
  link?: { href: string; label: string };
  /** Bold the value: something to act on. */
  attention?: boolean;
};

/**
 * One white panel split by hairlines, as a `<dl>` — the e2e suite reads the
 * first `dl` on an organisation page as its stat strip.
 */
export function KpiStrip({ items, className = '' }: { items: KpiItem[]; className?: string }) {
  return (
    <dl className={`grid grid-cols-2 md:grid-cols-3 xl:grid-flow-col xl:auto-cols-fr gap-px bg-rule border border-rule rounded-md overflow-hidden mb-6 ${className}`}>
      {items.map((item) => (
        <div key={item.label} className="bg-card px-6 py-5 flex flex-col gap-1 min-h-[148px]">
          <dt className="text-meta text-ink-3">{item.label}</dt>
          <dd className={`tabular-nums text-ink ${
            item.small ? 'text-body font-semibold pt-2' : 'text-kpi font-bold'
          } ${item.attention ? 'font-extrabold' : ''}`}
          >
            {item.value}
          </dd>
          {item.help && <p className="text-label italic text-ink-3">{item.help}</p>}
          {item.link && (
            <div className="mt-auto pt-2">
              <GoLink href={item.link.href}>{item.link.label}</GoLink>
            </div>
          )}
        </div>
      ))}
    </dl>
  );
}

/* ----------------------------------------------------------------- buttons */

type Variant = 'primary' | 'secondary' | 'ghost' | 'link';
type Size = 'md' | 'sm';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-card border border-ink font-bold hover:bg-nav-active',
  secondary: 'bg-card text-ink border border-ink font-semibold hover:bg-paper-2',
  ghost: 'bg-transparent text-ink border border-transparent font-semibold hover:bg-paper-2',
  link: 'bg-transparent text-ink border-0 font-semibold hover:text-link',
};

const SIZES: Record<Size, string> = {
  md: 'h-10 px-5 text-control',
  sm: 'h-8 px-3 text-small',
};

/** The circled-arrow motif every "go here" link carries. */
function GoIcon() {
  return (
    <span aria-hidden className="inline-grid place-items-center w-4 h-4 rounded-full border-[1.5px] border-current shrink-0">
      <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </span>
  );
}

function buttonClass(variant: Variant, size: Size, className: string): string {
  const metrics = variant === 'link' ? 'h-auto px-0 py-1 text-small' : SIZES[size];
  const ghostPad = variant === 'ghost' ? (size === 'sm' ? '!px-2' : '!px-3') : '';
  return `inline-flex items-center justify-center gap-2 rounded-sm whitespace-nowrap transition-colors
    disabled:opacity-40 disabled:pointer-events-none ${metrics} ${ghostPad} ${VARIANTS[variant]} ${className}`;
}

export function Button({ variant = 'secondary', size = 'md', icon, className = '', children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: 'go' }) {
  return (
    <button type="button" {...rest} className={buttonClass(variant, size, className)}>
      {icon === 'go' && <GoIcon />}
      {children}
    </button>
  );
}

/** A navigation that looks like a button. A button inside a link is not valid HTML. */
export function ButtonLink({ href, variant = 'secondary', size = 'md', className = '', children }: {
  href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode;
}) {
  return <Link href={href} className={buttonClass(variant, size, className)}>{children}</Link>;
}

/** A link with the ⊕ motif, at the link-button metrics. */
export function GoLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2 text-small font-semibold text-ink hover:text-link py-1 ${className}`}>
      <GoIcon />
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ inputs */

const FIELD = 'w-full h-10 border border-rule rounded-sm px-3 text-control bg-card text-ink focus:outline-none focus:border-focus focus:ring-2 focus:ring-focus/20';

/** Label above the control, 12/18. */
export function Field({ label, hint, children, className = '' }: {
  label: string; hint?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-label text-ink-2 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-meta text-ink-3 mt-1">{hint}</span>}
    </label>
  );
}

const FIELD_ROW_COLS = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' } as const;

/**
 * `Field`s side by side.
 *
 * The panels form aligned its row with `items-end`, so the hint under Slug
 * pushed Label and Description down by the height of a hint that was not
 * theirs. Fields flow from the top here: the labels line up, the controls line
 * up, and a hint hangs below its own field without moving anything.
 */
export function FieldRow({ cols = 2, className = '', children }: {
  cols?: keyof typeof FIELD_ROW_COLS;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`grid grid-cols-1 ${FIELD_ROW_COLS[cols]} gap-4 items-start ${className}`}>
      {children}
    </div>
  );
}

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`${FIELD} ${className}`} />;
}

/**
 * The search box at the left of a table's toolbar. Enter submits; the value
 * lands in the URL through the caller's `useUrlState`.
 */
export function SearchInput({ onSearch, className = '', ...rest }:
  Omit<InputHTMLAttributes<HTMLInputElement>, 'onKeyDown' | 'type'> & { onSearch: (value: string) => void }) {
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') onSearch((e.target as HTMLInputElement).value);
  }
  return (
    <span className={`relative block w-full sm:w-[360px] max-w-full ${className}`}>
      <svg aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
      </svg>
      <input type="search" {...rest} onKeyDown={onKeyDown} className={`${FIELD} pl-9`} />
    </span>
  );
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
export function FormGrid({ children, className = '', onSubmit, id }: {
  children: ReactNode;
  className?: string;
  /** Supply it and the grid is a `<form>`; omit it and the grid is read mode. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  id?: string;
}) {
  const GRID = `grid grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)] items-start ${className}`;
  if (onSubmit) return <form id={id} onSubmit={onSubmit} className={GRID}>{children}</form>;
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
  email: 'w-full max-w-[300px]',
  short: 'w-full max-w-[140px]',
  tiny: 'w-full max-w-[96px]',
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
        className="text-meta font-bold text-ink pt-4 pb-1 sm:py-[18px] sm:pr-4
                   border-t border-rule sm:border-t [&:first-of-type]:border-t-0"
      >
        {label}
      </Label>
      <div className="min-h-[56px] flex flex-wrap items-center gap-x-2 gap-y-1 py-2 sm:py-3 sm:border-t sm:border-rule text-body text-ink">
        <div className={WIDTHS[width]}>{children}</div>
        {hint && <p className="basis-full text-meta text-ink-3 m-0 max-w-[60ch]">{hint}</p>}
      </div>
    </>
  );
}

/**
 * Actions on the card's bottom edge, right-aligned, primary last.
 */
export function FormBar({ children }: { children: ReactNode }) {
  return (
    <div className="sm:col-span-2 flex flex-wrap justify-end gap-3 -mx-6 -mb-6 mt-4 px-6 py-4 border-t border-rule bg-paper-2 rounded-b-md">
      {children}
    </div>
  );
}

export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`${FIELD} !h-auto min-h-[72px] py-2 resize-y ${className}`} />;
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={`${FIELD} pr-8 ${className}`}>{children}</select>;
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
      className={`inline-flex items-center gap-2 h-8 text-small font-semibold px-3 rounded-sm border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
        checked ? 'bg-ink border-ink text-card' : 'bg-card border-rule text-ink-3'
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${checked ? 'bg-allow' : 'bg-ink-3'}`} />
      {checked ? 'On' : 'Off'}
    </button>
  );
}

/**
 * Two or three exclusive options, 32 px, as a radiogroup. The selected
 * segment is black; the others are transparent.
 */
export function SegmentedControl<V extends string>({ value, options, onChange, label, disabled }: {
  value: V;
  options: { value: V; label: string }[];
  onChange: (next: V) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex h-8 border border-ink rounded-sm overflow-hidden ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => { if (!on) onChange(o.value); }}
            className={`px-4 text-small font-semibold transition-colors ${on ? 'bg-ink text-card' : 'bg-transparent text-ink-3 hover:text-ink'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- pills */

export type PillTone = 'neutral' | 'count';

/** Two pills only: a neutral tag and a count. Meaning is carried by text, not colour. */
export function Pill({ tone = 'neutral', children, title, className = '' }: {
  tone?: PillTone; children: ReactNode; title?: string; className?: string;
}) {
  if (tone === 'count') {
    return (
      <span title={title} className={`inline-block min-w-[20px] px-1.5 rounded-full bg-nav-active text-card text-micro leading-5 font-bold text-center tabular-nums ${className}`}>
        {children}
      </span>
    );
  }
  return (
    <span title={title} className={`inline-block text-label text-ink-2 px-1.5 py-px rounded-sm border border-rule bg-paper-2 ${className}`}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ status */

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  pending: 'No seat free',
  disabled: 'Disabled',
  rejected: 'Rejected',
  suspended: 'Suspended',
  expired: 'Expired',
  stale: 'Stale',
  trial: 'Trial',
  approved: 'Approved',
  cancelled: 'Cancelled',
  churned: 'Churned',
  awaiting_approval: 'Awaiting approval',
  seats_exhausted: 'No seat free',
  no_licence: 'No licence yet',
};

/** The words for a member's state, given the stored reason when it is pending. */
export function memberStatusLabel(status: MemberStatus | string, reason?: PendingReason | null): string {
  if (status === 'pending' && reason) return STATUS_LABEL[reason] ?? STATUS_LABEL.pending!;
  return STATUS_LABEL[status] ?? status;
}

/**
 * A status is plain grey text. `attention` makes it 600 black — for the
 * states somebody has to act on. Awaiting approval and No licence yet are
 * attention by default; No seat free is not, because it resolves itself.
 */
export function StatusText({ status, reason, attention, className = '' }: {
  status: MemberStatus | string;
  reason?: PendingReason | null;
  attention?: boolean;
  className?: string;
}) {
  const label = memberStatusLabel(status, reason);
  const attn = attention ?? (status === 'pending' && (reason === 'awaiting_approval' || reason === 'no_licence'));
  return (
    <span className={`${attn ? 'text-ink font-semibold' : 'text-ink-3'} ${className}`}>{label}</span>
  );
}

/* -------------------------------------------------------------------- time */

/** Relative by default, absolute on hover — the spec's rule for timestamps. */
export function TimeAgo({ value, className = '' }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className={`text-ink-3 ${className}`}>Never</span>;
  return (
    <time
      dateTime={value}
      title={formatAbsolute(value)}
      suppressHydrationWarning
      className={`decoration-dotted underline-offset-2 hover:underline ${className}`}
    >
      {formatRelative(value)}
    </time>
  );
}

/* ------------------------------------------------------------------ states */

/** A sentence and, when the operator can create the first row, a button. No box. */
export function EmptyState({ title, children, action }: {
  title: string; children: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="px-4 py-9 max-w-[65ch]">
      <p className="text-body font-semibold text-ink">{title}</p>
      <p className="text-body text-ink-2 mt-1">{children}</p>
      {action && <div className="mt-4 flex gap-3">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex gap-3 items-start bg-deny-soft text-ink-2 text-body border border-deny px-4 py-3 mb-4">
      <span aria-hidden className="shrink-0 mt-0.5 w-5 h-5 rounded-full border-[1.5px] border-deny text-deny grid place-items-center text-micro font-bold">!</span>
      <span>{children}</span>
    </p>
  );
}

/** Square-cornered, info-blue hairline on a 10 % tint. The reference's one banner. */
export function InfoBanner({ children, action, onDismiss, className = '' }: {
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div role="status" className={`flex gap-3 items-start bg-info-soft border border-info text-ink-2 text-body px-4 py-3 mb-6 ${className}`}>
      <span aria-hidden className="shrink-0 mt-0.5 w-5 h-5 rounded-full border-[1.5px] border-current grid place-items-center text-micro font-bold">i</span>
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0 self-center">{action}</div>}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-[18px] leading-none px-1 hover:text-ink">×</button>
      )}
    </div>
  );
}

/** A grey block in the shape of what is coming. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`block rounded-sm bg-paper-2 animate-pulse ${className}`} />;
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="px-4 py-5 space-y-5" aria-hidden>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-6 items-center">
          <Skeleton className="w-10 h-10 !rounded-full" />
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={`h-4 ${c === 0 ? 'w-[26%]' : 'w-[14%]'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Keeps its signature; renders a skeleton with the text for screen readers. */
export function Loading({ what = 'Loading' }: { what?: string }) {
  return (
    <div role="status" className="py-6 space-y-4">
      <span className="sr-only">{what}…</span>
      <Skeleton className="h-8 w-[40%]" />
      <Skeleton className="h-4 w-[70%]" />
      <Skeleton className="h-4 w-[55%]" />
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-meta text-ink-3 mt-3 max-w-[80ch]">{children}</p>;
}

/** Key/value rows: 14/700 label column, hairline between rows. */
export function DefList({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)]">
      {items.map(([label, value], i) => (
        <div key={label} className="contents">
          <dt className={`text-meta font-bold text-ink pt-4 sm:py-[18px] ${i > 0 ? 'border-t border-rule' : ''}`}>{label}</dt>
          <dd className={`text-body text-ink pb-4 sm:py-4 break-words ${i > 0 ? 'sm:border-t sm:border-rule' : ''}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------- more menu */

/**
 * The `···` overflow button and its menu, for the one or two actions that do
 * not earn a button of their own. Closes on outside click and Escape.
 */
export function MoreMenu({ label = 'More actions', items, size = 'md', align = 'right' }: {
  label?: string;
  items: { label: string; onSelect: () => void; disabled?: boolean }[];
  size?: 'md' | 'sm';
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <span ref={root} className="relative inline-block">
      <Button
        variant="ghost"
        size={size}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ···
      </Button>
      {open && (
        <span
          role="menu"
          className={`absolute top-full mt-1 z-20 min-w-[200px] bg-card border border-rule rounded-sm p-2 shadow-pop ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onSelect(); }}
              className="block w-full text-left text-small text-ink px-2 py-1.5 rounded-sm hover:bg-paper-2 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap"
            >
              {item.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
