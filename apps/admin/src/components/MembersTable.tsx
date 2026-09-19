'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useUrlState } from '@/lib/useUrlState';
import { useCan } from '@/lib/session';
import {
  MEMBER_STATUSES, SOURCE_LABEL,
  type Paged, type RoleRow, type SeatUsage, type UserRow,
} from '@/lib/types';
import { DataTable, PAGE_SIZE, Pagination, type Column } from './DataTable';
import { DangerDialog } from './DangerDialog';
import { Modal } from './Modal';
import { ApproveDialog, freeSeats } from './ApproveDialog';
import { DeleteRequestDialog, RejectDialog, type RequestTarget } from './RejectDialog';
import {
  Avatar, Button, ErrorNote, Field, InfoBanner, Note, SearchInput, Select, StatusText, TimeAgo,
  memberStatusLabel,
} from './ui';

const FILTER_DEFAULTS = { q: '', role: '', status: '' };

function target(r: UserRow): RequestTarget {
  return { id: r.user.id, email: r.user.email, displayName: r.user.displayName };
}

/**
 * One organisation's members, with selection and bulk actions. Shared by the
 * portal admin's People tab and the organisation admin's Members page; what
 * differs between them (Add person, Import CSV) arrives as `toolbar`.
 *
 * Capabilities are read here rather than passed in: `member.manage` for the
 * role select, Disable and Enable; `member.review` for Approve, Reject and
 * Delete. Hidden, never disabled.
 */
export function MembersTable({ orgId, seats, licenceActive = true, toolbar, reloadKey, onChanged, emptyAction }: {
  orgId: string;
  seats: SeatUsage[];
  licenceActive?: boolean;
  toolbar?: ReactNode;
  reloadKey?: number;
  onChanged?: () => void;
  /** The button in the empty state, when the viewer can add somebody. */
  emptyAction?: ReactNode;
}) {
  const router = useRouter();
  const { values, set, page, reset, activeFilterCount } = useUrlState(FILTER_DEFAULTS);
  const canManage = useCan('member.manage');
  const canReview = useCan('member.review');

  const [data, setData] = useState<Paged<UserRow> | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState<UserRow | null>(null);
  const [rejecting, setRejecting] = useState<RequestTarget[]>([]);
  const [deleting, setDeleting] = useState<RequestTarget | null>(null);
  const [disabling, setDisabling] = useState<UserRow[]>([]);
  const [changingRole, setChangingRole] = useState<UserRow[]>([]);
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

  useEffect(() => { load(); }, [load, tick, reloadKey]);
  useEffect(() => { setSelected(new Set()); }, [values.q, values.role, values.status, page]);
  useEffect(() => {
    api<{ rows: RoleRow[] }>('/admin/roles').then((d) => setRoles(d.rows)).catch(() => undefined);
  }, []);

  function changed() {
    setSelected(new Set());
    setTick((t) => t + 1);
    onChanged?.();
  }

  async function act(path: string, body: unknown = {}, method = 'POST') {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method, body: JSON.stringify(body) });
      changed();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** Run one call per selected row and report the partial result in one banner. */
  async function bulk(label: string, targets: UserRow[], call: (r: UserRow) => Promise<unknown>) {
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const r of targets) {
      try { await call(r); ok += 1; } catch (e: unknown) { failed.push(`${r.user.email ?? r.user.id}: ${errorMessage(e)}`); }
    }
    setBusy(false);
    setNotice(failed.length ? `${ok} ${label}, ${failed.length} could not: ${failed.join('; ')}` : `${ok} ${label}.`);
    changed();
  }

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const selectedRows = rows.filter((r) => selected.has(r.user.id));
  const pending = rows.filter((r) => r.user.status === 'pending');

  const columns: Column<UserRow>[] = [
    {
      key: 'person', header: 'Person',
      cell: (r) => (
        <div className="flex items-center gap-3 min-w-0 max-w-[24rem]">
          <Avatar name={r.user.displayName} email={r.user.email} />
          <div className="min-w-0">
            <div className="font-semibold text-ink truncate">{r.user.displayName ?? r.user.email ?? '—'}</div>
            <div className="text-small text-ink-3 truncate">{r.user.email ?? 'no email on record'}</div>
          </div>
        </div>
      ),
      csv: (r) => `${r.user.displayName ?? ''} <${r.user.email ?? ''}>`,
    },
    {
      key: 'role', header: 'Role',
      cell: (r) => {
        const settled = r.user.status === 'active' || r.user.status === 'disabled';
        if (!canManage || !settled) return <span className="text-ink-3">{r.roleName}</span>;
        return (
          <Select
            value={r.user.roleKey}
            disabled={busy}
            aria-label={`Role for ${r.user.displayName ?? r.user.email ?? r.user.id}`}
            className="!h-8 !w-[170px] !text-small !py-0"
            onChange={(e) => { void act(`/admin/users/${r.user.id}/role`, { roleKey: e.target.value }); }}
          >
            {roles.filter((x) => x.isActive || x.key === r.user.roleKey).map((x) => {
              const free = freeSeats(seats, x.key) ?? 0;
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
      cell: (r) => <StatusText status={r.user.status} reason={r.user.pendingReason} />,
      csv: (r) => memberStatusLabel(r.user.status, r.user.pendingReason),
    },
    {
      key: 'source', header: 'Source', optional: true,
      cell: (r) => <span className="text-ink-3">{SOURCE_LABEL[r.user.source] ?? r.user.source}</span>,
      csv: (r) => r.user.source,
    },
    {
      key: 'activity', header: 'Last activity',
      cell: (r) => <TimeAgo value={r.user.lastActivityAt} className="text-ink-3" />,
      csv: (r) => r.user.lastActivityAt ?? '',
    },
    {
      key: 'actions', header: '', className: 'text-right',
      cell: (r) => {
        const s = r.user.status;
        return (
          <span className="flex justify-end gap-1 whitespace-nowrap">
            {canReview && (s === 'pending' || s === 'rejected') && (
              <Button variant="ghost" size="sm" onClick={() => setApproving(r)}>Approve…</Button>
            )}
            {canReview && s === 'pending' && (
              <Button variant="ghost" size="sm" onClick={() => setRejecting([target(r)])}>Reject…</Button>
            )}
            {canReview && s === 'rejected' && (
              <Button variant="ghost" size="sm" onClick={() => setDeleting(target(r))}>Delete…</Button>
            )}
            {canManage && s === 'disabled' && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(`/admin/users/${r.user.id}/enable`)}>Enable</Button>
            )}
            {canManage && s === 'active' && (
              <Button variant="ghost" size="sm" onClick={() => setDisabling([r])}>Disable…</Button>
            )}
          </span>
        );
      },
    },
  ];

  const none = selected.size === 0;
  const seatWaiters = pending.filter((r) => !r.user.pendingReason || r.user.pendingReason === 'seats_exhausted');
  const others = pending.length - seatWaiters.length;

  return (
    <div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && <InfoBanner onDismiss={() => setNotice(null)}>{notice}</InfoBanner>}

      {pending.length > 0 && (
        <InfoBanner>
          {seatWaiters.length > 0 && (
            <>
              <b>{seatWaiters.length} {seatWaiters.length === 1 ? 'person is' : 'people are'} waiting for a seat.</b>{' '}
              They get in automatically at their next sign-in once a seat is free, or approve them now to choose a role.
              {' '}
            </>
          )}
          {others > 0 && (
            <>
              <b>{others} {others === 1 ? 'person is' : 'people are'} awaiting a decision.</b>{' '}
              Nobody joins until they are approved.
            </>
          )}
        </InfoBanner>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.user.id}
        loading={loading}
        csvName="members"
        noun="members"
        total={data?.total}
        onRowClick={(r) => router.push(`/users/${r.user.id}`)}
        filters={(
          <>
            <SearchInput
              placeholder="Search name or email"
              defaultValue={values.q}
              onSearch={(q) => set({ q })}
              aria-label="Search people"
            />
            <Select value={values.role} onChange={(e) => set({ role: e.target.value })} className="!w-auto" aria-label="Filter by role">
              <option value="">Any role</option>
              {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </Select>
            <Select value={values.status} onChange={(e) => set({ status: e.target.value })} className="!w-auto" aria-label="Filter by status">
              <option value="">Any status</option>
              {MEMBER_STATUSES.map((s) => <option key={s} value={s}>{memberStatusLabel(s)}</option>)}
            </Select>
            {activeFilterCount > 0 && <Button variant="ghost" onClick={reset}>Clear</Button>}
          </>
        )}
        toolbar={toolbar}
        selectable={canManage || canReview ? {
          selected,
          onChange: setSelected,
          actions: (
            <>
              {canReview && (
                <Button
                  size="sm"
                  disabled={none || busy || !selectedRows.some((r) => r.user.status === 'pending' || r.user.status === 'rejected')}
                  onClick={() => bulk('approved', selectedRows.filter((r) => r.user.status === 'pending' || r.user.status === 'rejected'),
                    (r) => api(`/admin/users/${r.user.id}/approve`, { method: 'POST', body: '{}' }))}
                >
                  {busy ? 'Working…' : 'Approve'}
                </Button>
              )}
              {canManage && (
                <Button size="sm" disabled={none || busy || !selectedRows.some((r) => r.user.status === 'active')}
                  onClick={() => setDisabling(selectedRows.filter((r) => r.user.status === 'active'))}>
                  Disable…
                </Button>
              )}
              {canManage && (
                <Button size="sm" disabled={none || busy} onClick={() => setChangingRole(selectedRows)}>Change role…</Button>
              )}
            </>
          ),
        } : undefined}
        empty={{
          title: activeFilterCount ? 'Nobody matches these filters' : 'Nobody here yet',
          body: activeFilterCount
            ? 'Clear a filter to widen the search.'
            : 'People appear the first time they sign in from the add-in with an email on one of this organisation’s domains.',
          action: activeFilterCount ? <Button variant="ghost" onClick={reset}>Clear filters</Button> : emptyAction,
        }}
        pagination={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={(p) => set({ page: p })} />}
      />

      <Note>
        A role change takes effect on the workstation at its next check, at most 24 hours, and with no sign-in.
        Moving somebody between roles frees one seat and takes another in the same step.
      </Note>

      <ApproveDialog
        open={approving !== null}
        target={approving ? { ...approving.user } : null}
        roles={roles}
        seats={seats}
        licenceActive={licenceActive}
        onClose={() => setApproving(null)}
        onApproved={() => { setApproving(null); changed(); }}
      />
      <RejectDialog
        targets={rejecting}
        onClose={() => setRejecting([])}
        onRejected={(failed) => {
          setRejecting([]);
          if (failed.length) setNotice(`Some could not be rejected: ${failed.join('; ')}`);
          changed();
        }}
      />
      <DeleteRequestDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => { setDeleting(null); changed(); }}
      />

      <DangerDialog
        open={disabling.length > 0}
        title={disabling.length > 1 ? `Disable ${disabling.length} people` : 'Disable person'}
        verb="disable"
        targetKind={disabling.length > 1 ? 'set of people' : 'person'}
        target={disabling.map((r) => r.user.email ?? r.user.id).join(', ')}
        consequence="Their next validation is denied with user_disabled and their add-in sessions are revoked, so re-enabling them means signing in again. It also frees their seat, which somebody else may take."
        confirmLabel={disabling.length > 1 ? 'Disable people' : 'Disable person'}
        onCancel={() => setDisabling([])}
        onConfirm={async (reason) => {
          const targets = disabling;
          setDisabling([]);
          await bulk('disabled', targets, (r) => api(`/admin/users/${r.user.id}/disable`, {
            method: 'POST', body: JSON.stringify({ reason }),
          }));
        }}
      />

      <ChangeRoleDialog
        targets={changingRole}
        roles={roles}
        seats={seats}
        busy={busy}
        onClose={() => setChangingRole([])}
        onSubmit={async (roleKey) => {
          const targets = changingRole;
          setChangingRole([]);
          await bulk('moved', targets, (r) => api(`/admin/users/${r.user.id}/role`, {
            method: 'POST', body: JSON.stringify({ roleKey }),
          }));
        }}
      />
    </div>
  );
}

/** One role for everyone selected. A full role is disabled before it is chosen. */
function ChangeRoleDialog({ targets, roles, seats, busy, onClose, onSubmit }: {
  targets: UserRow[];
  roles: RoleRow[];
  seats: SeatUsage[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (roleKey: string) => Promise<void>;
}) {
  const [roleKey, setRoleKey] = useState('');
  const open = targets.length > 0;

  useEffect(() => {
    if (open) setRoleKey(roles.find((r) => r.isDefault)?.key ?? roles[0]?.key ?? '');
  }, [open, roles]);

  const free = freeSeats(seats, roleKey);
  const wanted = targets.filter((r) => r.user.roleKey !== roleKey && r.user.status === 'active').length;
  const short = free !== null && wanted > free;

  return (
    <Modal
      open={open}
      title={targets.length === 1 ? 'Change role' : `Change role for ${targets.length} people`}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={busy || !roleKey || short} onClick={() => onSubmit(roleKey)}>
            {busy ? 'Working…' : 'Change role'}
          </Button>
        </>
      )}
    >
      <p className="text-meta text-ink-3 mb-4">{targets.map((r) => r.user.email ?? r.user.id).join(', ')}</p>
      <Field
        label="Role"
        hint={short
          ? `${roles.find((r) => r.key === roleKey)?.name ?? roleKey} has ${free} free, and ${wanted} would move into it.`
          : 'Frees a seat in the old role and takes one in the new. Applies at their next check.'}
      >
        <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
          {roles.filter((r) => r.isActive).map((r) => {
            const f = freeSeats(seats, r.key);
            return (
              <option key={r.key} value={r.key}>
                {r.name}{r.isDefault ? ' (default)' : ''}{f === null ? '' : f > 0 ? ` — ${f} free` : ' — full'}
              </option>
            );
          })}
        </Select>
      </Field>
    </Modal>
  );
}
