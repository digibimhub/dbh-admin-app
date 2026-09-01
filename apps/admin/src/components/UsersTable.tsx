'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useUrlState } from '@/lib/useUrlState';
import {
  MEMBER_SOURCES, MEMBER_STATUSES, SOURCE_LABEL,
  type Organization, type Paged, type RoleRow, type UserRow,
} from '@/lib/types';
import { DataTable, PAGE_SIZE, Pagination, type Column } from './DataTable';
import {
  Button, ErrorNote, Note, Pill, Select, StatusPill, TextInput, TimeAgo,
} from './ui';

const FILTER_DEFAULTS = { q: '', org: '', role: '', status: '', source: '' };

/**
 * Everyone the platform knows about, across every organisation.
 *
 * A row click opens the person's page. The drawer this table used to show was
 * a summary of that page with a link to it — one click, two destinations —
 * and the controls it carried (role, enable, disable) belong on the People tab
 * of an organisation, where the seat counts they interact with are visible.
 */
export function UsersTable({ orgId, toolbar, reloadKey }: {
  /** When set the table is locked to one organisation and the org filter is hidden. */
  orgId?: string;
  toolbar?: ReactNode;
  reloadKey?: number;
}) {
  const router = useRouter();
  const { values, set, page, reset, activeFilterCount } = useUrlState(FILTER_DEFAULTS);
  const [data, setData] = useState<Paged<UserRow> | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const effectiveOrg = orgId ?? values.org;

  const load = useCallback(() => {
    setLoading(true);
    api<Paged<UserRow>>(`/admin/users${qs({
      q: values.q, org: effectiveOrg, role: values.role, status: values.status,
      source: values.source, page, pageSize: PAGE_SIZE,
    })}`)
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [values.q, values.role, values.status, values.source, effectiveOrg, page]);

  useEffect(() => { load(); }, [load, reloadKey]);

  useEffect(() => {
    api<{ rows: RoleRow[] }>('/admin/roles').then((d) => setRoles(d.rows)).catch(() => undefined);
    if (orgId) return;
    api<Paged<Organization>>('/admin/orgs?pageSize=100')
      .then((d) => setOrgs(d.rows))
      .catch(() => undefined);
  }, [orgId]);

  const rows = data?.rows ?? [];

  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.user.source, (counts.get(r.user.source) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const columns: Column<UserRow>[] = [
    {
      key: 'name', header: 'Name',
      // Bounded for the same reason as the organisation name: `truncate` only
      // ellipsises inside a box that has a width, so an unusually long name or
      // address would otherwise set the column width for every other row.
      cell: (r) => (
        <div className="min-w-0 max-w-[20rem]">
          <div className="font-medium truncate" title={r.user.displayName ?? r.user.email ?? undefined}>
            {r.user.displayName ?? r.user.email ?? '—'}
          </div>
          {r.user.displayName && r.user.email && (
            <div className="text-micro text-ink-3 truncate" title={r.user.email}>{r.user.email}</div>
          )}
        </div>
      ),
      csv: (r) => `${r.user.displayName ?? ''} ${r.user.email ?? ''}`.trim(),
    },
    ...(orgId ? [] : [{
      key: 'org', header: 'Organisation',
      cell: (r: UserRow) => <span className="text-meta">{r.orgName}</span>,
      csv: (r: UserRow) => r.orgName,
    }]),
    {
      key: 'role', header: 'Role',
      cell: (r) => <Pill tone="neutral">{r.roleName}</Pill>,
      csv: (r) => r.roleName,
    },
    {
      key: 'status', header: 'Status',
      cell: (r) => (r.user.status === 'pending'
        ? <Pill tone="warn" title="A seat was not free when they signed in">awaiting a seat</Pill>
        : <StatusPill status={r.user.status} />),
      csv: (r) => r.user.status,
    },
    {
      key: 'source', header: 'Source',
      optional: true,
      cell: (r) => <span className="text-meta text-ink-2">{SOURCE_LABEL[r.user.source] ?? r.user.source}</span>,
      csv: (r) => r.user.source,
    },
    {
      key: 'activity', header: 'Last activity',
      cell: (r) => <TimeAgo value={r.user.lastActivityAt} className="tabular-nums text-meta text-ink-2" />,
      csv: (r) => r.user.lastActivityAt ?? '',
    },
  ];

  const hiddenFilterCount = [values.role, values.source].filter(Boolean).length;

  return (
    <div>
      {error && <ErrorNote>{error}</ErrorNote>}

      {sourceCounts.length > 1 && (
        <p className="tabular-nums text-micro text-ink-3 mb-2">
          This page: {sourceCounts.map(([s, n]) => `${n} ${SOURCE_LABEL[s as keyof typeof SOURCE_LABEL] ?? s}`).join(' · ')}
        </p>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.user.id}
        loading={loading}
        csvName="users"
        onRowClick={(r) => router.push(`/users/${r.user.id}`)}
        flagRow={(r) => (r.user.status === 'pending' ? 'Waiting for a seat' : null)}
        filters={(
          <>
            <TextInput
              placeholder="Search name or email"
              defaultValue={values.q}
              onKeyDown={(e) => { if (e.key === 'Enter') set({ q: (e.target as HTMLInputElement).value }); }}
              className="!w-auto flex-1 min-w-[200px]"
              aria-label="Search users"
            />
            {!orgId && (
              <Select value={values.org} onChange={(e) => set({ org: e.target.value })} className="!w-auto" aria-label="Filter by organisation">
                <option value="">All organisations</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            )}
            <Select value={values.status} onChange={(e) => set({ status: e.target.value })} className="!w-auto" aria-label="Filter by status">
              <option value="">Any status</option>
              {MEMBER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            {activeFilterCount > 0 && <Button variant="ghost" onClick={reset}>Clear</Button>}
          </>
        )}
        moreFilters={(
          <>
            <Select value={values.role} onChange={(e) => set({ role: e.target.value })} className="!w-auto" aria-label="Filter by role">
              <option value="">Any role</option>
              {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </Select>
            <Select value={values.source} onChange={(e) => set({ source: e.target.value })} className="!w-auto" aria-label="Filter by source">
              <option value="">Any source</option>
              {MEMBER_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </Select>
          </>
        )}
        activeFilterCount={hiddenFilterCount}
        toolbar={toolbar}
        empty={{
          title: activeFilterCount ? 'No users match these filters' : 'No users yet',
          body: activeFilterCount
            ? 'Clear a filter to widen the search. Filters are held in the URL, so this view can be shared as-is.'
            : 'People appear here the first time somebody signs in from the add-in and resolves to an organisation, or when you add them manually or by CSV import.',
          action: activeFilterCount ? <Button variant="ghost" onClick={reset}>Clear filters</Button> : undefined,
        }}
        pagination={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={(p) => set({ page: p })} />}
      />
      <Note>
        Role and status are changed on an organisation&apos;s People tab, where the seat counts they
        consume are on screen. Both filters are applied by the API, so they narrow the whole set
        rather than the loaded page.
      </Note>
    </div>
  );
}
