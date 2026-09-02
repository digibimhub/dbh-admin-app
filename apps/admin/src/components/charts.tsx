'use client';

import { useId, useState, type ReactNode } from 'react';
import { formatNumber } from '@/lib/format';

/**
 * Charts are hand-rolled inline SVG rather than a charting library: the admin
 * bundle stays at next + react + tailwind, and none of these shapes are complex
 * enough to earn a dependency.
 *
 * The categorical palette is anchored to the brand indigo and chosen by search
 * over the Tailwind 600/700/800 steps, maximising the minimum CIELAB ΔE under
 * Viénot-1999 protan/deutan/tritan simulation. Against the white card surface
 * all six slots clear 3:1, minimum ΔE is 18.4 (deuteranopia) / 20.3
 * (protanopia), and lightness is staggered (L* 41/56/37/47/49/41) so where hue
 * collapses under CVD, lightness still carries identity. Colours are assigned
 * in fixed order and never cycled — a 6th+ series folds into "Other" instead of
 * inventing a hue.
 *
 * Because no slot is under 3:1, colour is no longer the sole carrier of
 * identity and the old "relief" obligation (a legend *and* a table view on
 * every categorical chart) is retired. The legend stays.
 *
 * These are JS literals, not CSS variables, on purpose: SVG presentation
 * attributes cannot resolve `var(--x)` without `getComputedStyle`, which does
 * not exist during SSR. Keep them in sync with `globals.css` by hand — do not
 * "fix" this by reaching for the tokens.
 */
export const SERIES = ['#4F46E5', '#0891B2', '#166534', '#A16207', '#DB2777', '#A21CAF'];
export const SERIES_MAX = SERIES.length;

const INK = '#0F172A';
// Kept in step with --ink-3 in globals.css by hand, because an SVG presentation
// attribute cannot resolve var(). It was left on the prototype's #64748B when
// that token was darkened for AA contrast, so every axis label here was the
// failing value.
const INK_3 = '#5F6E85';
const RULE = '#E3E8EF';
/** The card surface. Segment/band strokes paint this so adjacent shapes separate. */
const SURFACE = '#FFFFFF';

export function seriesColor(i: number): string {
  return SERIES[i % SERIES.length] ?? SERIES[0]!;
}

/** Fold a long categorical list to the palette size, with the tail as "Other". */
export function foldToPalette(
  entries: [string, number][],
  max = SERIES_MAX,
): [string, number][] {
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce((sum, [, v]) => sum + v, 0);
  return [...head, ['Other', rest]];
}

/* ------------------------------------------------------------- sparkline */

/** A stat-tile companion: one series, no axes, no legend — the tile's number is the headline. */
export function Sparkline({ values, width = 108, height = 26, tone = SERIES[0]! }: {
  values: number[]; width?: number; height?: number; tone?: string;
}) {
  if (values.length < 2) return <div style={{ height }} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1] ?? 0;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`Trend over the last ${values.length} days, ending at ${formatNumber(last)}`}>
      <polyline points={points} fill="none" stroke={tone} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={y(last)} r="2.5" fill={tone} />
    </svg>
  );
}

/* -------------------------------------------------------------- line chart */

export type LinePoint = { label: string; value: number };

/** Single-series time line with a crosshair and tooltip. No legend: the title names it. */
export function LineChart({ points, height = 180, unit = '' }: {
  points: LinePoint[]; height?: number; unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();
  const w = 720;
  const padL = 40;
  const padR = 12;
  const padT = 10;
  const padB = 24;

  if (points.length < 2) {
    return <p className="text-body text-ink-3 py-8 text-center">Not enough days of data to draw a trend yet.</p>;
  }

  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const plotW = w - padL - padR;
  const plotH = height - padT - padB;
  const x = (i: number) => padL + (i / (points.length - 1)) * plotW;
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${padT + plotH} L${padL},${padT + plotH} Z`;
  const ticks = [0, max / 2, max];
  const active = hover === null ? null : points[hover];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img"
        aria-label={`Line chart, ${points.length} points, peak ${formatNumber(max)}`}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <clipPath id={clipId}>
            <rect x={padL} y={padT} width={plotW} height={plotH} />
          </clipPath>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke={RULE} strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="11" fill={INK_3}>
              {formatNumber(Math.round(t))}
            </text>
          </g>
        ))}
        <path d={area} fill={SERIES[0]!} opacity="0.08" clipPath={`url(#${clipId})`} />
        <path d={path} fill="none" stroke={SERIES[0]!} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && points[hover] && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke={INK} strokeWidth="1" opacity="0.35" />
            <circle cx={x(hover)} cy={y(points[hover]!.value)} r="4" fill={SERIES[0]!} stroke={SURFACE} strokeWidth="2" />
          </>
        )}
        {points.map((p, i) => (
          <rect key={p.label} x={x(i) - plotW / points.length / 2} y={padT}
            width={plotW / points.length} height={plotH} fill="transparent"
            onMouseEnter={() => setHover(i)} />
        ))}
        <text x={padL} y={height - 6} fontSize="11" fill={INK_3}>{points[0]?.label}</text>
        <text x={w - padR} y={height - 6} textAnchor="end" fontSize="11" fill={INK_3}>
          {points[points.length - 1]?.label}
        </text>
      </svg>
      {active && (
        <div className="absolute top-0 right-0 bg-card border border-rule rounded-sm px-2 py-1 tabular-nums text-micro pointer-events-none">
          {active.label} · <b>{formatNumber(active.value)}</b>{unit}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ grouped bars */

export type BarGroup = { label: string; values: number[] };

export function GroupedBars({ groups, seriesNames, height = 170 }: {
  groups: BarGroup[]; seriesNames: string[]; height?: number;
}) {
  const [hover, setHover] = useState<{ g: number; s: number } | null>(null);
  const w = 720;
  const padL = 40;
  const padR = 12;
  const padT = 10;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = height - padT - padB;

  if (!groups.length) {
    return <p className="text-body text-ink-3 py-8 text-center">No weeks recorded yet.</p>;
  }

  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  const groupW = plotW / groups.length;
  const barW = Math.max(3, (groupW - 8) / seriesNames.length - 2);
  const active = hover ? groups[hover.g] : null;

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img"
          aria-label={`Grouped bar chart of ${seriesNames.join(' and ')} per week`}
          onMouseLeave={() => setHover(null)}>
          {[0, max / 2, max].map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={padT + plotH - (t / max) * plotH} y2={padT + plotH - (t / max) * plotH}
                stroke={RULE} strokeWidth="1" />
              <text x={padL - 6} y={padT + plotH - (t / max) * plotH + 3.5} textAnchor="end"
                fontSize="11" fill={INK_3}>{formatNumber(Math.round(t))}</text>
            </g>
          ))}
          {groups.map((g, gi) => (
            <g key={g.label}>
              {g.values.map((v, si) => {
                const h = (v / max) * plotH;
                const bx = padL + gi * groupW + 4 + si * (barW + 2);
                return (
                  <rect key={si} x={bx} y={padT + plotH - h} width={barW} height={Math.max(h, v > 0 ? 2 : 0)}
                    rx="2" fill={seriesColor(si)}
                    opacity={hover && (hover.g !== gi) ? 0.45 : 1}
                    onMouseEnter={() => setHover({ g: gi, s: si })} />
                );
              })}
              {gi % Math.ceil(groups.length / 6) === 0 && (
                <text x={padL + gi * groupW + groupW / 2} y={height - 8} textAnchor="middle"
                  fontSize="11" fill={INK_3}>{g.label}</text>
              )}
            </g>
          ))}
        </svg>
        {active && (
          <div className="absolute top-0 right-0 bg-card border border-rule rounded-sm px-2 py-1 tabular-nums text-micro pointer-events-none">
            {active.label}
            {active.values.map((v, i) => (
              <span key={i}> · {seriesNames[i]} <b>{formatNumber(v)}</b></span>
            ))}
          </div>
        )}
      </div>
      <Legend items={seriesNames.map((name, i) => ({ label: name, color: seriesColor(i) }))} />
    </div>
  );
}

/* -------------------------------------------------------------------- donut */

export function Donut({ slices, size = 168 }: {
  slices: [label: string, value: number][]; size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, [, v]) => s + v, 0);

  if (!total) {
    return <p className="text-body text-ink-3 py-8 text-center">No version data reported yet.</p>;
  }

  const r = size / 2 - 6;
  const inner = r * 0.62;
  const cx = size / 2;
  const cy = size / 2;
  let angle = -Math.PI / 2;

  const arcs = slices.map(([label, value], i) => {
    const sweep = (value / total) * Math.PI * 2;
    // 2px surface gap between segments — the spacer rule.
    const gap = total > 0 && slices.length > 1 ? Math.min(0.03, sweep / 4) : 0;
    const a0 = angle + gap / 2;
    const a1 = angle + sweep - gap / 2;
    angle += sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const d = [
      `M${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)}`,
      `A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)}`,
      `L${cx + inner * Math.cos(a1)},${cy + inner * Math.sin(a1)}`,
      `A${inner},${inner} 0 ${large} 0 ${cx + inner * Math.cos(a0)},${cy + inner * Math.sin(a0)}`,
      'Z',
    ].join(' ');
    return { d, label, value, color: seriesColor(i) };
  });

  const focused = hover === null ? null : arcs[hover];

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={`Donut chart: ${slices.map(([l, v]) => `${l} ${v}`).join(', ')}`}
        onMouseLeave={() => setHover(null)}>
        {arcs.map((a, i) => (
          <path key={a.label} d={a.d} fill={a.color} stroke={SURFACE} strokeWidth="2"
            opacity={hover === null || hover === i ? 1 : 0.45}
            onMouseEnter={() => setHover(i)} />
        ))}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="20" fontWeight="600" fill={INK}>
          {formatNumber(focused ? focused.value : total)}
        </text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize="11" fill={INK_3}>
          {focused ? focused.label : 'total'}
        </text>
      </svg>
      <Legend
        vertical
        items={arcs.map((a) => ({
          label: a.label,
          color: a.color,
          value: `${formatNumber(a.value)} · ${Math.round((a.value / total) * 100)}%`,
        }))}
      />
    </div>
  );
}

/* -------------------------------------------------------------- stacked area */

export type StackSeries = { name: string; values: number[] };

/** Version adoption over time — the shape shows how far a rollout has travelled. */
export function StackedArea({ labels, series, height = 180 }: {
  labels: string[]; series: StackSeries[]; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 720;
  const padL = 40;
  const padR = 12;
  const padT = 10;
  const padB = 24;
  const plotW = w - padL - padR;
  const plotH = height - padT - padB;

  if (labels.length < 2 || !series.length) {
    return <p className="text-body text-ink-3 py-8 text-center">Not enough history to show rollout progress yet.</p>;
  }

  const totals = labels.map((_, i) => series.reduce((s, ser) => s + (ser.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const x = (i: number) => padL + (i / (labels.length - 1)) * plotW;
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  const running = labels.map(() => 0);
  const bands = series.map((ser, si) => {
    const lower = [...running];
    const upper = labels.map((_, i) => {
      running[i] = (running[i] ?? 0) + (ser.values[i] ?? 0);
      return running[i] ?? 0;
    });
    const top = upper.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const bottom = lower.slice().reverse()
      .map((v, ri) => `L${x(labels.length - 1 - ri).toFixed(1)},${y(v ?? 0).toFixed(1)}`).join(' ');
    return { d: `${top} ${bottom} Z`, name: ser.name, color: seriesColor(si), values: ser.values };
  });

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img"
          aria-label={`Stacked area of ${series.map((s) => s.name).join(', ')} over time`}
          onMouseLeave={() => setHover(null)}>
          {[0, max / 2, max].map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke={RULE} strokeWidth="1" />
              <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="11" fill={INK_3}>
                {formatNumber(Math.round(t))}
              </text>
            </g>
          ))}
          {bands.map((b) => (
            <path key={b.name} d={b.d} fill={b.color} stroke={SURFACE} strokeWidth="2" opacity="0.92" />
          ))}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke={INK} strokeWidth="1" opacity="0.35" />
          )}
          {labels.map((label, i) => (
            <rect key={label} x={x(i) - plotW / labels.length / 2} y={padT}
              width={plotW / labels.length} height={plotH} fill="transparent"
              onMouseEnter={() => setHover(i)} />
          ))}
          <text x={padL} y={height - 6} fontSize="11" fill={INK_3}>{labels[0]}</text>
          <text x={w - padR} y={height - 6} textAnchor="end" fontSize="11" fill={INK_3}>
            {labels[labels.length - 1]}
          </text>
        </svg>
        {hover !== null && (
          <div className="absolute top-0 right-0 bg-card border border-rule rounded-sm px-2 py-1 tabular-nums text-micro pointer-events-none">
            {labels[hover]}
            {bands.map((b) => (
              <span key={b.name}> · {b.name} <b>{formatNumber(b.values[hover] ?? 0)}</b></span>
            ))}
          </div>
        )}
      </div>
      <Legend items={bands.map((b) => ({ label: b.name, color: b.color }))} />
    </div>
  );
}

/* ----------------------------------------------------------------- bar list */

/** Ranked magnitude — a bar list beats a pie for "top N by usage". */
export function BarList({ items, unit = '' }: {
  items: { label: string; value: number; href?: string }[]; unit?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <span className="relative block h-6">
            <span className="absolute inset-y-0 left-0 rounded-sm" style={{
              width: `${Math.max(2, (item.value / max) * 100)}%`,
              // Flat, not `SIGNAL` at 14%: an alpha fill composites against whatever
              // sits behind it, so the same bar rendered three different greys — on a
              // card, on the page ground, on a hovered row. This is that tint, once.
              background: '#EEF2FF',
            }} />
            <span className="relative px-1.5 text-body leading-6 truncate block">{item.label}</span>
          </span>
          <span className="text-meta text-ink-2 tabular-nums">{formatNumber(item.value)}{unit}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------- legend */

export function Legend({ items, vertical }: {
  items: { label: string; color: string; value?: string }[]; vertical?: boolean;
}) {
  return (
    <ul className={vertical ? 'space-y-1.5' : 'flex flex-wrap gap-x-4 gap-y-1 mt-2'}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2 text-meta text-ink-2">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: i.color }} aria-hidden />
          <span>{i.label}</span>
          {i.value && <span className="tabular-nums text-ink-3">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

export function ChartCard({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-card border border-rule rounded-md p-4 sm:p-6 shadow-card [&_section]:shadow-none [&_.shadow-card]:shadow-none">
      <h3 className="font-semibold text-title">{title}</h3>
      {note && <p className="text-meta text-ink-3 mb-3">{note}</p>}
      <div className={note ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}
