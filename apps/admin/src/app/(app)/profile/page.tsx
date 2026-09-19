'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ROLE_DESCRIPTION, ROLE_LABEL } from '@/lib/permissions';
import { formatAbsolute } from '@/lib/format';
import { Modal } from '@/components/Modal';
import { Button, DefList, Note, PageHeader, Pill, Section, TimeAgo } from '@/components/ui';

/**
 * The person holding the session, and the one thing they can do to it.
 *
 * Sign out used to be a bare link in the header, one click from ending the
 * session with no confirmation and no way to see whose session it was. It now
 * lives here, behind a confirmation that says what signing out does — it ends
 * the session in every browser, because the API bumps the session epoch rather
 * than clearing one cookie.
 */
export default function ProfilePage() {
  const { user } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  async function signOut() {
    setBusy(true);
    // A failed call still ends in /login: the cookie may already be stale, and
    // the login page is the right place to find that out.
    await api('/admin/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  }

  const twoFactor = user.totpResetRequired
    ? <Pill tone="warn">reset required</Pill>
    : user.totpEnabled
      ? (
        <span className="inline-flex items-center gap-2">
          <Pill tone="allow">enabled</Pill>
          {user.totpEnrolledAt && (
            <span className="text-meta text-ink-3">
              since <TimeAgo value={user.totpEnrolledAt} />
            </span>
          )}
        </span>
      )
      : <Pill tone="deny">not enrolled</Pill>;

  return (
    <div>
      <PageHeader
        eyebrow="Account"
        title={user.displayName?.trim() || user.email}
        lede="Your operator account on this portal."
      />

      <div className="space-y-4 max-w-3xl">
        <Section title="Profile">
          <DefList
            items={[
              ['Email', user.email],
              ['Name', user.displayName?.trim() || <span className="text-ink-3">not set</span>],
              ['Role', (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Pill tone="neutral">{ROLE_LABEL[user.role]}</Pill>
                  <span className="text-meta text-ink-2">{ROLE_DESCRIPTION[user.role]}</span>
                </span>
              )],
              ['Two-factor', twoFactor],
              ['Last sign-in', user.lastLoginAt
                ? (
                  <span title={formatAbsolute(user.lastLoginAt)}>
                    <TimeAgo value={user.lastLoginAt} className="tabular-nums" />
                    {user.lastLoginIp && <span className="text-meta text-ink-3"> from {user.lastLoginIp}</span>}
                  </span>
                )
                : <span className="text-ink-3">no sign-in recorded</span>],
              ['Account created', <TimeAgo key="created" value={user.createdAt} className="tabular-nums" />],
            ]}
          />
        </Section>

        <Section
          title="Session"
          note="Sessions last eight hours. Signing out ends yours in every browser and tab at once."
          actions={<Button variant="danger" onClick={() => setConfirming(true)}>Sign out…</Button>}
        >
          <Note>
            Lost your authenticator? There is no self-service reset. An owner can reset it from
            Settings → Portal users, and your next sign-in enrols a new one.
          </Note>
        </Section>
      </div>

      <Modal open={confirming} title="Sign out" onClose={() => { if (!busy) setConfirming(false); }}>
        <div className="space-y-3">
          <p className="text-body">
            Sign out of <b>{user.email}</b>?
          </p>
          <p className="text-meta text-ink-2">
            This ends your session in every browser and tab where you are signed in. Signing back in
            needs your password and a code from your authenticator.
          </p>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={signOut} disabled={busy}>
              {busy ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
