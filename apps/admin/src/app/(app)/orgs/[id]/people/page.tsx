'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useUrlState } from '@/lib/useUrlState';
import { useCan } from '@/lib/session';
import { useOrg } from '@/components/OrgContext';
import { AddUserDialog } from '@/components/AddUserDialog';
import { UserCsvImport } from '@/components/UserCsvImport';
import { DangerDialog } from '@/components/DangerDialog';
import {
  MEMBER_STATUSES, SOURCE_LABEL,
  type Paged, type RoleRow, type UserRow,
} from '@/lib/types';
import { DataTable, PAGE_SIZE, Pagination, type Column } from '@/components/DataTable';
import {
  Button, ErrorNote, Pill, SEARCH_FIELD, Select, StatusPill, TextInput, TimeAgo,
} from '@/components/ui';

const FILTER_DEFAULTS = { q: '', role: '', status: '' };

export default function OrgPeoplePage() {
  const { detail, reload: reloadOrg } = useOrg();
  const orgId = detail.org.id;
  const { values, set, page, reset, activeFilterCount } = useUrlState(FILTER_DEFAULTS);

  const canManage = useCan('user.manage');
  const canImport = useCan('user.import');

  const [data, setData] = useState<Paged<UserRow> | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [disabling, setDisabling] = useState<UserRow | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    api<Paged<UserRow>>(`/admin/users${qs({
      org: orgId, q: values.q, role: values.role, status: values.status,
      page, pageSize: PAGE_SIZE,
    })}`)
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [orgId, values.q, values.role, values.status, page]);

  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => {
    api<{ rows: RoleRow[] }>('/admin/roles').then((d) => setRoles(d.rows)).catch(() => undefined);
  }, []);

  /** Seats free per role, so a full one can say so before it is chosen. */
  const freeByRole = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of detail.seats) m.set(s.roleKey, s.seats - s.used);
    return m;
  }, [detail.seats]);

  async function act(path: string, body: unknown = {}, method = 'POST') {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method, body: JSON.stringify(body) });
      setTick((t) => t + 1);
      reloadOrg();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<UserRow>[] = [
    {
      key: 'person', header: 'Person',
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{r.user.displayName ?? r.user.email ?? '—'}</div>
          <div className="text-micro text-ink-3 truncate">{r.user.email ?? 'no email on record'}</div>
        </div>
      ),
      csv: (r) => `${r.user.displayName ?? ''} <${r.user.email ?? ''}>`,
    },
    {
      key: 'role', header: 'Role',
      cell: (r) => {
        if (!canManage) return <Pill tone="neutral">{r.roleName}</Pill>;
        return (
          <Select
            value={r.user.roleKey}
            disabled={busy}
            aria-label={`Role for ${r.user.email ?? r.user.id}`}
            className="!w-[150px] !py-[3px] !text-meta"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              void act(`/admin/users/${r.user.id}/role`, { roleKey: e.target.value });
            }}
          >
            {roles.filter((x) => x.isActive || x.key === r.user.roleKey).map((x) => {
              const free = freeByRole.get(x.key) ?? 0;
              const blocked = x.key !== r.user.roleKey && r.user.status === 'active' && free <= 0;
              return (
                <option key={x.key} value={x.key} disabled={blocked}>
                  {x.name}{blocked ? ' — full' : ''}
                </option>
              );
            })}
          </Select>
        );
      },
      csv: (r) => r.roleName,
    },
    {
      key: 'status', header: 'Status',
      cell: (r) => (r.user.status === 'pending'
        ? <Pill tone="warn" title="A seat was not free when they signed in">awaiting a seat</Pill>
        : <StatusPill status={r.user.status} />),
      csv: (r) => r.user.status,
    },
    {
      key: 'source', header: 'Source',
      cell: (r) => <span className="text-meta text-ink-2">{SOURCE_LABEL[r.user.source] ?? r.user.source}</span>,
      csv: (r) => r.user.source,
    },
    {
      key: 'activity', header: 'Last activity',
      cell: (r) => <TimeAgo value={r.user.lastActivityAt} className="text-meta text-ink-2" />,
      csv: (r) => r.user.lastActivityAt ?? '',
    },
    {
      key: 'actions', header: '',
      className: 'text-right',
      cell: (r) => {
        if (!canManage) return null;
        return (
          <span className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            {r.user.status === 'pending' && (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => act(`/admin/users/${r.user.id}/approve`)}
              >
                Give a seat
              </Button>
            )}
            {r.user.status === 'disabled' && (
              <Button variant="secondary" disabled={busy} onClick={() => act(`/admin/users/${r.user.id}/enable`)}>
                Enable
              </Button>
            )}
            {r.user.status === 'active' && (
              <Button variant="ghost" onClick={() => setDisabling(r)}>Disable</Button>
            )}
          </span>
        );
      },
    },
  ];

  const pending = data?.rows.filter((r) => r.user.status === 'pending') ?? [];

  return (
    <div>
      {error && <ErrorNote>{error}</ErrorNote>}

      {pending.length > 0 && (
        <p className="bg-warn-soft text-warn border border-warn/30 rounded-sm px-3 py-2 mb-3 text-body">
          <b>{pending.length} {pending.length === 1 ? 'person is' : 'people are'} waiting for a seat.</b>{' '}
          Their sessions are still valid — give them a seat, or raise the count on the Licence tab,
          and they are working at their next check without signing in again.
        </p>
      )}

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.user.id}
        loading={loading}
        csvName={`${detail.org.slug}-people`}
        onRowClick={(r) => { window.location.href = `/users/${r.user.id}`; }}
        flagRow={(r) => (r.user.status === 'pending' ? 'Waiting for a seat' : null)}
        filters={(
          <>
            <TextInput
              placeholder="Search name or email"
              defaultValue={values.q}
              onKeyDown={(e) => { if (e.key === 'Enter') set({ q: (e.target as HTMLInputElement).value }); }}
              className={SEARCH_FIELD}
              aria-label="Search people"
            />
            <Select value={values.role} onChange={(e) => set({ role: e.target.value })} className="!w-auto" aria-label="Filter by role">
              <option value="">Any role</option>
              {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </Select>
            <Select value={values.status} onChange={(e) => set({ status: e.target.value })} className="!w-auto" aria-label="Filter by status">
              <option value="">Any status</option>
              {MEMBER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            {activeFilterCount > 0 && <Button variant="ghost" onClick={reset}>Clear</Button>}
          </>
        )}
        toolbar={(
          <>
            {canImport && <Button onClick={() => setImporting(true)}>Import CSV</Button>}
            {canManage && <Button variant="primary" onClick={() => setAdding(true)}>Add person</Button>}
          </>
        )}
        empty={{
          title: activeFilterCount ? 'Nobody matches these filters' : 'Nobody here yet',
          body: activeFilterCount
            ? 'Clear a filter to widen the search.'
            : (
              <>
                People appear the first time they sign in from the add-in with an email on one of
                this organisation&apos;s domains. You can also add somebody before their first
                sign-in — their Autodesk id is filled in when they arrive.
              </>
            ),
          action: activeFilterCount
            ? <Button variant="ghost" onClick={reset}>Clear filters</Button>
            : (canManage ? <Button variant="primary" onClick={() => setAdding(true)}>Add person</Button> : undefined),
        }}
        pagination={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={(p) => set({ page: p })} />}
      />

      <p className="text-meta text-ink-3 mt-2 max-w-[80ch]">
        A role change takes effect on the workstation at its next check — at most 24 hours, and with
        no sign-in. Moving somebody between roles frees one seat and takes another in the same step.{' '}
        <Link href="/settings/roles" className="text-signal hover:underline">Roles are configured in Settings</Link>.
      </p>

      <AddUserDialog
        open={adding}
        orgId={orgId}
        roles={roles}
        onClose={() => setAdding(false)}
        onAdded={() => { setTick((t) => t + 1); reloadOrg(); }}
      />
      <UserCsvImport
        open={importing}
        orgId={orgId}
        onClose={() => setImporting(false)}
        onImported={() => { setTick((t) => t + 1); reloadOrg(); }}
      />

      <DangerDialog
        open={disabling !== null}
        title="Disable person"
        targetKind="person"
        target={disabling?.user.email ?? disabling?.user.id ?? ''}
        consequence="Their next validation is denied with user_disabled and their add-in sessions are revoked, so re-enabling them means signing in again. It also frees their seat, which somebody else may take."
        confirmLabel="Disable person"
        onCancel={() => setDisabling(null)}
        onConfirm={async (reason) => {
          await api(`/admin/users/${disabling!.user.id}/disable`, {
            method: 'POST', body: JSON.stringify({ reason }),
          });
          setDisabling(null);
          setTick((t) => t + 1);
          reloadOrg();
        }}
      />
    </div>
  );
}
