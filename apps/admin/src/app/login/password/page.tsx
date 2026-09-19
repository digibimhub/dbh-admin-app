'use client';

import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { PublicShell } from '@/components/PublicShell';
import { Button, ErrorNote, Field, TextInput } from '@/components/ui';

/**
 * The forced first-login password change.
 *
 * An organisation admin's first password was typed by somebody else, so the
 * session is held at this page until they choose their own. The API blocks
 * everything but the auth routes while `mustChangePassword` is set, and the
 * app layout sends anybody carrying that flag here.
 */
export default function PasswordPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = current.length > 0 && next.length >= 12 && next === confirm && next !== current;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await api('/admin/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      window.location.href = '/';
    } catch (err: unknown) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <PublicShell>
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <p className="text-meta text-ink-3">Step 2 of 2</p>
          <h1 className="text-page font-bold text-ink">Choose your password</h1>
          <p className="text-body text-ink-2 mt-2">
            The password you signed in with was set by a portal admin. Replace it with one only you know.
          </p>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        <Field label="Current password">
          <TextInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required autoFocus />
        </Field>
        <Field label="New password" hint="At least 12 characters, and not the one you were given.">
          <TextInput type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={12} required />
        </Field>
        <Field label="Confirm new password" hint={confirm && confirm !== next ? 'The two do not match.' : undefined}>
          <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </Field>

        <Button variant="primary" type="submit" disabled={busy || !ready} className="w-full">
          {busy ? 'Saving…' : 'Save and continue'}
        </Button>
      </form>
    </PublicShell>
  );
}
