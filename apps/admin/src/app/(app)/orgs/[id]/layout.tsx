'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { daysUntil, formatDateOnly, formatNumber } from '@/lib/format';
import { MODE_LABEL, type OrgDetail } from '@/lib/types';
import { useCan } from '@/lib/session';
import { Tabs } from '@/components/AppShell';
import { OrgProvider } from '@/components/OrgContext';
import { DangerDialog } from '@/components/DangerDialog';
import { Button, ErrorNote, Loading, StatusPill, TimeAgo } from '@/components/ui';

/** One label/value pair in the strip under the org name. */
function Stat({ label, value, title, tone }: {
  label: string; value: ReactNode; title?: string; tone?: 'warn' | 'deny';
}) {
  return (
    <div className="pr-7 mr-7 border-r border-rule last:border-r-0 last:mr-0 last:pr-0">
      <dt className="text-micro tracking-[0.12em] uppercase text-ink-3">{label}</dt>
      <dd
        title={title}
        className={`text-title font-medium tabular-nums mt-0.5 ${
          tone === 'deny' ? 'text-deny' : tone === 'warn' ? 'text-warn' : 'text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

export default function OrgLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suspending, setSuspending] = useState(false);

  const canSuspend = useCan('org.suspend');

  const reload = useCallback(() => {
    api<OrgDetail>(`/admin/orgs/${id}`)
      .then((d) => { setDetail(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => { reload(); }, [reload]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!detail) return <Loading what="Loading organisation" />;

  const { org, license, counts, seats } = detail;
  const remaining = license ? daysUntil(license.endDate) : null;
  const totalSeats = seats.reduce((n, s) => n + s.seats, 0);
  const usedSeats = seats.reduce((n, s) => n + s.used, 0);
  const anyFull = seats.some((s) => s.used >= s.seats);

  /**
   * Four tabs. Audit and Usage arrive in a later phase; showing them empty
   * would be worse than not showing them, because a tab that is always blank
   * teaches people to stop opening tabs.
   */
  const tabs = [
    { href: `/orgs/${id}`, label: 'Overview' },
    { href: `/orgs/${id}/domains`, label: 'Domains' },
    { href: `/orgs/${id}/license`, label: 'Licence' },
    { href: `/orgs/${id}/people`, label: 'People', badge: counts.pending },
  ];

  return (
    <OrgProvider value={{ detail, reload }}>
      {/*
        Header, stat strip and tabs are one block on `card`, so the boundary
        between chrome and content is a single rule rather than three.
      */}
      <div className="bg-card border border-rule rounded-md shadow-card mb-5">
        <div className="flex flex-wrap items-start gap-4 px-5 pt-4">
          <div className="min-w-0">
            <p className="text-meta text-ink-3 mb-1">
              <Link href="/orgs" className="text-signal hover:underline">Organisations</Link>
              <span className="mx-1.5">/</span>
              <span>{org.name}</span>
            </p>
            <h2 className="font-semibold text-page leading-tight tracking-tight flex items-center gap-2.5 flex-wrap">
              {org.name}
              <StatusPill status={org.status} />
              {/*
                The licence pill only when the licence needs attention. Two bare
                pills both reading "active" said "Acme Engineering ACTIVE ACTIVE"
                with nothing to tell them apart, and the stat strip right below
                already carries the mode and the expiry. A second pill here now
                always means look at this.
              */}
              {license && license.status !== 'active' && (
                <span className="inline-flex items-center gap-1.5 text-micro uppercase tracking-[0.08em] text-ink-3">
                  Licence
                  <StatusPill status={license.status} />
                </span>
              )}
            </h2>
            <p className="font-mono text-meta text-ink-3 mt-1">{org.slug}</p>
          </div>

          <div className="flex gap-2 ml-auto pt-6">
            {canSuspend && org.status !== 'suspended' && (
              <Button variant="danger" onClick={() => setSuspending(true)}>Suspend</Button>
            )}
            {canSuspend && org.status === 'suspended' && (
              <Button
                variant="secondary"
                onClick={async () => {
                  await api(`/admin/orgs/${id}/reactivate`, { method: 'POST', body: '{}' })
                    .catch((e: unknown) => setError(errorMessage(e)));
                  reload();
                }}
              >
                Reactivate
              </Button>
            )}
          </div>
        </div>

        <dl className="flex flex-wrap gap-y-3 px-5 py-4">
          <Stat
            label="Licence"
            value={license ? MODE_LABEL[license.mode] : 'none'}
            tone={license ? undefined : 'deny'}
            title={license ? undefined : 'Every validation is denied with license_missing'}
          />
          <Stat
            label="Expires"
            value={remaining === null
              ? '—'
              : remaining < 0 ? `${formatNumber(-remaining)}d overdue` : `${formatNumber(remaining)}d left`}
            title={license ? `Ends ${formatDateOnly(license.endDate)} — calendar date, UTC` : undefined}
            tone={remaining === null ? undefined : remaining < 0 ? 'deny' : remaining <= 30 ? 'warn' : undefined}
          />
          <Stat
            label="Seats"
            value={`${formatNumber(usedSeats)} / ${formatNumber(totalSeats)}`}
            tone={anyFull ? 'warn' : undefined}
            title={anyFull ? 'At least one role is full — the next sign-in for it lands pending' : undefined}
          />
          <Stat
            label="Awaiting a seat"
            value={formatNumber(counts.pending)}
            tone={counts.pending > 0 ? 'warn' : undefined}
          />
          <Stat label="Devices" value={formatNumber(counts.devices)} />
          <Stat
            label="Last activity"
            value={<TimeAgo value={detail.lastActivityAt} className="font-medium" />}
          />
        </dl>

        <Tabs items={tabs} flush />
      </div>

      {children}

      <DangerDialog
        open={suspending}
        title="Suspend organisation"
        targetKind="organisation"
        target={`${org.name} (${org.slug})`}
        consequence={`Every validation for this organisation is denied with org_suspended — ${formatNumber(counts.users)} people across ${formatNumber(counts.devices)} devices lose access at their next check. Their sessions stay valid, so reactivating restores them without anybody signing in again.`}
        confirmLabel="Suspend organisation"
        onCancel={() => setSuspending(false)}
        onConfirm={async (reason) => {
          await api(`/admin/orgs/${id}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) });
          setSuspending(false);
          reload();
        }}
      />
    </OrgProvider>
  );
}
