'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * One component for both shapes. A separate `Drawer` would have to re-implement
 * the scrim, Escape, outside-click, `aria-modal`, the focus trap and the scroll
 * lock — which are exactly the parts that are easy to get subtly wrong.
 */
export function Modal({ open, title, onClose, children, wide, variant = 'center' }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  variant?: 'center' | 'drawer';
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const trap = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((el) => el.offsetParent !== null);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panel.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    // Remember who opened it, so focus goes back there rather than to <body>.
    restoreTo.current = document.activeElement as HTMLElement | null;

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      trap(e);
    }
    window.addEventListener('keydown', onKey);

    // Without this the page — and, worse, a drawer's own page — scrolls behind.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const firstField = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    firstField?.focus();

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose, trap]);

  if (!open) return null;

  const drawer = variant === 'drawer';

  return (
    <div
      className={`fixed inset-0 z-50 bg-ink/30 backdrop-blur-[2px] flex ${
        drawer ? 'justify-end' : 'items-start justify-center p-4 overflow-y-auto'
      }`}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={
          drawer
            ? `bg-card border-l border-rule shadow-pop w-full h-full overflow-y-auto ${wide ? 'max-w-2xl' : 'max-w-xl'}`
            : `bg-card border border-rule rounded-md shadow-pop w-full mt-[8vh] mb-10 ${wide ? 'max-w-3xl' : 'max-w-lg'}`
        }
      >
        <div className={`border-b border-rule px-5 py-3 flex items-center justify-between gap-4 ${
          drawer ? 'sticky top-0 bg-card z-10' : ''
        }`}>
          <h3 className="font-semibold text-title">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-micro uppercase tracking-wider text-ink-3 hover:text-ink"
          >
            Close
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
