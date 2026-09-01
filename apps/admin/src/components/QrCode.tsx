'use client';

import { useMemo } from 'react';
import { encodeQr } from '@/lib/qr';

/*
 * QR modules are drawn with literal colours, not tokens: a scanner needs true
 * black-on-white, and SVG `fill` attributes cannot read CSS variables during
 * SSR anyway. `INK` mirrors the `--ink` token value.
 */
const INK = '#0F172A';
const QUIET = '#FFFFFF';

/** Renders a QR matrix as one SVG path — no canvas, no library, no network call. */
export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const path = useMemo(() => {
    try {
      const matrix = encodeQr(value);
      const n = matrix.length;
      const parts: string[] = [];
      for (let y = 0; y < n; y += 1) {
        const row = matrix[y]!;
        for (let x = 0; x < n; x += 1) {
          if (row[x]) parts.push(`M${x + 4} ${y + 4}h1v1h-1z`);
        }
      }
      return { d: parts.join(''), extent: n + 8 };
    } catch {
      return null;
    }
  }, [value]);

  if (!path) {
    return (
      <p className="text-meta text-ink-3">
        Could not render a QR code for this secret. Use the manual entry details below.
      </p>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${path.extent} ${path.extent}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="border border-rule rounded-sm bg-card"
    >
      <rect width={path.extent} height={path.extent} fill={QUIET} />
      <path d={path.d} fill={INK} />
    </svg>
  );
}
