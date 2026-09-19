'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, isStepUpRequired, stepUp } from '@/lib/api';
import { useCan, useSession } from '@/lib/session';
import { ROLE_LABEL } from '@/lib/permissions';
import { GLOBAL_PORTAL_ROLES, type GlobalPortalRole, type PortalUserRow } from '@/lib/types';
import { DataTable, type Column } from '@/components/DataTable';
import { DangerDialog } from '@/components/DangerDialog';
import { Modal } from '@/components/Modal';
import { TotpInput } from '@/components/TotpInput';
import {
  Avatar, Button, EmptyState, ErrorNote, Field, InfoBanner, Note, Section, Select, TextInput, TimeAgo,
} from '@/components/ui';

export default function PortalUsersPage() {
  const canManage = useCan('portal_user.manage');
  const { user: me, loading: sessionLoading } = useSession();

  const [rows, setRows] = useState<PortalUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<PortalUserRow | null>(null);
  const [deactivating, setDeactivating] = useState<PortalUserRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<{ rows: PortalUserRow[] }>('/admin/portal-users')
      .then((d) => { setRows(d.rows); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (canManage) load(); else setLoading(false); }, [canManage, load]);

  if (sessionLoading) return null;

  if (!canManage) {
    return (
      <EmptyState title="Owners only">
        Portal user management, including authenticator resets, is restricted to the owner role. Ask an owner to make the change.
      </EmptyState>
    );
  }

  async function patch(row: PortalUserRow, body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api(`/admin/portal-users/${row.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      load();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<PortalUserRow>[] = [
    {
      key: 'name', header: 'Name',
      cell: (r) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={r.displayName} email={r.email} />
          <div className="min-w-0">
            <div className="font-semibold text-ink truncate">
              {r.displayName ?? r.email}
              {me?.id === r.id && <span className="text-ink-3 font-normal"> (you)</span>}
            </div>
            <div className="text-small text-ink-3 truncate">{r.email}</div>
          </div>
        </div>
      ),
      csv: (r) => `${r.displayName ?? ''} <${r.email}>`,
    },
    {
      key: 'role', header: 'Role',
      /*
       * Organisation admins are minted from their organisation's Admins tab
       * and never change role here: the API refuses any transition to or from
       * `org_admin`, so the select would only explain its own refusal.
       */
      cell: (r) => {
        if (r.role === 'org_admin') {
          return (
            <span className="text-ink-3">
              {ROLE_LABEL.org_admin}
              {r.orgName && <> · {r.orgId ? <Link href={`/orgs/${r.orgId}/admins`} className="text-link hover:underline">{r.orgName}</Link> : r.orgName}</>}
            </span>
          );
        }
        if (r.id === me?.id) return <span className="text-ink-3">{ROLE_LABEL[r.role]}</span>;
        return (
          <Select
            value={r.role}
            disabled={busy}
            onChange={(e) => patch(r, { role: e.target.value as GlobalPortalRole })}
            aria-label={`Role for ${r.email}`}
            className="!h-8 !w-[130px] !text-small !py-0"
          >
            {GLOBAL_PORTAL_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
          </Select>
        );
      },
      csv: (r) => r.role,
    },
    {
      key: 'active', header: 'Account',
      cell: (r) => <span className={r.isActive ? 'text-ink-3' : 'text-ink font-semibold'}>{r.isActive ? 'Active' : 'Deactivated'}</span>,
      csv: (r) => String(r.isActive),
    },
    {
      key: 'totp', header: 'Authenticator',
      cell: (r) => (r.totpResetRequired
        ? <span className="text-ink font-semibold">Enrolment required</span>
        : <span className="text-ink-3">{r.totpEnabled ? 'Enrolled' : 'Not enrolled'}</span>),
      csv: (r) => (r.totpResetRequired ? 'enrolment required' : r.totpEnabled ? 'enrolled' : 'not enrolled'),
    },
    {
      key: 'lastLogin', header: 'Last sign-in',
      cell: (r) => <TimeAgo value={r.lastLoginAt} className="text-ink-3" />,
      csv: (r) => r.lastLoginAt ?? '',
    },
    {
      key: 'created', header: 'Created', optional: true,
      cell: (r) => <TimeAgo value={r.createdAt} className="text-ink-3" />,
      csv: (r) => r.createdAt,
    },
    {
      key: 'actions', header: '', className: 'text-right',
      cell: (r) => (
        <span className="flex justify-end gap-1 whitespace-nowrap">
          <Button variant="ghost" size="sm" onClick={() => setResetting(r)}>Reset authenticator…</Button>
          {r.id !== me?.id && (r.isActive ? (
            <Button variant="ghost" size="sm" onClick={() => setDeactivating(r)}>Deactivate…</Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => patch(r, { isActive: true })} disabled={busy}>Reactivate</Button>
          ))}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {error && <ErrorNote>{error}</ErrorNote>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        csvName="portal-users"
        noun="portal users"
        toolbar={<Button variant="primary" onClick={() => setCreating(true)}>Add portal user…</Button>}
        empty={{
          title: 'No portal users',
          body: 'This list is seeded with the first owner account. Add colleagues here rather than sharing a login.',
        }}
      />
      <Note>
        A reset signs them out of every device immediately and forces enrolment at their next
        sign-in. Same as{' '}<code className="font-mono">pnpm admin:reset-totp &lt;email&gt;</code>.
        Organisation admins are added from their organisation&apos;s Admins tab.
      </Note>

      <CreatePortalUser
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); load(); }}
      />

      <DangerDialog
        open={deactivating !== null}
        title="Deactivate portal user"
        verb="deactivate"
        targetKind="portal user"
        target={deactivating ? `${deactivating.email} (${ROLE_LABEL[deactivating.role]})` : ''}
        consequence="They can no longer sign in, and every session they hold is invalidated on their next request. The last active owner cannot be deactivated."
        confirmLabel="Deactivate"
        requireStepUp={false}
        onCancel={() => setDeactivating(null)}
        onConfirm={async () => {
          await api(`/admin/portal-users/${deactivating!.id}`, {
            method: 'PATCH', body: JSON.stringify({ isActive: false }),
          });
          setDeactivating(null);
          load();
        }}
      />

      <DangerDialog
        open={resetting !== null}
        title="Reset authenticator"
        verb="reset the authenticator of"
        targetKind="portal user"
        target={resetting ? `${resetting.email} (${ROLE_LABEL[resetting.role]})` : ''}
        consequence="Their authenticator secret is destroyed, every active session of theirs is invalidated, and they must enrol a new device at the next sign-in. They cannot sign in until they do."
        confirmLabel="Reset authenticator"
        onCancel={() => setResetting(null)}
        onConfirm={async (reason) => {
          await api(`/admin/portal-users/${resetting!.id}/reset-totp`, {
            method: 'POST', body: JSON.stringify({ reason }),
          });
          setResetting(null);
          load();
        }}
      />
    </div>
  );
}

/** Creating a portal user is step-up guarded by the API, so the code is collected here. */
function CreatePortalUser({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<GlobalPortalRole>('viewer');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setEmail(''); setDisplayName(''); setRole('viewer'); setPassword(''); setTotp(''); setError(null); }
  }, [open]);

  const ready = email.includes('@') && password.length >= 12 && /^\d{6}$/.test(totp);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await stepUp(totp);
      await api('/admin/portal-users', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), displayName: displayName.trim() || undefined, role, password }),
      });
      onCreated();
    } catch (err: unknown) {
      setError(isStepUpRequired(err)
        ? 'That code was not accepted. Enter the current one and try again.'
        : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Add portal user"
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form="create-portal-user" disabled={busy || !ready}>
            {busy ? 'Creating…' : 'Create portal user'}
          </Button>
        </>
      )}
    >
      <form id="create-portal-user" onSubmit={submit} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        <Field label="Email"><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Display name"><TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
        <Field label="Role" hint="Support can approve requests and disable devices. Viewer is read only. Organisation admins are added from an organisation's Admins tab.">
          <Select value={role} onChange={(e) => setRole(e.target.value as GlobalPortalRole)}>
            {GLOBAL_PORTAL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
        <Field label="Temporary password" hint="At least 12 characters. Send it over a channel that is not this portal.">
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={12}
            autoComplete="new-password"
            required
          />
        </Field>

        <div>
          <p className="text-label text-ink-2 mb-1">Your authenticator code</p>
          <TotpInput value={totp} onChange={setTotp} />
          <p className="text-meta text-ink-3 mt-1">Creating a portal user needs step-up confirmation.</p>
        </div>

        <InfoBanner className="!mb-0">
          The account is created with enrolment required. They set up their own authenticator at first sign-in.
        </InfoBanner>
      </form>
    </Modal>
  );
}
