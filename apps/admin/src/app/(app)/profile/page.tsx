'use client';

import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useScope, useSession } from '@/lib/session';
import { ROLE_DESCRIPTION, ROLE_LABEL } from '@/lib/permissions';
import { formatAbsolute } from '@/lib/format';
import { SignOutDialog } from '@/components/SignOutDialog';
import {
  Avatar, Button, DefList, ErrorNote, Field, InfoBanner, Note, PageHeader, Section, TextInput, TimeAgo,
} from '@/components/ui';

/**
 * The person holding the session: who they are, and the two things they can
 * do to it — end it everywhere, or change the password it was opened with.
 */
export default function ProfilePage() {
  const { user } = useSession();
  const scope = useScope();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) return null;

  const roleLine = scope.kind === 'org'
    ? `${ROLE_LABEL.org_admin} · ${scope.orgName}`
    : ROLE_LABEL[user.role];

  const twoFactor = user.totpResetRequired
    ? <span className="font-semibold">Reset required</span>
    : user.totpEnabled
      ? (
        <>
          Enrolled
          {user.totpEnrolledAt && (
            <p className="text-meta text-ink-3">since <TimeAgo value={user.totpEnrolledAt} /></p>
          )}
        </>
      )
      : <span className="font-semibold">Not enrolled</span>;

  return (
    <div>
      <PageHeader
        variant="record"
        avatar={<Avatar name={user.displayName} email={user.email} size={48} />}
        title={user.displayName?.trim() || user.email}
        subline={`${roleLine} · ${user.email}`}
        actions={<Button onClick={() => setSigningOut(true)}>Sign out…</Button>}
      />

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <Section title="Profile" note="What the portal knows about you.">
          <DefList
            items={[
              ['Email', user.email],
              ['Name', user.displayName?.trim() || <span className="text-ink-3">Not set</span>],
              ['Role', (
                <>
                  {roleLine}
                  <p className="text-meta text-ink-3">{ROLE_DESCRIPTION[user.role]}</p>
                </>
              )],
              ['Two-factor', twoFactor],
              ['Last sign-in', user.lastLoginAt
                ? (
                  <>
                    <span title={formatAbsolute(user.lastLoginAt)}><TimeAgo value={user.lastLoginAt} /></span>
                    {user.lastLoginIp && <p className="text-meta text-ink-3">from {user.lastLoginIp}</p>}
                  </>
                )
                : <span className="text-ink-3">No sign-in recorded</span>],
              ['Account created', <TimeAgo key="created" value={user.createdAt} />],
            ]}
          />
        </Section>

        <Section
          title="Security"
          note="Sessions last eight hours. Signing out ends every session on every device."
        >
          <ChangePassword />
          <Note>
            Lost your authenticator? There is no self-service reset. An owner can reset it from
            Settings, and your next sign-in enrols a new one.
          </Note>
        </Section>
      </div>

      <SignOutDialog open={signingOut} onClose={() => setSigningOut(false)} />
    </div>
  );
}

/** `POST /admin/auth/password` — the current password is the proof, no step-up. */
function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const ready = current.length > 0 && next.length >= 12 && next === confirm && next !== current;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api('/admin/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setCurrent(''); setNext(''); setConfirm('');
      setDone(true);
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-[360px]">
      {error && <ErrorNote>{error}</ErrorNote>}
      {done && <InfoBanner className="!mb-0">Your password has been changed.</InfoBanner>}
      <Field label="Current password">
        <TextInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </Field>
      <Field label="New password" hint="At least 12 characters.">
        <TextInput type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={12} required />
      </Field>
      <Field label="Confirm new password" hint={confirm && confirm !== next ? 'The two do not match.' : undefined}>
        <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
      </Field>
      <Button type="submit" disabled={busy || !ready}>{busy ? 'Changing…' : 'Change password'}</Button>
    </form>
  );
}
