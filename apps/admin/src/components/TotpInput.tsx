'use client';

import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

/**
 * Six digits, auto-advancing, paste-friendly — pasting "123456" into any box
 * fills all six and moves focus to the end, which is how people actually get a
 * code out of their authenticator app.
 */
export function TotpInput({ value, onChange, disabled, autoFocus }: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');

  function setAt(index: number, digit: string) {
    const next = digits.map((d, i) => (i === index ? digit : d)).join('').replace(/\s/g, '');
    onChange(next.replace(/\D/g, '').slice(0, 6));
  }

  function onInput(index: number, raw: string) {
    const clean = raw.replace(/\D/g, '');
    if (!clean) { setAt(index, ' '); return; }
    if (clean.length > 1) { fill(clean, index); return; }
    setAt(index, clean);
    if (index < 5) refs.current[index + 1]?.focus();
  }

  function fill(clean: string, from: number) {
    const merged = (value.slice(0, from) + clean).replace(/\D/g, '').slice(0, 6);
    onChange(merged);
    refs.current[Math.min(merged.length, 5)]?.focus();
  }

  function onKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index]?.trim() && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < 5) refs.current[index + 1]?.focus();
  }

  function onPaste(index: number, e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!text) return;
    e.preventDefault();
    fill(text, index);
  }

  return (
    <div className="flex gap-1.5" role="group" aria-label="Six digit authenticator code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={d.trim()}
          onChange={(e) => onInput(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={(e) => onPaste(i, e)}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          maxLength={1}
          className="w-11 h-12 text-center text-page tabular-nums border border-rule rounded-sm bg-card focus:outline-none focus:border-signal disabled:opacity-50"
        />
      ))}
    </div>
  );
}
