'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Modal } from './Modal';
import { Button } from './ui';

/**
 * Signing out ends the session in every browser and tab, because the API
 * bumps the session epoch rather than clearing one cookie — so it is behind a
 * confirmation that says so. Shared by the profile flyout and the account page.
 */
export function SignOutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    // A failed call still ends in /login: the cookie may already be stale, and
    // the login page is the right place to find that out.
    await api('/admin/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  }

  return (
    <Modal
      open={open}
      title="Sign out"
      onClose={() => { if (!busy) onClose(); }}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={signOut} disabled={busy}>
            {busy ? 'Signing out…' : 'Sign out'}
          </Button>
        </>
      )}
    >
      <p className="text-body">This ends your session on every device, not only this one.</p>
      <p className="text-body mt-4">You will need your password and a fresh authenticator code to sign in again.</p>
    </Modal>
  );
}
