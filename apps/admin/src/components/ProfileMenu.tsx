'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ROLE_LABEL } from '@/lib/permissions';
import type { Scope } from '@/lib/session';
import type { SessionUser } from '@/lib/types';
import { Avatar, Button } from './ui';
import { SignOutDialog } from './SignOutDialog';

/**
 * The 44 px avatar at the far right of the top bar, and its flyout: name,
 * email, a full-width outline Sign out… (behind a confirmation — a stray
 * click must not end the session), then Account and Settings.
 */
export function ProfileMenu({ user, scope }: { user: SessionUser; scope: Scope }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const roleLine = scope.kind === 'org'
    ? `${ROLE_LABEL.org_admin} · ${scope.orgName}`
    : ROLE_LABEL[user.role];

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Your account"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full hover:ring-2 hover:ring-card/30"
      >
        <Avatar name={user.displayName} email={user.email} size={44} dark />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[52px] z-40 w-[288px] bg-card text-ink-2 border border-rule rounded-sm shadow-pop p-5"
        >
          <p className="font-bold text-ink truncate">{user.displayName?.trim() || user.email}</p>
          <p className="text-meta text-ink-3 truncate">{user.email}</p>
          <p className="text-meta text-ink-3 mb-3">{roleLine}</p>
          <Button className="w-full" onClick={() => { setOpen(false); setSigningOut(true); }}>Sign out…</Button>
          <ul className="mt-4 pt-3 border-t border-rule">
            <li>
              <Link role="menuitem" href="/profile" onClick={() => setOpen(false)} className="block py-1.5 text-meta hover:text-link">Account</Link>
            </li>
            {scope.kind === 'global' && (
              <li>
                <Link role="menuitem" href="/settings" onClick={() => setOpen(false)} className="block py-1.5 text-meta hover:text-link">Settings</Link>
              </li>
            )}
          </ul>
        </div>
      )}

      <SignOutDialog open={signingOut} onClose={() => setSigningOut(false)} />
    </div>
  );
}
