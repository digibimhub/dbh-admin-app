'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useUrlState } from '@/lib/useUrlState';
import { useCan } from '@/lib/session';
import type { AccessRequest, Organization, Paged, RoleRow, UserRow } from '@/lib/types';
import { DangerDialog } from '@/components/DangerDialog';
import { Modal } from '@/components/Modal';
import { Tabs } from '@/components/AppShell';
import { DataTable, PAGE_SIZE, Pagination, type Column } from '@/components/DataTable';
import {
  Avatar, Button, ErrorNote, Field, InfoBanner, Note, PageHeader, SearchInput, Select,
  StatusText, TimeAgo,
} from '@/components/ui';

const STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;

/**
 * The reasons the resolver records on a global request. `seats_exhausted` and
 * a missing licence are not among them: somebody in that state IS a member,
 * waiting, and shows on the Members waiting tab rather than here.
 */
const REASON_LABEL: Record<string, string> = {
  domain_not_registered: 'Email domain is not registered to any organisation',
  license_missing: 'That organisation has no active licence',
  email_not_verified: 'Autodesk email is not verified',
  pending_approval: 'No default role is set, so nobody can be provisioned',
};

/** Attempts at or above this are worth a bold number. */
const NAGGING = 5;

const FILTER_DEFAULTS = { tab: '', q: '', status: 'pending' };

/**
 * Two queues on one page. Access requests are people the resolver could not
 * place at all; Members waiting are people it placed who cannot get in yet —
 * across every organisation, so a portal admin sees which ones need a licence
 * or seats without opening each.
 */
export default function RequestsPage() {
  const { values, set } = useUrlState(FILTER_DEFAULTS);
  const waiting = values.tab === 'waiting';

  return (
    <div>
      <PageHeader title="Requests" />

      <Tabs
        items={[
          { href: '/requests', label: 'Access requests', active: !waiting },
          { href: '/requests?tab=waiting', label: 'Members waiting', active: waiting },
        ]}
      />

      {waiting
        ? <MembersWaiting q={values.q} onSearch={(q) => set({ q })} />
        : <AccessRequests status={values.status} q={values.q} onSet={(patch) => set(patch)} />}
    </div>
  );
}

/* --------------------------------------------------------- access requests */

function AccessRequests({ status, q, onSet }: {
  status: string; q: string; onSet: (patch: Partial<Record<'q' | 'status' | 'page', string | number>>) => void;
}) {
  const { page } = useUrlState(FILTER_DEFAULTS);
  const [data, setData] = useState<Paged<AccessRequest> | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<AccessRequest | null>(null);
  const [rejecting, setRejecting] = useState<AccessRequest | null>(null);

  const canReview = useCan('request.review');

  const load = useCallback(() => {
    setLoading(true);
    api<Paged<AccessRequest>>(`/admin/access-requests${qs({ status, q, page, pageSize: PAGE_SIZE })}`)
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [status, q, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api<Paged<Organization>>('/admin/orgs?pageSize=100').then((d) => setOrgs(d.rows)).catch(() => undefined);
    api<{ rows: RoleRow[] }>('/admin/roles').then((d) => setRoles(d.rows)).catch(() => undefined);
  }, []);

  const orgById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs]);
  const rows = data?.rows ?? [];
  const pending = status === 'pending';
  const filtered = status !== 'pending' || q !== '';

  const columns: Column<AccessRequest>[] = [
    {
      key: 'person',
      header: 'Person',
      cell: (r) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={r.displayName} email={r.email} />
          <div className="min-w-0">
            <div className="font-semibold text-ink truncate">{r.displayName ?? r.email}</div>
            {r.displayName && <div className="text-small text-ink-3 truncate">{r.email}</div>}
          </div>
        </div>
      ),
      csv: (r) => r.email,
    },
    {
      key: 'domain',
      header: 'Domain',
      cell: (r) => <span className="font-mono text-small">{r.emailDomain ?? '—'}</span>,
      csv: (r) => r.emailDomain ?? '',
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (r) => (
        <span className="block">
          <span className="text-ink-3">{REASON_LABEL[r.reason] ?? r.reason}</span>
          <span className="block font-mono text-micro text-ink-3">{r.reason}</span>
        </span>
      ),
      csv: (r) => r.reason,
    },
    {
      key: 'attempts',
      header: 'Attempts',
      className: 'text-right tabular-nums',
      headClassName: 'text-right',
      cell: (r) => <span className={r.attemptCount >= NAGGING ? 'font-bold text-ink' : 'text-ink-3'}>{r.attemptCount}</span>,
      csv: (r) => String(r.attemptCount),
    },
    {
      key: 'waiting',
      header: 'First seen',
      cell: (r) => <TimeAgo value={r.firstAttemptAt} className="text-ink-3" />,
      csv: (r) => r.firstAttemptAt,
    },
    {
      key: 'last',
      header: 'Last tried',
      optional: true,
      cell: (r) => <TimeAgo value={r.lastAttemptAt} className="text-ink-3" />,
      csv: (r) => r.lastAttemptAt,
    },
    {
      key: 'machine',
      header: 'Machine',
      optional: true,
      cell: (r) => (
        <span className="text-ink-3">
          {r.machineName ?? 'unknown'}{r.revitVersion ? ` · Revit ${r.revitVersion}` : ''}
        </span>
      ),
      csv: (r) => r.machineName ?? '',
    },
    {
      key: 'verified',
      header: 'Email',
      optional: true,
      cell: (r) => <span className={r.emailVerified ? 'text-ink-3' : 'text-ink font-semibold'}>{r.emailVerified ? 'Verified' : 'Unverified'}</span>,
      csv: (r) => (r.emailVerified ? 'verified' : 'unverified'),
    },
    {
      key: 'outcome',
      header: pending ? '' : 'Outcome',
      className: 'text-right',
      headClassName: 'text-right',
      cell: (r) => {
        if (r.status === 'pending') {
          return canReview
            ? <Button size="sm" onClick={() => setReviewing(r)}>Review</Button>
            : <span className="text-ink-3">—</span>;
        }
        const org = r.assignedOrgId ? orgById.get(r.assignedOrgId) : undefined;
        return (
          <span className="inline-flex items-center gap-2">
            <StatusText status={r.status} />
            {org && (
              <Link href={`/orgs/${org.id}`} className="text-link hover:underline text-small">
                {org.name}
              </Link>
            )}
          </span>
        );
      },
      csv: (r) => r.status,
    },
  ];

  return (
    <div>
      <h2 className="text-title font-bold text-ink mb-1">Access requests</h2>
      <p className="text-body text-ink-2 max-w-[65ch] mb-4">
        People whose email domain matches no organisation. Assign them, or reject.
      </p>

      {error && <ErrorNote>{error}</ErrorNote>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        csvName="access-requests"
        noun="requests"
        total={data?.total}
        flagRow={(r) => (r.status === 'pending' && r.attemptCount >= NAGGING ? `Blocked ${r.attemptCount} times` : null)}
        filters={(
          <>
            <SearchInput
              placeholder="Search email or domain"
              defaultValue={q}
              onSearch={(next) => onSet({ q: next })}
              aria-label="Search access requests"
            />
            <Select
              value={status}
              onChange={(e) => onSet({ status: e.target.value })}
              className="!w-auto"
              aria-label="Filter by status"
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s[0]!.toUpperCase()}{s.slice(1)}</option>)}
            </Select>
            {filtered && <Button variant="ghost" onClick={() => onSet({ q: '', status: 'pending' })}>Clear</Button>}
          </>
        )}
        empty={{
          title: pending ? 'Queue is empty' : `No ${status} requests`,
          body: pending
            ? 'A request appears when somebody signs in from the add-in on a domain no organisation has registered.'
            : 'Nothing has reached this state yet.',
          action: filtered ? <Button variant="ghost" onClick={() => onSet({ q: '', status: 'pending' })}>Clear filters</Button> : undefined,
        }}
        pagination={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={(p) => onSet({ page: p })} />}
      />

      <Note>Approving takes a seat in the chosen role, so a full role refuses.</Note>

      {reviewing && (
        <ReviewDialog
          request={reviewing}
          orgs={orgs}
          roles={roles}
          onClose={() => setReviewing(null)}
          onReject={() => { setRejecting(reviewing); setReviewing(null); }}
          onApproved={() => { setReviewing(null); load(); }}
        />
      )}

      {rejecting && (
        <DangerDialog
          open
          title="Reject access request"
          verb="reject"
          targetKind="access request"
          target={`${rejecting.email} · ${rejecting.machineName ?? 'unknown machine'}`}
          consequence="The person stays blocked and sees the same denial next time. The note is stored on the request."
          confirmLabel="Reject request"
          reasonLabel="Rejection note (stored on the request)"
          requireStepUp={false}
          onCancel={() => setRejecting(null)}
          onConfirm={async (note) => {
            await api(`/admin/access-requests/${rejecting.id}/reject`, {
              method: 'POST', body: JSON.stringify({ note }),
            });
            setRejecting(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/**
 * One decision, one dialog. The choices live here so they cannot outlive the
 * decision they belong to.
 */
function ReviewDialog({ request, orgs, roles, onClose, onReject, onApproved }: {
  request: AccessRequest;
  orgs: Organization[];
  roles: RoleRow[];
  onClose: () => void;
  onReject: () => void;
  onApproved: () => void;
}) {
  const [orgId, setOrgId] = useState('');
  const [roleKey, setRoleKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    if (!orgId) { setError('Choose an organisation first.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/access-requests/${request.id}/approve`, {
        method: 'POST', body: JSON.stringify({ orgId, roleKey: roleKey || undefined }),
      });
      onApproved();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Review access request"
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={onReject} disabled={busy}>Reject…</Button>
          <Button variant="primary" onClick={approve} disabled={busy || !orgId}>
            {busy ? 'Approving…' : 'Approve'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-2 text-body">
          <dt className="text-meta font-bold text-ink pt-0.5">Person</dt>
          <dd>
            {request.email}
            {request.displayName && <span className="text-ink-3"> · {request.displayName}</span>}
          </dd>
          <dt className="text-meta font-bold text-ink pt-0.5">Domain</dt>
          <dd className="font-mono text-small">{request.emailDomain ?? '—'}</dd>
          <dt className="text-meta font-bold text-ink pt-0.5">Reason</dt>
          <dd className="text-ink-2">{REASON_LABEL[request.reason] ?? request.reason}</dd>
          <dt className="text-meta font-bold text-ink pt-0.5">Machine</dt>
          <dd className="text-ink-2">
            {request.machineName ?? 'unknown'}
            {request.revitVersion ? ` · Revit ${request.revitVersion}` : ''}
          </dd>
          <dt className="text-meta font-bold text-ink pt-0.5">Attempts</dt>
          <dd className="text-ink-2 tabular-nums">
            {request.attemptCount}, first <TimeAgo value={request.firstAttemptAt} />
          </dd>
        </dl>

        {!request.emailVerified && (
          <InfoBanner className="!mb-0">Autodesk has not verified this address. Approving still creates the member.</InfoBanner>
        )}

        <Field label="Organisation">
          <Select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">Choose…</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>

        <Field label="Role" hint="Leave as the default unless they need something else.">
          <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
            <option value="">Default role</option>
            {roles.filter((r) => r.isActive).map((r) => (
              <option key={r.key} value={r.key}>{r.name}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------- members waiting */

/**
 * `GET /admin/users?status=pending` across every organisation. A row opens
 * that organisation's queue, where the approving happens.
 */
function MembersWaiting({ q, onSearch }: { q: string; onSearch: (q: string) => void }) {
  const router = useRouter();
  const { page, set } = useUrlState(FILTER_DEFAULTS);
  const [data, setData] = useState<Paged<UserRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api<Paged<UserRow>>(`/admin/users${qs({ status: 'pending', q, page, pageSize: PAGE_SIZE })}`)
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [q, page]);

  const rows = data?.rows ?? [];

  const columns: Column<UserRow>[] = [
    {
      key: 'person', header: 'Person',
      cell: (r) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={r.user.displayName} email={r.user.email} />
          <div className="min-w-0">
            <div className="font-semibold text-ink truncate">{r.user.displayName ?? r.user.email ?? '—'}</div>
            <div className="text-small text-ink-3 truncate">{r.user.email ?? 'no email on record'}</div>
          </div>
        </div>
      ),
      csv: (r) => `${r.user.displayName ?? ''} <${r.user.email ?? ''}>`,
    },
    { key: 'org', header: 'Organisation', cell: (r) => r.orgName, csv: (r) => r.orgName },
    {
      key: 'reason', header: 'Reason',
      cell: (r) => <StatusText status={r.user.status} reason={r.user.pendingReason} />,
      csv: (r) => r.user.pendingReason ?? r.user.status,
    },
    {
      key: 'attempts', header: 'Attempts', className: 'text-right tabular-nums', headClassName: 'text-right',
      cell: (r) => {
        const n = r.user.attemptCount;
        if (n === undefined) return <span className="text-ink-3">—</span>;
        return <span className={n >= NAGGING ? 'font-bold text-ink' : 'text-ink-3'}>{n}</span>;
      },
      csv: (r) => String(r.user.attemptCount ?? ''),
    },
    {
      key: 'requested', header: 'Requested',
      cell: (r) => <TimeAgo value={r.user.firstSeenAt} className="text-ink-3" />,
      csv: (r) => r.user.firstSeenAt,
    },
  ];

  return (
    <div>
      <h2 className="text-title font-bold text-ink mb-1">Members waiting</h2>
      <p className="text-body text-ink-2 max-w-[65ch] mb-4">
        Members of a known organisation who cannot get in yet. The organisation decides who is
        approved; you decide the licence and the seats.
      </p>

      {error && <ErrorNote>{error}</ErrorNote>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.user.id}
        loading={loading}
        csvName="members-waiting"
        noun="members waiting"
        total={data?.total}
        onRowClick={(r) => router.push(`/orgs/${r.user.orgId}/requests`)}
        filters={(
          <SearchInput
            placeholder="Search name or email"
            defaultValue={q}
            onSearch={onSearch}
            aria-label="Search waiting members"
          />
        )}
        empty={{
          title: q ? 'Nobody matches that search' : 'Nobody is waiting',
          body: q
            ? 'Clear the search to see everyone.'
            : 'A member waits here when their organisation asks for approval, when their role has no free seat, or while the organisation has no licence.',
        }}
        pagination={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={(p) => set({ page: p, tab: 'waiting', q })} />}
      />
    </div>
  );
}
