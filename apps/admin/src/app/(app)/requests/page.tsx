'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useUrlState } from '@/lib/useUrlState';
import { useCan } from '@/lib/session';
import type { AccessRequest, Organization, Paged, RoleRow } from '@/lib/types';
import { DangerDialog } from '@/components/DangerDialog';
import {
  Button, EmptyState, ErrorNote, Loading, Note, PageHeader, Pill, Section, Select, TimeAgo,
} from '@/components/ui';

const STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;

const REASON_LABEL: Record<string, string> = {
  domain_not_registered: 'Email domain is not registered to any organisation',
  seats_exhausted: 'The licence had no free seat for their role',
  license_missing: 'That organisation has no active licence',
  email_not_verified: 'Autodesk email is not verified',
  pending_approval: 'Waiting for approval',
};

export default function RequestsPage() {
  const { values, set } = useUrlState({ status: 'pending' });
  const [rows, setRows] = useState<AccessRequest[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AccessRequest | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [roleChoice, setRoleChoice] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<RoleRow[]>([]);

  const canReview = useCan('request.review');

  const load = useCallback(() => {
    setLoading(true);
    api<{ rows: AccessRequest[] }>(`/admin/access-requests${qs({ status: values.status })}`)
      .then((d) => { setRows(d.rows); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [values.status]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api<Paged<Organization>>('/admin/orgs?pageSize=100').then((d) => setOrgs(d.rows)).catch(() => undefined);
    api<{ rows: RoleRow[] }>('/admin/roles').then((d) => setRoles(d.rows)).catch(() => undefined);
  }, []);

  const orgById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs]);

  async function approve(req: AccessRequest) {
    const orgId = choice[req.id] ?? '';
    if (!orgId) { setError('Choose an organisation before approving.'); return; }
    try {
      await api(`/admin/access-requests/${req.id}/approve`, {
        method: 'POST', body: JSON.stringify({ orgId, roleKey: roleChoice[req.id] || undefined }),
      });
      load();
    } catch (e: unknown) {
      setError(errorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Queue"
        title="Access requests"
        lede="Blocked add-in users land here instead of becoming support tickets. Approving writes an org_users row with source = approved_request; their next validation picks it up within 24 hours, or immediately if they press “Check access”."
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex gap-2 mb-4">
        <Select value={values.status} onChange={(e) => set({ status: e.target.value })} className="!w-auto" aria-label="Filter by status">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>

      {loading && <Loading what="Loading queue" />}

      {!loading && !rows.length && (
        <EmptyState title={values.status === 'pending' ? 'Queue is empty' : `No ${values.status} requests`}>
          {values.status === 'pending'
            ? 'A request appears when somebody signs in from the add-in and cannot be resolved to an organisation — an unregistered email domain, an ambiguous match, or auto-provisioning turned off.'
            : 'Nothing has reached this state yet.'}
        </EmptyState>
      )}

      <div className="space-y-3">
        {rows.map((r) => {
          const selected = choice[r.id] ?? '';
          return (
            <article key={r.id} className="bg-card border border-rule rounded-md p-4">
              <div className="flex flex-wrap justify-between gap-4">
                <div className="min-w-[260px]">
                  <p className="text-body font-medium">{r.email}</p>
                  {r.displayName && <p className="text-body text-ink-2">{r.displayName}</p>}
                  <p className="text-meta text-ink-3 mt-1">
                    {r.attemptCount} attempt{r.attemptCount === 1 ? '' : 's'} · <TimeAgo value={r.lastAttemptAt} />
                  </p>
                  <dl className="mt-2 text-meta space-y-0.5">
                    <div className="flex gap-2">
                      <dt className="text-ink-3 w-[76px] shrink-0">Machine</dt>
                      <dd>{r.machineName ?? 'unknown'}{r.revitVersion ? ` · Revit ${r.revitVersion}` : ''}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-ink-3 w-[76px] shrink-0">Domain</dt>
                      <dd className="font-mono">
                        {r.emailDomain ?? '—'}
                        <span className="text-ink-3"> (not registered to any organisation)</span>
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-ink-3 w-[76px] shrink-0">Reason</dt>
                      <dd>
                        <Pill tone="warn">{r.reason}</Pill>
                        <span className="block text-ink-3 mt-0.5">{REASON_LABEL[r.reason] ?? ''}</span>
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-ink-3 w-[76px] shrink-0">Verified</dt>
                      <dd>{r.emailVerified ? <Pill tone="allow">email verified</Pill> : <Pill tone="deny">email not verified</Pill>}</dd>
                    </div>
                  </dl>
                </div>

                {r.status === 'pending' && canReview && (
                  <div className="flex flex-col gap-2 min-w-[280px]">
                    <label className="block">
                      <span className="block text-micro uppercase tracking-[0.1em] text-ink-3 mb-1">
                        Assign to organisation
                      </span>
                      <Select
                        value={selected}
                        onChange={(e) => setChoice({ ...choice, [r.id]: e.target.value })}
                        aria-label={`Organisation for ${r.email}`}
                      >
                        <option value="">Choose…</option>
                        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </Select>
                    </label>
                    <label className="block">
                      <span className="block text-micro uppercase tracking-[0.1em] text-ink-3 mb-1">Role</span>
                      <Select
                        value={roleChoice[r.id] ?? ''}
                        onChange={(e) => setRoleChoice({ ...roleChoice, [r.id]: e.target.value })}
                        aria-label={`Role for ${r.email}`}
                      >
                        <option value="">Default role</option>
                        {roles.filter((x) => x.isActive).map((x) => (
                          <option key={x.key} value={x.key}>{x.name}</option>
                        ))}
                      </Select>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {/* Approving takes a seat, so it can fail with a message
                          naming the count -- which is the thing to act on. */}
                      <Button variant="primary" disabled={!selected} onClick={() => approve(r)}>Approve</Button>
                      <Button variant="danger" onClick={() => setRejecting(r)}>Reject</Button>
                    </div>
                  </div>
                )}

                {r.status !== 'pending' && (
                  <div className="text-meta text-ink-2 min-w-[220px]">
                    <p><Pill tone={r.status === 'approved' ? 'allow' : 'deny'}>{r.status}</Pill></p>
                    {r.assignedOrgId && (
                      <p className="mt-1">
                        Assigned to{' '}
                        <Link href={`/orgs/${r.assignedOrgId}`} className="text-signal hover:underline">
                          {orgById.get(r.assignedOrgId)?.name ?? r.assignedOrgId}
                        </Link>
                        {r.grantedRoleKey ? ` as ${r.grantedRoleKey}` : ''}
                      </p>
                    )}
                    {r.reviewNote && <p className="mt-1 text-ink-3">“{r.reviewNote}”</p>}
                    {r.reviewedAt && <p className="mt-1 text-ink-3"><TimeAgo value={r.reviewedAt} /></p>}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {rows.length > 0 && (
        <Section className="mt-4">
          <Note>
            The API returns the most recent 100 requests for the selected status. A request means the email
            domain is registered to nobody — a domain belongs to exactly one organisation, so there is no
            ambiguous match left to resolve. Approving consumes a seat in the chosen role.
          </Note>
        </Section>
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
