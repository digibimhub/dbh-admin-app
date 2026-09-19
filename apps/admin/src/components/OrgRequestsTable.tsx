'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useUrlState } from '@/lib/useUrlState';
import { useCan } from '@/lib/session';
import { formatRelative } from '@/lib/format';
import type { JoinPolicy, OrgRequestRow, OrgRequestsResponse, RoleRow } from '@/lib/types';
import { Tabs } from './AppShell';
import { DataTable, PAGE_SIZE, Pagination, type Column } from './DataTable';
import { ApproveDialog } from './ApproveDialog';
import { DeleteRequestDialog, RejectDialog, type RequestTarget } from './RejectDialog';
import {
  Avatar, Button, ErrorNote, InfoBanner, MoreMenu, Note, SearchInput, StatusText, TimeAgo,
} from './ui';

const FILTER_DEFAULTS = { status: 'pending', q: '' };

/** Attempts at or above this are worth a bold number. */
const NAGGING = 5;

function personCell(r: OrgRequestRow) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <Avatar name={r.user.displayName} email={r.user.email} />
      <div className="min-w-0">
        <div className="font-semibold text-ink truncate">{r.user.displayName ?? r.user.email ?? '—'}</div>
        <div className="text-small text-ink-3 truncate">{r.user.email ?? 'no email on record'}</div>
      </div>
    </div>
  );
}

function target(r: OrgRequestRow): RequestTarget {
  return { id: r.user.id, email: r.user.email, displayName: r.user.displayName };
}

/**
 * One organisation's queue, shared by the portal admin's Requests tab and the
 * organisation admin's Requests page. Pending and Rejected are in-page tabs
 * backed by `?status=`, so a view can be shared.
 *
 * Data is `GET /admin/orgs/:id/requests`, which carries the seat usage and the
 * licence state so the Approve dialog needs no second call.
 */
export function OrgRequestsTable({ orgId, domains = [], joinPolicy, reloadKey, onChanged }: {
  orgId: string;
  domains?: string[];
  joinPolicy?: JoinPolicy;
  reloadKey?: number;
  onChanged?: () => void;
}) {
  const pathname = usePathname();
  const { values, set, page } = useUrlState(FILTER_DEFAULTS);
  const canReview = useCan('member.review');
  const canManageLicence = useCan('license.manage');

  const [data, setData] = useState<OrgRequestsResponse | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState<OrgRequestRow | null>(null);
  const [rejecting, setRejecting] = useState<RequestTarget[]>([]);
  const [deleting, setDeleting] = useState<RequestTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const status = values.status === 'rejected' ? 'rejected' : 'pending';

  const load = useCallback(() => {
    setLoading(true);
    api<OrgRequestsResponse>(`/admin/orgs/${orgId}/requests${qs({
      status, q: values.q, page, pageSize: PAGE_SIZE,
    })}`)
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [orgId, status, values.q, page]);

  useEffect(() => { load(); }, [load, tick, reloadKey]);
  useEffect(() => { setSelected(new Set()); }, [status, page]);
  useEffect(() => {
    api<{ rows: RoleRow[] }>('/admin/roles').then((d) => setRoles(d.rows)).catch(() => undefined);
  }, []);

  function changed() {
    setSelected(new Set());
    setTick((t) => t + 1);
    onChanged?.();
  }

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const counts = data?.counts;
  const pendingCount = counts ? counts.awaitingApproval + counts.seatsExhausted + counts.noLicence : undefined;
  const seats = data?.seats ?? [];
  const licenceActive = data?.licence?.active ?? true;

  /** Approve everyone selected into their current role; say who could not be. */
  async function bulkApprove() {
    const targets = rows.filter((r) => selected.has(r.user.id));
    if (!targets.length) return;
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const r of targets) {
      try {
        await api(`/admin/users/${r.user.id}/approve`, { method: 'POST', body: '{}' });
        ok += 1;
      } catch (e: unknown) {
        failed.push(`${r.user.email ?? r.user.id}: ${errorMessage(e)}`);
      }
    }
    setBusy(false);
    setNotice(failed.length
      ? `${ok} approved, ${failed.length} could not: ${failed.join('; ')}`
      : `${ok} approved.`);
    changed();
  }

  const waitingOnRoom = (counts?.seatsExhausted ?? 0) + (counts?.noLicence ?? 0);
  const banner = status === 'pending' && joinPolicy === 'automatic' && waitingOnRoom > 0
    ? (() => {
        const n = waitingOnRoom;
        const who = `${n} ${n === 1 ? 'person is' : 'people are'}`;
        const seatsOnly = (counts?.noLicence ?? 0) === 0;
        const licenceOnly = (counts?.seatsExhausted ?? 0) === 0;
        const on = seatsOnly ? 'waiting on a seat' : licenceOnly ? 'waiting on a licence' : 'waiting on seats or a licence';
        const when = seatsOnly ? 'once a seat is free' : licenceOnly ? 'once a licence is issued' : 'once there is room';
        const more = canManageLicence ? 'raise the count on the Licence tab' : 'ask your account manager for more seats';
        return `${who} ${on}. They get in automatically at their next sign-in ${when}. Approve them here to choose a different role, or ${more}.`;
      })()
    : null;

  const pendingColumns: Column<OrgRequestRow>[] = [
    { key: 'person', header: 'Person', cell: personCell, csv: (r) => `${r.user.displayName ?? ''} <${r.user.email ?? ''}>` },
    {
      key: 'requested', header: 'Requested',
      cell: (r) => (
        <span className="text-ink-3" title={r.user.lastAttemptAt ? `Last tried ${formatRelative(r.user.lastAttemptAt)}` : undefined}>
          <TimeAgo value={r.user.firstSeenAt} />
        </span>
      ),
      csv: (r) => r.user.firstSeenAt,
    },
    {
      key: 'attempts', header: 'Attempts', className: 'text-right tabular-nums', headClassName: 'text-right',
      cell: (r) => {
        const n = r.user.attemptCount ?? 0;
        return <span className={n >= NAGGING ? 'font-bold text-ink' : 'text-ink-3'}>{n}</span>;
      },
      csv: (r) => String(r.user.attemptCount ?? 0),
    },
    {
      key: 'reason', header: 'Reason',
      cell: (r) => <StatusText status={r.user.status} reason={r.user.pendingReason} />,
      csv: (r) => r.user.pendingReason ?? r.user.status,
    },
    {
      key: 'lastTried', header: 'Last tried', optional: true,
      cell: (r) => <TimeAgo value={r.user.lastAttemptAt} className="text-ink-3" />,
      csv: (r) => r.user.lastAttemptAt ?? '',
    },
    {
      key: 'actions', header: '', className: 'text-right',
      cell: (r) => (canReview ? (
        <span className="flex justify-end gap-1 whitespace-nowrap">
          <Button variant="ghost" size="sm" onClick={() => setApproving(r)}>Approve…</Button>
          <Button variant="ghost" size="sm" onClick={() => setRejecting([target(r)])}>Reject…</Button>
          <MoreMenu size="sm" items={[{ label: 'Delete…', onSelect: () => setDeleting(target(r)) }]} />
        </span>
      ) : null),
    },
  ];

  const rejectedColumns: Column<OrgRequestRow>[] = [
    { key: 'person', header: 'Person', cell: personCell, csv: (r) => `${r.user.displayName ?? ''} <${r.user.email ?? ''}>` },
    {
      key: 'rejected', header: 'Rejected',
      cell: (r) => <TimeAgo value={r.user.reviewedAt} className="text-ink-3" />,
      csv: (r) => r.user.reviewedAt ?? '',
    },
    { key: 'by', header: 'By', cell: (r) => <span className="text-ink-3">{r.reviewedByEmail ?? '—'}</span>, csv: (r) => r.reviewedByEmail ?? '' },
    {
      key: 'note', header: 'Note',
      cell: (r) => <span className="text-ink-3 max-w-[40ch] block truncate" title={r.user.reviewNote ?? undefined}>{r.user.reviewNote ?? '—'}</span>,
      csv: (r) => r.user.reviewNote ?? '',
    },
    {
      key: 'actions', header: '', className: 'text-right',
      cell: (r) => (canReview ? (
        <span className="flex justify-end gap-1 whitespace-nowrap">
          <Button variant="ghost" size="sm" onClick={() => setApproving(r)}>Approve…</Button>
          <Button variant="ghost" size="sm" onClick={() => setDeleting(target(r))}>Delete…</Button>
        </span>
      ) : null),
    },
  ];

  const domainList = domains.length ? domains.join(', ') : 'a registered domain';
  const none = selected.size === 0;

  return (
    <div>
      <Tabs
        ariaLabel="Request status"
        items={[
          { href: `${pathname}?status=pending`, label: 'Pending', badge: pendingCount, active: status === 'pending' },
          { href: `${pathname}?status=rejected`, label: 'Rejected', badge: counts?.rejected, active: status === 'rejected' },
        ]}
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && <InfoBanner onDismiss={() => setNotice(null)}>{notice}</InfoBanner>}
      {banner && <InfoBanner>{banner}</InfoBanner>}

      <DataTable
        columns={status === 'pending' ? pendingColumns : rejectedColumns}
        rows={rows}
        rowKey={(r) => r.user.id}
        loading={loading}
        csvName={`requests-${status}`}
        noun={status === 'pending' ? 'requests' : 'rejected'}
        total={data?.total ?? (status === 'pending' ? pendingCount : counts?.rejected) ?? rows.length}
        filters={(
          <SearchInput
            placeholder="Search name or email"
            defaultValue={values.q}
            onSearch={(q) => set({ q })}
            aria-label={status === 'pending' ? 'Search requests' : 'Search rejected requests'}
          />
        )}
        selectable={canReview && status === 'pending' ? {
          selected,
          onChange: setSelected,
          actions: (
            <>
              <Button size="sm" disabled={none || busy} onClick={bulkApprove}>{busy ? 'Approving…' : 'Approve'}</Button>
              <Button size="sm" disabled={none || busy} onClick={() => setRejecting(rows.filter((r) => selected.has(r.user.id)).map(target))}>
                Reject…
              </Button>
            </>
          ),
        } : undefined}
        empty={status === 'pending' ? {
          title: values.q ? 'Nobody matches that search' : 'Nobody is waiting',
          body: values.q
            ? 'Clear the search to see the whole queue.'
            : `People who sign in from ${domainList} appear here when joining is by approval, when their role has no free seat, or while the organisation has no licence.`,
        } : {
          title: values.q ? 'Nobody matches that search' : 'Nobody has been rejected',
          body: values.q
            ? 'Clear the search to see everyone.'
            : 'A rejected person stays here so they are told at their next sign-in and do not silently reappear.',
        }}
        pagination={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? rows.length} onPage={(p) => set({ page: p })} />}
      />

      {status === 'rejected' && (
        <Note>
          A rejected person sees &ldquo;Your request to join this organisation was declined&rdquo; each time they
          sign in. Approve to let them in after all; delete to forget the record, so their next sign-in starts a
          fresh request.
        </Note>
      )}

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
    </div>
  );
}
