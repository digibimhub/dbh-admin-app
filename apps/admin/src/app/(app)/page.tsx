'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { daysUntil, formatDateOnly, formatNumber } from '@/lib/format';
import { MODE_LABEL, type Dashboard, type LicenseMode } from '@/lib/types';
import { ErrorNote, Loading, Pill, Section } from '@/components/ui';

/**
 * One number, with somewhere to go when it is not zero.
 *
 * Every tile here is counted live rather than read from a nightly rollup. The
 * rollup tables were computed every night and read by nothing; against this
 * estate the counts are milliseconds, and a number that is right now beats one
 * that was right at 01:00.
 */
function Tile({ label, value, href, tone, hint }: {
  label: string;
  value: number;
  href?: string;
  tone?: 'warn' | 'deny';
  hint?: string;
}) {
  // A tile carries the tone it would have when it matters; at zero it means the
  // opposite, so it recedes rather than shouting a coloured 0. The tone used to
  // be made undefined at zero by every call site, which just painted it as
  // ordinary ink and made a quiet 0 look exactly like a count worth reading.
  const quiet = tone !== undefined && value === 0;
  const body = (
    <>
      <p className="text-micro uppercase tracking-[0.12em] text-ink-3">{label}</p>
      <p className={`text-kpi font-semibold tabular-nums mt-1 ${
        quiet ? 'text-ink-3' : tone === 'deny' ? 'text-deny' : tone === 'warn' ? 'text-warn' : 'text-ink'
      }`}
      >
        {formatNumber(value)}
      </p>
      {hint && !quiet && <p className="text-meta text-ink-3 mt-0.5">{hint}</p>}
    </>
  );
  const cls = 'bg-card border border-rule rounded-md shadow-card px-4 py-3 block';
  return href
    ? <Link href={href} className={`${cls} hover:border-ink-3 transition-colors`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One request. The licences ending soon arrive with the counts rather than
  // from a second call that pulled the whole estate to filter four rows.
  useEffect(() => {
    api<Dashboard>('/admin/dashboard')
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading what="Loading dashboard" />;

  const modes = Object.entries(data.licenses.byMode) as [LicenseMode, number][];

  return (
    <div>
      <h2 className="font-semibold text-page leading-tight tracking-tight mb-4">Dashboard</h2>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 mb-5">
        <Tile label="Organisations" value={data.orgs.total} href="/orgs" />
        <Tile
          label="Suspended"
          value={data.orgs.suspended}
          tone="deny"
          href="/orgs?status=suspended"
        />
        <Tile label="Active people" value={data.people.active} href="/users" />
        <Tile
          label="Awaiting a seat"
          value={data.people.pending}
          tone="warn"
          href="/users?status=pending"
          hint="blocked right now"
        />
        <Tile
          label="Expiring in 30d"
          value={data.licenses.expiringSoon}
          tone="warn"
          href="/licenses?window=30"
        />
        <Tile
          label="Access requests"
          value={data.pendingRequests}
          tone="warn"
          href="/requests"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/*
          Over-cap is the roll-up of the seat rules, and the one row on this
          page that is unambiguously somebody's job today.
        */}
        <Section
          title="Roles over their seat count"
          note="Nobody is evicted — but this is what a renewal conversation is made of."
        >
          {data.overCap.length ? (
            <ul className="divide-y divide-rule -my-1">
              {data.overCap.map((r) => (
                <li key={`${r.id}-${r.role_name}`} className="py-2 flex items-baseline gap-2 flex-wrap">
                  <Link href={`/orgs/${r.id}/license`} className="font-medium text-signal hover:underline">
                    {r.name}
                  </Link>
                  <span className="text-meta text-ink-2">{r.role_name}</span>
                  <span className="ml-auto tabular-nums text-meta">
                    <b className="text-warn">{r.used}</b> / {r.seats}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-ink-3">Every role is within its seat count.</p>
          )}
        </Section>

        <Section title="Licences ending soon" note="Inside 30 days, active only.">
          {data.endingSoon.length ? (
            <ul className="divide-y divide-rule -my-1">
              {data.endingSoon.map((r) => {
                const left = daysUntil(r.endDate) ?? 0;
                return (
                  <li key={r.orgId} className="py-2 flex items-baseline gap-2 flex-wrap">
                    <Link href={`/orgs/${r.orgId}/license`} className="font-medium text-signal hover:underline">
                      {r.orgName}
                    </Link>
                    <span className="text-meta text-ink-3">{MODE_LABEL[r.mode]}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="tabular-nums text-meta text-ink-3">
                        {formatDateOnly(r.endDate)}
                      </span>
                      {/*
                        An active licence can already be past its end date — the
                        job that expires them runs at 02:00 — and this rendered
                        that as a negative day count.
                      */}
                      <Pill tone={left <= 7 ? 'deny' : 'warn'}>
                        {left < 0 ? `${-left}d overdue` : `${left}d`}
                      </Pill>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-body text-ink-3">Nothing ends in the next 30 days.</p>
          )}
        </Section>

        {/*
          Active-by-mode and the expired total are two different populations, and
          they sat in one row under one heading as though they summed.
        */}
        <Section title="Active licences by mode">
          <div className="flex flex-wrap gap-4">
            {modes.length ? modes.map(([mode, n]) => (
              <div key={mode}>
                <p className="text-micro uppercase tracking-[0.12em] text-ink-3">{MODE_LABEL[mode]}</p>
                <p className="text-title font-medium tabular-nums">{formatNumber(n)}</p>
              </div>
            )) : <p className="text-body text-ink-3">No active licences.</p>}
          </div>
          <p className="text-meta text-ink-3 mt-3 pt-3 border-t border-rule">
            <span className="tabular-nums">{formatNumber(data.licenses.expired)}</span> expired, not counted above.
          </p>
        </Section>

        <Section title="Estate">
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-micro uppercase tracking-[0.12em] text-ink-3">Active devices</p>
              <p className="text-title font-medium tabular-nums">{formatNumber(data.devices.active)}</p>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
