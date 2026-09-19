'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { daysUntil, formatDateOnly, formatNumber } from '@/lib/format';
import { MODE_LABEL } from '@/lib/types';
import { useOrg } from '@/components/OrgContext';
import {
  Avatar, DefList, GoLink, InfoBanner, KpiStrip, PageHeader, Section, type KpiItem,
} from '@/components/ui';

const JOIN_HELP = {
  automatic: 'Anyone who signs in from a registered domain gets a seat straight away, if one is free.',
  approval: 'Anyone who signs in from a registered domain waits until you approve them.',
} as const;

/** The organisation admin's overview: their one organisation, and what only they can resolve. */
export default function OrgOverviewPage() {
  const { detail } = useOrg();
  const router = useRouter();
  const params = useSearchParams();
  const [denied, setDenied] = useState(params.get('denied'));

  const { org, license, counts, seats, domains } = detail;
  const remaining = license ? daysUntil(license.endDate) : null;
  const fullRoles = seats.filter((s) => s.seats > 0 && s.used >= s.seats);
  const policy = org.joinPolicy ?? 'automatic';
  const awaiting = counts.awaitingApproval ?? (policy === 'approval' ? counts.pending : 0);
  const onRoom = (counts.seatsExhausted ?? 0) + (counts.noLicence ?? 0);

  const kpis: KpiItem[] = [
    { label: 'Members', value: formatNumber(counts.users), link: { href: '/org/members', label: 'View members' } },
    {
      label: 'Awaiting',
      value: formatNumber(counts.pending),
      attention: counts.pending > 0,
      help: awaiting > 0 ? `${awaiting} awaiting your approval` : undefined,
      link: { href: '/org/requests', label: 'Review requests' },
    },
    {
      label: 'Seats',
      small: true,
      value: seats.length
        ? seats.map((s, i) => (
          <span key={s.roleKey}>
            {i > 0 && ' · '}{s.name} <b>{s.used} / {s.seats}</b>
          </span>
        ))
        : 'No licence',
      help: fullRoles.length
        ? `${fullRoles.map((s) => s.name).join(', ')} ${fullRoles.length === 1 ? 'is' : 'are'} full. Seats are set by DIGIBIM HUB.`
        : 'Seats are set by DIGIBIM HUB.',
    },
    { label: 'Devices', value: formatNumber(counts.devices), link: { href: '/org/devices', label: 'View devices' } },
    {
      label: 'Licence ends',
      small: true,
      value: license ? formatDateOnly(license.endDate) : 'No licence',
      help: remaining === null ? undefined : remaining < 0 ? `${-remaining} days overdue` : `${remaining} days`,
    },
  ];

  return (
    <div>
      {denied && (
        <InfoBanner onDismiss={() => { setDenied(null); router.replace('/org'); }}>
          That page is not part of your organisation. You have been brought back to its overview.
        </InfoBanner>
      )}

      <PageHeader
        variant="record"
        avatar={<Avatar name={org.name} size={48} />}
        title={org.name}
        subline={`${license ? `${MODE_LABEL[license.mode]} licence` : 'No licence'} · ${org.status === 'active' ? 'Active' : 'Suspended'} · joining by ${policy}`}
      />

      <KpiStrip items={kpis} />

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <Section title="Joining" note="Set by DIGIBIM HUB for your organisation.">
          <DefList
            items={[
              ['Policy', (
                <>
                  {policy === 'approval' ? 'Approval' : 'Automatic'}
                  <p className="text-meta text-ink-3">{JOIN_HELP[policy]}</p>
                </>
              )],
              ['Registered domains', domains.length ? domains.map((d) => d.value).join(', ') : <span className="text-ink-3">None yet</span>],
              ['Default role', seats.find((s) => s.roleKey === 'user')?.name ?? seats[0]?.name ?? '—'],
            ]}
          />
        </Section>

        <Section title="Needs attention" note="Things only you can resolve, and one you cannot.">
          {awaiting === 0 && onRoom === 0 && fullRoles.length === 0 ? (
            <p className="text-body text-ink-3">Nothing needs attention.</p>
          ) : (
            <ul>
              {awaiting > 0 && (
                <li className="flex items-center gap-4 py-3">
                  <div>
                    <b>{awaiting} {awaiting === 1 ? 'person is' : 'people are'} awaiting approval</b>
                    <p className="text-meta text-ink-3">Nobody joins until you approve them.</p>
                  </div>
                  <GoLink href="/org/requests" className="ml-auto whitespace-nowrap">Review requests</GoLink>
                </li>
              )}
              {onRoom > 0 && (
                <li className={`flex items-center gap-4 py-3 ${awaiting > 0 ? 'border-t border-rule' : ''}`}>
                  <div>
                    <b>{onRoom} {onRoom === 1 ? 'person is' : 'people are'} waiting on a seat or a licence</b>
                    <p className="text-meta text-ink-3">They get in automatically at their next sign-in once there is room, or approve them now.</p>
                  </div>
                  <GoLink href="/org/requests" className="ml-auto whitespace-nowrap">Review</GoLink>
                </li>
              )}
              {fullRoles.map((s) => (
                <li key={s.roleKey} className={`py-3 ${awaiting > 0 || onRoom > 0 ? 'border-t border-rule' : ''}`}>
                  <b>{s.name} has no free seat</b>
                  <p className="text-meta text-ink-3">Ask your account manager for more seats. Members cannot be moved into a full role.</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
