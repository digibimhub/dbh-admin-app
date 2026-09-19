'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, isStepUpRequired, stepUp } from '@/lib/api';
import { EMAIL_RE } from '@/lib/csv';
import { Modal } from './Modal';
import { TotpInput } from './TotpInput';
import {
  Button, ErrorNote, Field, FieldRow, InfoBanner, SegmentedControl, TextInput,
} from './ui';

/** Unambiguous characters only: no 0/O, 1/l/I. Four groups of four, hyphenated. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generatePassword(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]!);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

/**
 * Mint an organisation admin. The role is fixed server-side and the org comes
 * from the path, so the form is name, email and a first password. Creating a
 * portal account is step-up guarded, so the code is collected here.
 *
 * A generated password is shown exactly once, after the account exists, and
 * never again — they are made to replace it at first sign-in.
 */
export function AddOrgAdminDialog({ open, orgId, orgName, onClose, onCreated }: {
  open: boolean;
  orgId: string;
  orgName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<'set' | 'generate'>('set');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDisplayName(''); setEmail(''); setMode('set'); setPassword(''); setTotp('');
    setError(null); setBusy(false); setShown(null); setCopied(false);
  }, [open]);

  const ready = displayName.trim().length >= 2
    && EMAIL_RE.test(email.trim())
    && (mode === 'generate' || password.length >= 12)
    && /^\d{6}$/.test(totp);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    const finalPassword = mode === 'generate' ? generatePassword() : password;
    const address = email.trim().toLowerCase();
    try {
      await stepUp(totp);
      await api(`/admin/orgs/${orgId}/portal-users`, {
        method: 'POST',
        body: JSON.stringify({ displayName: displayName.trim(), email: address, password: finalPassword }),
      });
      onCreated();
      if (mode === 'generate') setShown({ email: address, password: finalPassword });
      else onClose();
    } catch (err: unknown) {
      setError(isStepUpRequired(err)
        ? 'That code was not accepted. Enter the current one and try again.'
        : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Add organisation admin"
      onClose={onClose}
      footer={shown ? (
        <Button variant="primary" onClick={onClose}>Done</Button>
      ) : (
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-org-admin" disabled={busy || !ready}>
            {busy ? 'Creating…' : 'Create admin'}
          </Button>
        </>
      )}
    >
      {shown ? (
        <InfoBanner
          className="!mb-0"
          action={<Button size="sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>}
        >
          <b>Password for {shown.email}, shown once</b>
          <p className="font-mono text-small bg-paper-2 border border-rule rounded-sm px-3 py-2 my-2 select-all text-ink">
            {shown.password}
          </p>
          Send it over a channel that is not this portal. They will be asked to replace it at first sign-in.
        </InfoBanner>
      ) : (
        <form id="add-org-admin" onSubmit={submit} className="space-y-4">
          {error && <ErrorNote>{error}</ErrorNote>}

          <FieldRow cols={2}>
            <Field label="Name">
              <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} required minLength={2} />
            </Field>
            <Field label="Email">
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
          </FieldRow>

          <div>
            <p className="text-label text-ink-2 mb-1">Password</p>
            <SegmentedControl
              label="Password"
              value={mode}
              onChange={setMode}
              options={[{ value: 'set', label: 'Set a password' }, { value: 'generate', label: 'Generate one' }]}
            />
          </div>

          {mode === 'set' ? (
            <Field label="Password" hint="At least 12 characters. They choose their own at first sign-in.">
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={12}
                autoComplete="new-password"
                required
              />
            </Field>
          ) : (
            <p className="text-meta text-ink-3">A random password is made when you press Create admin, and shown once.</p>
          )}

          <div>
            <p className="text-label text-ink-2 mb-1">Your authenticator code</p>
            <TotpInput value={totp} onChange={setTotp} />
            <p className="text-meta text-ink-3 mt-1">Creating an admin needs step-up confirmation.</p>
          </div>

          <InfoBanner className="!mb-0">
            They manage members and requests for {orgName} only. At first sign-in they set up an
            authenticator and choose a new password.
          </InfoBanner>
        </form>
      )}
    </Modal>
  );
}
