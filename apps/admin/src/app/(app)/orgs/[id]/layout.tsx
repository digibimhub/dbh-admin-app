'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { daysUntil, formatDateOnly, formatNumber } from '@/lib/format';
import { MODE_LABEL, type OrgDetail } from '@/lib/types';
import { useCan } from '@/lib/session';
import { Tabs } from '@/components/AppShell';
import { OrgProvider } from '@/components/OrgContext';
import { DangerDialog } from '@/components/DangerDialog';
import {
  Avatar, Button, ErrorNote, KpiStrip, Loading, PageHeader, TimeAgo, type KpiItem,
} from '@/components/ui';

/** "2 awaiting approval, 1 on a seat" — or nothing, when the API does not split the count yet. */
function awaitingHelp(counts: OrgDetail['counts']): string | undefined {
  const parts: string[] = [];
  if (counts.awaitingApproval) parts.push(`${counts.awaitingApproval} awaiting approval`);
  if (counts.seatsExhausted) parts.push(`${counts.seatsExhausted} on a seat`);
  if (counts.noLicence) parts.push(`${counts.noLicence} on a licence`);
  return parts.length ? parts.join(', ') : undefined;
}

export default function OrgLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suspending, setSuspending] = useState(false);

  const canSuspend = useCan('org.suspend');
  const canAdmins = useCan('org_admin.manage');

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
  const fullRoles = seats.filter((s) => s.seats > 0 && s.used >= s.seats).map((s) => s.name);

  const tabs = [
    { href: `/orgs/${id}`, label: 'Overview' },
    { href: `/orgs/${id}/domains`, label: 'Domains' },
    { href: `/orgs/${id}/license`, label: 'Licence' },
    { href: `/orgs/${id}/people`, label: 'People' },
    { href: `/orgs/${id}/requests`, label: 'Requests', badge: counts.pending },
    ...(canAdmins ? [{ href: `/orgs/${id}/admins`, label: 'Admins' }] : []),
  ];

  const kpis: KpiItem[] = [
    {
      label: 'Licence',
      value: license ? MODE_LABEL[license.mode] : 'None',
      small: true,
      help: license ? `ends ${formatDateOnly(license.endDate)}` : 'every sign-in is denied',
      link: { href: `/orgs/${id}/license`, label: license ? 'Manage licence' : 'Issue a licence' },
    },
    {
      label: 'Expires',
      value: remaining === null ? '—' : formatNumber(Math.abs(remaining)),
      help: remaining === null ? undefined : remaining < 0 ? 'days overdue, calendar date in UTC' : 'days, calendar date in UTC',
      attention: remaining !== null && remaining <= 30,
    },
    {
      label: 'Seats',
      value: `${formatNumber(usedSeats)} / ${formatNumber(totalSeats)}`,
      help: fullRoles.length ? `${fullRoles.join(', ')} ${fullRoles.length === 1 ? 'is' : 'are'} full` : undefined,
      link: { href: `/orgs/${id}/license`, label: 'Manage seats' },
    },
    {
      label: 'Awaiting',
      value: formatNumber(counts.pending),
      attention: counts.pending > 0,
      help: awaitingHelp(counts),
      link: { href: `/orgs/${id}/requests`, label: 'Review requests' },
    },
    {
      label: 'Devices',
      value: formatNumber(counts.devices),
      link: { href: `/devices?org=${id}`, label: 'View devices' },
    },
    {
      label: 'Last activity',
      value: <TimeAgo value={detail.lastActivityAt} />,
      small: true,
    },
  ];

  return (
    <OrgProvider value={{ detail, reload }}>
      <PageHeader
        variant="record"
        breadcrumb={[{ label: 'Organisations', href: '/orgs' }, { label: org.name }]}
        avatar={<Avatar name={org.name} size={48} />}
        title={org.name}
        subline={(
          <>
            {license ? `${MODE_LABEL[license.mode]} licence` : 'No licence'}
            {' · '}<span>{org.status}</span>
            {' · '}<span className="font-mono">{org.slug}</span>
          </>
        )}
        actions={(
          <>
            {canSuspend && org.status !== 'suspended' && (
              <Button onClick={() => setSuspending(true)}>Suspend…</Button>
            )}
            {canSuspend && org.status === 'suspended' && (
              <Button
                onClick={async () => {
                  await api(`/admin/orgs/${id}/reactivate`, { method: 'POST', body: '{}' })
                    .catch((e: unknown) => setError(errorMessage(e)));
                  reload();
                }}
              >
                Reactivate
              </Button>
            )}
          </>
        )}
      />

      <KpiStrip items={kpis} />

      <Tabs items={tabs} />

      {children}

      <DangerDialog
        open={suspending}
        title="Suspend organisation"
        verb="suspend"
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
