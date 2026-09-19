'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useCan, useScope, useSession } from '@/lib/session';
import type { OrgRequestsResponse } from '@/lib/types';
import { GlobalSearch } from './GlobalSearch';
import { ProfileMenu } from './ProfileMenu';
import { Pill } from './ui';

/**
 * The content column is 1440 px, centred.
 *
 * The cap was removed once, and rightly: at the time it was 1280 px beside a
 * 200 px rail, with 14 px tables, and a 1920 px display threw a third of
 * itself away. That is not the layout any more. At 16 px type and 81 px rows a
 * six-column table needs no more than 1440, and past that a row is wider than
 * an eye can scan from its checkbox to its chevron. The header stack spans
 * 1600 so the chrome reads as a band, and the content sits inside it.
 */
const GUTTER = 'px-[18px] lg:px-6';

const GLOBAL_NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/orgs', label: 'Organisations' },
  { href: '/users', label: 'Users' },
  { href: '/devices', label: 'Devices' },
  { href: '/requests', label: 'Requests' },
  { href: '/licenses', label: 'Licences' },
  { href: '/settings', label: 'Settings' },
];

const ORG_NAV = [
  { href: '/org', label: 'Overview' },
  { href: '/org/members', label: 'Members' },
  { href: '/org/requests', label: 'Requests' },
  { href: '/org/devices', label: 'Devices' },
  { href: '/org/activity', label: 'Activity' },
];

/**
 * How many people are waiting on somebody's decision.
 *
 * Counted once per mount and left alone: a poll would spend the /admin
 * rate-limit budget on every open tab to move a number nobody is watching in
 * real time. Globally it is the access-request queue; for an organisation
 * admin it is their own pending members.
 */
function usePendingCount(): number {
  const scope = useScope();
  const canReview = useCan('request.review');
  const canReviewMembers = useCan('member.review');
  const [n, setN] = useState(0);

  useEffect(() => {
    let live = true;
    if (scope.kind === 'org') {
      if (!canReviewMembers) return undefined;
      api<OrgRequestsResponse>(`/admin/orgs/${scope.orgId}/requests?status=pending&pageSize=1`)
        .then((d) => {
          if (!live) return;
          const c = d.counts;
          setN(d.total ?? (c ? c.awaitingApproval + c.seatsExhausted + c.noLicence : d.rows.length));
        })
        .catch(() => undefined);
    } else {
      if (!canReview) return undefined;
      api<{ total: number }>('/admin/access-requests?status=pending&pageSize=1')
        .then((d) => { if (live) setN(d.total ?? 0); })
        .catch(() => undefined);
    }
    return () => { live = false; };
  }, [scope, canReview, canReviewMembers]);

  return n;
}

function BellIcon() {
  return (
    <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/**
 * The Autodesk header stack: a 56 px black utility bar (wordmark, search,
 * bell, avatar) on a 48 px black nav row whose active item is a #262626 fill.
 * No sidebar. Everything below the 104 px is content.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const scope = useScope();
  const pending = usePendingCount();
  const path = usePathname();

  const org = scope.kind === 'org';
  const home = org ? '/org' : '/';
  const nav = org ? ORG_NAV : GLOBAL_NAV;
  const bellHref = org ? '/org/requests' : '/requests';

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-nav text-card">
        <div className={`mx-auto max-w-[1600px] h-14 ${GUTTER} flex items-center gap-6`}>
          <Link href={home} className="text-control font-extrabold whitespace-nowrap text-card">
            DIGIBIM HUB
            <span className="font-normal text-card/70 ml-2">Licensing</span>
          </Link>

          <GlobalSearch scope={scope} />

          <div className="flex-1" />

          <Link
            href={bellHref}
            aria-label={pending > 0 ? `${pending} pending requests` : 'Requests'}
            className="relative w-10 h-10 rounded-full grid place-items-center hover:bg-nav-active"
          >
            <BellIcon />
            {pending > 0 && (
              <Pill tone="count" className="absolute top-0.5 right-0 !bg-card !text-ink">{pending}</Pill>
            )}
          </Link>

          {user && <ProfileMenu user={user} scope={scope} />}
        </div>

        <nav aria-label="Primary" className="bg-nav">
          <NavBar items={nav} path={path} home={home} />
        </nav>
      </header>

      <main className={`flex-1 mx-auto w-full max-w-[1440px] ${GUTTER} py-6 pb-20`}>{children}</main>
    </div>
  );
}

/** The black nav row: 14/700 white, active item filled `nav-active`. */
function NavBar({ items, path, home }: {
  items: { href: string; label: string }[];
  path: string;
  home: string;
}) {
  return (
    <div className={`mx-auto max-w-[1600px] h-12 ${GUTTER} flex items-stretch overflow-x-auto [scrollbar-width:none]`}>
      {items.map((item) => {
        const on = item.href === home
          ? path === item.href
          : path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={`flex items-center px-4 text-small font-bold whitespace-nowrap text-card transition-colors ${
              on ? 'bg-nav-active' : 'hover:bg-card/10'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * In-page tabs: 48 px, 16/600 grey, the active one 700 black with a 2 px
 * black underline on a hairline rail. Used by the organisation record, the
 * settings section and the request queues.
 *
 * Items match by path prefix, except that a tab whose href is a prefix of a
 * sibling's must match exactly — the org strip is `/orgs/:id` plus
 * `/orgs/:id/{domains,…}`, so prefix matching lit Overview on every one. An
 * item may also carry `active` outright, for tabs that live in the query
 * string rather than the path.
 */
export function Tabs({ items, ariaLabel = 'Section', className = '' }: {
  items: { href: string; label: string; badge?: number; active?: boolean }[];
  ariaLabel?: string;
  className?: string;
}) {
  const path = usePathname();
  return (
    <nav aria-label={ariaLabel} className={`flex border-b border-rule mb-6 overflow-x-auto [scrollbar-width:none] ${className}`}>
      {items.map((item) => {
        const plain = item.href.split('?')[0] ?? item.href;
        const exact = items.some((o) => o.href !== item.href && (o.href.split('?')[0] ?? '').startsWith(`${plain}/`));
        const on = item.active !== undefined
          ? item.active
          : exact ? path === plain : path === plain || path.startsWith(`${plain}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={`flex items-center gap-2 h-12 px-4 -mb-px text-control whitespace-nowrap border-b-2 transition-colors ${
              on ? 'text-ink font-bold border-ink' : 'text-ink-3 font-semibold border-transparent hover:text-ink'
            }`}
          >
            {item.label}
            {item.badge !== undefined && item.badge > 0 && <Pill tone="count">{item.badge}</Pill>}
          </Link>
        );
      })}
    </nav>
  );
}
