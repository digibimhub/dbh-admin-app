'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { daysUntil, formatDateOnly, formatNumber } from '@/lib/format';
import { useSession } from '@/lib/session';
import { MODE_LABEL, type Dashboard, type LicenseMode } from '@/lib/types';
import {
  ButtonLink, DefList, ErrorNote, GoLink, KpiStrip, Loading, PageHeader, Section,
} from '@/components/ui';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/**
 * Every number here is counted live rather than read from a nightly rollup.
 * The rollup tables were computed every night and read by nothing; against
 * this estate the counts are milliseconds, and a number that is right now
 * beats one that was right at 01:00.
 */
export default function DashboardPage() {
  const { user } = useSession();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Dashboard>('/admin/dashboard')
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading what="Loading dashboard" />;

  const firstName = user?.displayName?.trim().split(/\s+/)[0] || user?.email.split('@')[0] || 'there';
  const modes = Object.entries(data.licenses.byMode) as [LicenseMode, number][];
  const waiting = data.people.pending + data.pendingRequests;
  const soonest = data.endingSoon[0];
  const fresh = data.orgs.total === 0;

  const attention = [
    ...data.overCap.map((r) => ({
      key: `cap-${r.id}-${r.role_name}`,
      orgId: r.id,
      name: r.name,
      detail: `${r.role_name} is full, ${formatNumber(r.used)} of ${formatNumber(r.seats)}.`,
      href: `/orgs/${r.id}/license`,
      action: 'Manage seats',
      right: null as string | null,
    })),
    ...data.endingSoon.map((r) => {
      const left = daysUntil(r.endDate) ?? 0;
      return {
        key: `end-${r.orgId}`,
        orgId: r.orgId,
        name: r.orgName,
        detail: `${MODE_LABEL[r.mode]} licence ends ${formatDateOnly(r.endDate)}.`,
        href: `/orgs/${r.orgId}/license`,
        action: 'Manage licence',
        right: left < 0 ? `${-left} days overdue` : `${left} days`,
      };
    }),
  ];

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        actions={<ButtonLink href="/orgs" variant="primary">Add organisation…</ButtonLink>}
      />

      <KpiStrip
        items={[
          { label: 'Organisations', value: formatNumber(data.orgs.total), link: { href: '/orgs', label: 'View organisations' } },
          { label: 'Active people', value: formatNumber(data.people.active), link: { href: '/users', label: 'View people' } },
          {
            label: 'Awaiting',
            value: formatNumber(waiting),
            attention: waiting > 0,
            help: waiting > 0
              ? `${data.pendingRequests} access request${data.pendingRequests === 1 ? '' : 's'}, ${data.people.pending} member${data.people.pending === 1 ? '' : 's'} waiting`
              : undefined,
            link: { href: '/requests', label: 'Review requests' },
          },
          {
            label: 'Licences ending in 30 days',
            value: formatNumber(data.licenses.expiringSoon),
            help: soonest ? `${soonest.orgName}, ${daysUntil(soonest.endDate) ?? 0} days` : undefined,
            link: { href: '/licenses?window=30', label: 'View licences' },
          },
          { label: 'Active devices', value: formatNumber(data.devices.active), link: { href: '/devices', label: 'View devices' } },
          { label: 'Suspended organisations', value: formatNumber(data.orgs.suspended), link: { href: '/orgs?status=suspended', label: 'View' } },
        ]}
      />

      {fresh && (
        <Section title="Get started" note="Three steps before anyone can sign in from Revit." className="mb-6">
          <ul>
            {[
              ['Add an organisation', 'A customer is an organisation. Domains, the licence and every person hang off it.', '/orgs', 'Add organisation'],
              ['Register a domain', 'People sign in with their work email. The domain decides which organisation they join.', '/orgs', 'Register a domain'],
              ['Issue a licence', 'Seats live on the licence, per role. Without one nobody gets a seat.', '/orgs', 'Issue a licence'],
            ].map(([label, detail, href, go], i) => (
              <li key={label} className={`flex gap-3 py-2.5 ${i > 0 ? 'border-t border-rule' : ''}`}>
                <span aria-hidden className="w-6 shrink-0 font-bold text-ink-3">–</span>
                <div>
                  <span className="text-ink">{label}</span>{' '}
                  <GoLink href={href!}>{go}</GoLink>
                  <p className="text-meta text-ink-3">{detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <Section
          title="Needs attention"
          note="Roles over their seat count and licences ending inside 30 days."
        >
          {attention.length ? (
            <ul>
              {attention.map((a, i) => (
                <li key={a.key} className={`flex items-center gap-4 py-3 ${i > 0 ? 'border-t border-rule' : ''}`}>
                  <div className="min-w-0">
                    <Link href={`/orgs/${a.orgId}`} className="font-bold text-ink hover:text-link">{a.name}</Link>
                    <p className="text-meta text-ink-3">{a.detail}</p>
                  </div>
                  {a.right
                    ? <span className="ml-auto font-bold text-ink tabular-nums whitespace-nowrap">{a.right}</span>
                    : <GoLink href={a.href} className="ml-auto whitespace-nowrap">{a.action}</GoLink>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-ink-3">Nothing needs attention. Every role is within its seat count and no licence ends in the next 30 days.</p>
          )}
        </Section>

        <Section title="Active licences by mode" note="Expired licences are not counted.">
          <DefList
            items={[
              ...modes.map(([mode, n]) => [MODE_LABEL[mode], formatNumber(n)] as [string, string]),
              ['Expired', formatNumber(data.licenses.expired)],
            ]}
          />
          {!modes.length && <p className="text-body text-ink-3 mt-3">No active licences.</p>}
        </Section>
      </div>
    </div>
  );
}
