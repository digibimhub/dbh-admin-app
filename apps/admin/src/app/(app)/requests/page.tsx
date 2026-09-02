'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useUrlState } from '@/lib/useUrlState';
import { useCan } from '@/lib/session';
import { formatAbsolute } from '@/lib/format';
import type { AccessRequest, Organization, Paged, RoleRow } from '@/lib/types';
import { DangerDialog } from '@/components/DangerDialog';
import { Modal } from '@/components/Modal';
import { DataTable, PAGE_SIZE, Pagination, type Column } from '@/components/DataTable';
import {
  Button, ErrorNote, Field, Note, PageHeader, Pill, SEARCH_FIELD, Select,
  StatusPill, TextInput, TimeAgo,
} from '@/components/ui';

const STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;

/**
 * The four reasons the resolver can actually record. `seats_exhausted` is not
 * among them: somebody with no free seat IS a member, waiting, and shows up on
 * /users?status=pending rather than here.
 */
const REASON_LABEL: Record<string, string> = {
  domain_not_registered: 'Email domain is not registered to any organisation',
  license_missing: 'That organisation has no active licence',
  email_not_verified: 'Autodesk email is not verified',
  pending_approval: 'No default role is set, so nobody can be provisioned',
};

/** Attempts at or above this are worth surfacing as a flagged row. */
const NAGGING = 5;

const FILTER_DEFAULTS = { q: '', status: 'pending' };

/**
 * The queue, as a table.
 *
 * It used to be a stack of hand-rolled cards, each carrying its own
 * organisation and role `<select>` — so a 200-row queue mounted four hundred
 * of them, and none of what `DataTable` gives every other list (pagination,
 * search, CSV, a columns menu, flagged rows) was available. The decision moved
 * into a dialog: the table is for spotting who to act on, the dialog is for
 * acting.
 */
export default function RequestsPage() {
  const { values, set, page, reset, activeFilterCount } = useUrlState(FILTER_DEFAULTS);
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
    api<Paged<AccessRequest>>(`/admin/access-requests${qs({
      status: values.status, q: values.q, page, pageSize: PAGE_SIZE,
    })}`)
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [values.status, values.q, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api<Paged<Organization>>('/admin/orgs?pageSize=100').then((d) => setOrgs(d.rows)).catch(() => undefined);
    api<{ rows: RoleRow[] }>('/admin/roles').then((d) => setRoles(d.rows)).catch(() => undefined);
  }, []);

  const orgById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs]);
  const rows = data?.rows ?? [];
  const pending = values.status === 'pending';

  const columns: Column<AccessRequest>[] = [
    {
      key: 'person',
      header: 'Person',
      cell: (r) => (
        <>
          <p className="font-medium">{r.email}</p>
          {r.displayName && <p className="text-meta text-ink-3">{r.displayName}</p>}
        </>
      ),
      csv: (r) => r.email,
    },
    {
      key: 'domain',
      header: 'Domain',
      cell: (r) => <span className="font-mono text-meta">{r.emailDomain ?? '—'}</span>,
      csv: (r) => r.emailDomain ?? '',
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (r) => (
        <span title={REASON_LABEL[r.reason] ?? r.reason}>
          <Pill tone="warn">{r.reason}</Pill>
        </span>
      ),
      csv: (r) => r.reason,
    },
    {
      key: 'attempts',
      header: 'Attempts',
      className: 'text-right',
      headClassName: 'text-right',
      // A number that means act on this gets a pill; a first attempt is just a
      // number, which is the rule the organisations list already follows.
      cell: (r) => (r.attemptCount >= NAGGING
        ? <Pill tone="warn">{r.attemptCount}</Pill>
        : <span className="tabular-nums text-ink-3">{r.attemptCount}</span>),
      csv: (r) => String(r.attemptCount),
    },
    {
      key: 'waiting',
      header: 'Waiting since',
      cell: (r) => (
        <span title={formatAbsolute(r.firstAttemptAt)}>
          <TimeAgo value={r.firstAttemptAt} className="tabular-nums text-meta text-ink-2" />
        </span>
      ),
      csv: (r) => r.firstAttemptAt,
    },
    {
      key: 'last',
      header: 'Last tried',
      optional: true,
      cell: (r) => <TimeAgo value={r.lastAttemptAt} className="tabular-nums text-meta text-ink-2" />,
      csv: (r) => r.lastAttemptAt,
    },
    {
      key: 'machine',
      header: 'Machine',
      optional: true,
      cell: (r) => (
        <span className="text-meta">
          {r.machineName ?? 'unknown'}{r.revitVersion ? ` · Revit ${r.revitVersion}` : ''}
        </span>
      ),
      csv: (r) => r.machineName ?? '',
    },
    {
      key: 'verified',
      header: 'Email',
      optional: true,
      cell: (r) => (r.emailVerified
        ? <Pill tone="allow">verified</Pill>
        : <Pill tone="deny">unverified</Pill>),
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
            ? <Button onClick={() => setReviewing(r)}>Review</Button>
            : <span className="text-ink-3 text-meta">—</span>;
        }
        const org = r.assignedOrgId ? orgById.get(r.assignedOrgId) : undefined;
        return (
          <span className="inline-flex items-center gap-2">
            <StatusPill status={r.status} />
            {org && (
              <Link href={`/orgs/${org.id}`} className="text-signal hover:underline text-meta">
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
      <PageHeader
        eyebrow="Queue"
        title="Access requests"
        lede="People the add-in could not place in an organisation. Approving makes them a member and takes a seat."
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        csvName="access-requests"
        // Somebody on their fortieth blocked attempt looked exactly like a
        // first-timer before this.
        flagRow={(r) => (r.status === 'pending' && r.attemptCount >= NAGGING
          ? `Blocked ${r.attemptCount} times`
          : null)}
        filters={(
          <>
            <TextInput
              placeholder="Search email or domain"
              defaultValue={values.q}
              onKeyDown={(e) => { if (e.key === 'Enter') set({ q: (e.target as HTMLInputElement).value }); }}
              className={SEARCH_FIELD}
              aria-label="Search access requests"
            />
            <Select
              value={values.status}
              onChange={(e) => set({ status: e.target.value })}
              className="!w-auto"
              aria-label="Filter by status"
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            {activeFilterCount > 0 && <Button variant="ghost" onClick={reset}>Clear</Button>}
          </>
        )}
        empty={{
          title: pending ? 'Queue is empty' : `No ${values.status} requests`,
          body: pending
            ? 'A request appears when somebody signs in from the add-in on a domain no organisation has registered.'
            : 'Nothing has reached this state yet.',
          action: activeFilterCount ? <Button variant="ghost" onClick={reset}>Clear filters</Button> : undefined,
        }}
        pagination={(
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={data?.total ?? 0}
            onPage={(p) => set({ page: p })}
          />
        )}
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
 * One decision, one dialog.
 *
 * The choices used to live in two objects keyed by request id on the page,
 * which `load()` never cleared — so a reload left a stale organisation
 * selected against a row somebody else had already approved. Holding them here
 * means they cannot outlive the decision they belong to.
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
    <Modal open title="Review access request" onClose={onClose}>
      <div className="space-y-3">
        {error && <ErrorNote>{error}</ErrorNote>}

        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5 text-body">
          <dt className="text-micro uppercase tracking-[0.1em] text-ink-3 pt-0.5">Person</dt>
          <dd>
            {request.email}
            {request.displayName && <span className="text-ink-3"> · {request.displayName}</span>}
          </dd>
          <dt className="text-micro uppercase tracking-[0.1em] text-ink-3 pt-0.5">Domain</dt>
          <dd className="font-mono text-meta">{request.emailDomain ?? '—'}</dd>
          <dt className="text-micro uppercase tracking-[0.1em] text-ink-3 pt-0.5">Reason</dt>
          <dd className="text-meta">{REASON_LABEL[request.reason] ?? request.reason}</dd>
          <dt className="text-micro uppercase tracking-[0.1em] text-ink-3 pt-0.5">Machine</dt>
          <dd className="text-meta">
            {request.machineName ?? 'unknown'}
            {request.revitVersion ? ` · Revit ${request.revitVersion}` : ''}
          </dd>
          <dt className="text-micro uppercase tracking-[0.1em] text-ink-3 pt-0.5">Attempts</dt>
          <dd className="text-meta tabular-nums">
            {request.attemptCount}, first <TimeAgo value={request.firstAttemptAt} />
          </dd>
        </dl>

        {!request.emailVerified && (
          <p className="bg-warn-soft text-warn border border-warn/30 rounded-sm px-3 py-2 text-meta">
            Autodesk has not verified this address. Approving still creates the member.
          </p>
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

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={onReject}>Reject…</Button>
          <Button variant="primary" onClick={approve} disabled={busy || !orgId}>
            {busy ? 'Approving…' : 'Approve'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
