'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, isStepUpRequired, stepUp } from '@/lib/api';
import { useCan, useSession } from '@/lib/session';
import { ROLE_LABEL } from '@/lib/permissions';
import { PORTAL_ROLES, type PortalRole, type PortalUserRow } from '@/lib/types';
import { DataTable, type Column } from '@/components/DataTable';
import { DangerDialog } from '@/components/DangerDialog';
import { Modal } from '@/components/Modal';
import { TotpInput } from '@/components/TotpInput';
import {
  Button, EmptyState, ErrorNote, Field, Note, Pill, Section, Select, TextInput, TimeAgo,
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
        Portal user management, including TOTP resets, is restricted to the owner role. Ask an owner to make the change.
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
      key: 'email', header: 'Email',
      cell: (r) => (
        <span className="text-meta">
          {r.email}
          {me?.id === r.id && <span className="ml-2 text-ink-3">(you)</span>}
        </span>
      ),
      csv: (r) => r.email,
    },
    { key: 'name', header: 'Name', cell: (r) => r.displayName ?? <span className="text-ink-3">—</span>, csv: (r) => r.displayName ?? '' },
    {
      key: 'role', header: 'Role',
      cell: (r) => (r.id === me?.id ? (
        <Pill tone="signal">{ROLE_LABEL[r.role]}</Pill>
      ) : (
        <Select
          value={r.role}
          disabled={busy}
          onChange={(e) => patch(r, { role: e.target.value as PortalRole })}
          aria-label={`Role for ${r.email}`}
          className="!py-[3px] !text-meta w-[104px]"
        >
          {PORTAL_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
        </Select>
      )),
      csv: (r) => r.role,
    },
    {
      key: 'active', header: 'Account',
      cell: (r) => (r.isActive ? <Pill tone="allow">active</Pill> : <Pill tone="deny">inactive</Pill>),
      csv: (r) => String(r.isActive),
    },
    {
      key: 'totp', header: 'Authenticator',
      cell: (r) => (r.totpResetRequired
        ? <Pill tone="warn">enrolment required</Pill>
        : r.totpEnabled ? <Pill tone="allow">enrolled</Pill> : <Pill tone="deny">not enrolled</Pill>),
      csv: (r) => (r.totpEnabled ? 'enrolled' : 'not enrolled'),
    },
    {
      key: 'lastLogin', header: 'Last login',
      cell: (r) => <TimeAgo value={r.lastLoginAt} className="tabular-nums text-meta text-ink-2" />,
      csv: (r) => r.lastLoginAt ?? '',
    },
    {
      key: 'created', header: 'Created', optional: true,
      cell: (r) => <TimeAgo value={r.createdAt} className="tabular-nums text-meta text-ink-2" />,
      csv: (r) => r.createdAt,
    },
    {
      key: 'actions', header: '',
      cell: (r) => (
        <span className="flex gap-3 whitespace-nowrap">
          <button onClick={() => setResetting(r)} className="text-meta text-deny hover:underline">
            Reset authenticator
          </button>
          {r.id !== me?.id && (r.isActive ? (
            <button onClick={() => setDeactivating(r)} className="text-meta text-deny hover:underline">
              Deactivate
            </button>
          ) : (
            <button
              onClick={() => patch(r, { isActive: true })}
              disabled={busy}
              className="text-meta text-allow hover:underline"
            >
              Reactivate
            </button>
          ))}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Section
        title="Portal users"
        note="People who can sign into this admin panel. Everyone here holds an authenticator; there is no password-only path."
        actions={<Button variant="primary" onClick={() => setCreating(true)}>Add portal user</Button>}
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          csvName="portal-users"
          empty={{
            title: 'No portal users',
            body: 'This list is seeded with the first owner account. Add colleagues here rather than sharing a login.',
          }}
        />
        <Note>
          A reset clears the stored secret, bumps the session epoch — signing every one of their devices out immediately —
          and forces enrolment at their next login. The command-line equivalent is{' '}
          <code className="font-mono">pnpm admin:reset-totp &lt;email&gt;</code>.
        </Note>
      </Section>

      <CreatePortalUser
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); load(); }}
      />

      {deactivating && (
        <DangerDialog
          open
          title="Deactivate portal user"
          targetKind="portal user"
          target={`${deactivating.email} (${ROLE_LABEL[deactivating.role]})`}
          consequence="They can no longer sign in, and every session they hold is invalidated on their next request. The last active owner cannot be deactivated."
          confirmLabel="Deactivate"
          requireStepUp={false}
          onCancel={() => setDeactivating(null)}
          onConfirm={async () => {
            await api(`/admin/portal-users/${deactivating.id}`, {
              method: 'PATCH', body: JSON.stringify({ isActive: false }),
            });
            setDeactivating(null);
            load();
          }}
        />
      )}

      {resetting && (
        <DangerDialog
          open
          title="Reset authenticator"
          targetKind="portal user"
          target={`${resetting.email} (${ROLE_LABEL[resetting.role]})`}
          consequence="Their authenticator secret is destroyed, every active session of theirs is invalidated, and they must enrol a new device at the next login. They cannot sign in until they do."
          confirmLabel="Reset authenticator"
          onCancel={() => setResetting(null)}
          onConfirm={async (reason) => {
            await api(`/admin/portal-users/${resetting.id}/reset-totp`, {
              method: 'POST', body: JSON.stringify({ reason }),
            });
            setResetting(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/** Creating a portal user is step-up guarded by the API, so the code is collected here. */
function CreatePortalUser({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<PortalRole>('viewer');
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
    <Modal open={open} title="Add portal user" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorNote>{error}</ErrorNote>}

        <Field label="Email"><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Display name"><TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
        <Field label="Role" hint="Support can approve requests and disable devices. Viewer is read only.">
          <Select value={role} onChange={(e) => setRole(e.target.value as PortalRole)}>
            {PORTAL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
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
          <p className="text-micro uppercase tracking-[0.1em] text-ink-3 mb-1">Your authenticator code</p>
          <TotpInput value={totp} onChange={setTotp} />
          <p className="text-meta text-ink-3 mt-1">Creating a portal user requires step-up confirmation.</p>
        </div>

        <Note>The new account is created with enrolment required — they set up their own authenticator at first login.</Note>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !ready}>{busy ? 'Creating…' : 'Create portal user'}</Button>
        </div>
      </form>
    </Modal>
  );
}
