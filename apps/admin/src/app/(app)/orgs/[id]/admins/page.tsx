'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/session';
import { useOrg } from '@/components/OrgContext';
import type { PortalUserRow } from '@/lib/types';
import { DataTable, type Column } from '@/components/DataTable';
import { DangerDialog } from '@/components/DangerDialog';
import { AddOrgAdminDialog } from '@/components/AddOrgAdminDialog';
import { Avatar, Button, ErrorNote, Note, TimeAgo } from '@/components/ui';

/**
 * The portal accounts scoped to this organisation. Minted here, never from
 * Portal users: the role is fixed and the organisation comes from the path.
 */
export default function OrgAdminsPage() {
  const { detail } = useOrg();
  const org = detail.org;
  const canManage = useCan('org_admin.manage');

  const [rows, setRows] = useState<PortalUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<PortalUserRow | null>(null);
  const [deactivating, setDeactivating] = useState<PortalUserRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<{ rows: PortalUserRow[] }>(`/admin/orgs/${org.id}/portal-users`)
      .then((d) => { setRows(d.rows); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [org.id]);

  useEffect(() => { load(); }, [load]);

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
            <div className="font-semibold text-ink truncate">{r.displayName ?? r.email}</div>
            <div className="text-small text-ink-3 truncate">{r.email}</div>
          </div>
        </div>
      ),
      csv: (r) => `${r.displayName ?? ''} <${r.email}>`,
    },
    {
      key: 'account', header: 'Account',
      cell: (r) => <span className={r.isActive ? 'text-ink-3' : 'text-ink font-semibold'}>{r.isActive ? 'Active' : 'Deactivated'}</span>,
      csv: (r) => (r.isActive ? 'active' : 'deactivated'),
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
      key: 'created', header: 'Created',
      cell: (r) => <TimeAgo value={r.createdAt} className="text-ink-3" />,
      csv: (r) => r.createdAt,
    },
    {
      key: 'actions', header: '', className: 'text-right',
      cell: (r) => (canManage ? (
        <span className="flex justify-end gap-1 whitespace-nowrap">
          <Button variant="ghost" size="sm" onClick={() => setResetting(r)}>Reset authenticator…</Button>
          {r.isActive
            ? <Button variant="ghost" size="sm" onClick={() => setDeactivating(r)}>Deactivate…</Button>
            : <Button variant="ghost" size="sm" disabled={busy} onClick={() => patch(r, { isActive: true })}>Reactivate</Button>}
        </span>
      ) : null),
    },
  ];

  return (
    <div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        csvName={`${org.slug}-admins`}
        noun="organisation admins"
        toolbar={canManage && <Button variant="primary" onClick={() => setAdding(true)}>Add admin…</Button>}
        empty={{
          title: 'No organisation admins yet',
          body: `An organisation admin signs in to this portal and manages ${org.name}'s members and requests, and nothing else. Add one and send them their first password.`,
          action: canManage ? <Button variant="primary" onClick={() => setAdding(true)}>Add admin…</Button> : undefined,
        }}
      />

      <Note>
        An organisation admin manages members and requests for {org.name} only. They cannot change the licence,
        seats or domains, and they set up their own authenticator and password at first sign-in.
      </Note>

      <AddOrgAdminDialog
        open={adding}
        orgId={org.id}
        orgName={org.name}
        onClose={() => setAdding(false)}
        onCreated={load}
      />

      <DangerDialog
        open={deactivating !== null}
        title="Deactivate organisation admin"
        verb="deactivate"
        targetKind="organisation admin"
        target={deactivating?.email ?? ''}
        consequence="They can no longer sign in, and every session they hold is invalidated on their next request."
        confirmLabel="Deactivate"
        requireStepUp={false}
        onCancel={() => setDeactivating(null)}
        onConfirm={async () => {
          await api(`/admin/portal-users/${deactivating!.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: false }) });
          setDeactivating(null);
          load();
        }}
      />

      <DangerDialog
        open={resetting !== null}
        title="Reset authenticator"
        verb="reset the authenticator of"
        targetKind="organisation admin"
        target={resetting?.email ?? ''}
        consequence="Their authenticator secret is destroyed, every active session of theirs is invalidated, and they must enrol a new device at the next sign-in. They cannot sign in until they do."
        confirmLabel="Reset authenticator"
        onCancel={() => setResetting(null)}
        onConfirm={async (reason) => {
          await api(`/admin/portal-users/${resetting!.id}/reset-totp`, { method: 'POST', body: JSON.stringify({ reason }) });
          setResetting(null);
          load();
        }}
      />
    </div>
  );
}
