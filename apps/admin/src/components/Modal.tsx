'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The dialog's action band: right-aligned, Cancel first, primary last. */
export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-3 px-6 py-6 border-t border-rule">{children}</div>;
}

/**
 * One dialog: 640 px (960 wide), a 60 % scrim, a 77 px header with a ✕, a
 * `p-6` body and an optional footer band. Forms put `id` on the `<form>` and
 * `form={id}` on the footer's submit button, so the footer never has to live
 * inside the form.
 *
 * It traps focus, restores it on close, locks body scroll and closes on
 * Escape — the parts that are easy to get subtly wrong, kept in one place.
 */
export function Modal({ open, title, onClose, children, footer, wide }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
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

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    /*
     * The first thing in the BODY, not the first thing in the panel.
     *
     * Searching the whole panel always found the header's Close button, because
     * it comes first in the DOM — so every dialog opened with focus on the way
     * out of it. Falling back to the panel keeps a dialog with no focusable
     * content (a bare confirmation) from leaving focus outside the trap.
     */
    const firstField = body.current?.querySelector<HTMLElement>(FOCUSABLE)
      ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    firstField?.focus();

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose, trap]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`bg-card rounded-sm shadow-pop w-full mt-[8vh] mb-10 text-ink-2 ${wide ? 'max-w-[960px]' : 'max-w-[640px]'}`}
      >
        <div className="min-h-[77px] px-6 border-b border-rule flex items-center justify-between gap-4">
          <h2 className="text-dialog font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 -mr-2 rounded-sm grid place-items-center text-[22px] leading-none text-ink hover:bg-paper-2"
          >
            ×
          </button>
        </div>
        <div ref={body} className="p-6">{children}</div>
        {footer && <ModalFooter>{footer}</ModalFooter>}
      </div>
    </div>
  );
}
