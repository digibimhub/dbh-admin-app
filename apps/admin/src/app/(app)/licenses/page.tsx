'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useUrlState } from '@/lib/useUrlState';
import { LICENSE_TZ_NOTE, daysUntil, formatDateOnly } from '@/lib/format';
import {
  LICENSE_MODES, LICENSE_STATUSES, MODE_LABEL, type License,
} from '@/lib/types';
import { DataTable, PAGE_SIZE, Pagination, type Column } from '@/components/DataTable';
import {
  Avatar, Button, ErrorNote, Note, PageHeader, SearchInput, Select, StatusText, memberStatusLabel,
} from '@/components/ui';

type Row = { license: License; orgName: string; orgSlug: string };

const FILTER_DEFAULTS = { q: '', status: '', mode: '', window: '' };

/** Bold once the number is worth acting on; plain text further out. */
function remaining(endDate: string) {
  const d = daysUntil(endDate);
  if (d === null) return <span className="text-ink-3">—</span>;
  if (d < 0) return <b className="text-ink tabular-nums">{-d} days overdue</b>;
  if (d <= 30) return <b className="text-ink tabular-nums">{d} days</b>;
  return <span className="tabular-nums text-ink-3">{d} days</span>;
}

export default function LicensesPage() {
  const router = useRouter();
  const { values, set, page, reset, activeFilterCount } = useUrlState(FILTER_DEFAULTS);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    // Status is the one filter the API takes; the rest are derived from the
    // same response, which is returned whole and already ordered by end date.
    api<{ rows: Row[] }>(`/admin/licenses${qs({ status: values.status })}`)
      .then((d) => { setRows(d.rows); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [values.status]);

  const filtered = useMemo(() => {
    let out = rows;
    if (values.q) {
      const q = values.q.toLowerCase();
      out = out.filter((r) => r.orgName.toLowerCase().includes(q) || r.orgSlug.includes(q));
    }
    if (values.mode) out = out.filter((r) => r.license.mode === values.mode);
    if (values.window) {
      const max = Number(values.window);
      out = out.filter((r) => {
        const d = daysUntil(r.license.endDate);
        return d !== null && d <= max;
      });
    }
    return out;
  }, [rows, values.q, values.mode, values.window]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns: Column<Row>[] = [
    {
      key: 'org', header: 'Organisation',
      cell: (r) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={r.orgName} />
          <div className="min-w-0">
            <div className="font-semibold text-ink truncate">{r.orgName}</div>
            <div className="font-mono text-micro text-ink-3 truncate">{r.orgSlug}</div>
          </div>
        </div>
      ),
      csv: (r) => `${r.orgName} (${r.orgSlug})`,
    },
    {
      key: 'mode', header: 'Mode',
      cell: (r) => MODE_LABEL[r.license.mode],
      csv: (r) => r.license.mode,
    },
    {
      key: 'status', header: 'Status',
      cell: (r) => <StatusText status={r.license.status} attention={r.license.status !== 'active'} />,
      csv: (r) => r.license.status,
    },
    {
      key: 'ends', header: 'Ends',
      cell: (r) => <span className="tabular-nums">{formatDateOnly(r.license.endDate)}</span>,
      csv: (r) => r.license.endDate,
    },
    {
      key: 'remaining', header: 'Remaining',
      cell: (r) => remaining(r.license.endDate),
      csv: (r) => String(daysUntil(r.license.endDate) ?? ''),
    },
    {
      key: 'grace', header: 'Grace',
      optional: true,
      cell: (r) => <span className="tabular-nums text-ink-3">{r.license.graceDays} days</span>,
      csv: (r) => String(r.license.graceDays),
    },
  ];

  return (
    <div>
      <PageHeader title="Licences" />

      {error && <ErrorNote>{error}</ErrorNote>}

      <DataTable
        columns={columns}
        rows={paged}
        rowKey={(r) => r.license.id}
        loading={loading}
        csvName="licences"
        noun="licences"
        total={filtered.length}
        // This screen is the queue. Everything is edited on the organisation's
        // own Licence tab, which is where a row takes you.
        onRowClick={(r) => router.push(`/orgs/${r.license.orgId}/license`)}
        flagRow={(r) => {
          const d = daysUntil(r.license.endDate);
          return d !== null && d <= 30 ? 'Ending soon' : null;
        }}
        filters={(
          <>
            <SearchInput
              placeholder="Search organisation"
              defaultValue={values.q}
              onSearch={(q) => set({ q })}
              aria-label="Search licences"
            />
            <Select value={values.status} onChange={(e) => set({ status: e.target.value })} className="!w-auto" aria-label="Filter by status">
              <option value="">Any status</option>
              {LICENSE_STATUSES.map((s) => <option key={s} value={s}>{memberStatusLabel(s)}</option>)}
            </Select>
            {activeFilterCount > 0 && <Button variant="ghost" onClick={reset}>Clear</Button>}
          </>
        )}
        moreFilters={(
          <>
            <Select value={values.mode} onChange={(e) => set({ mode: e.target.value })} className="!w-auto" aria-label="Filter by mode">
              <option value="">Any mode</option>
              {LICENSE_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </Select>
            <Select value={values.window} onChange={(e) => set({ window: e.target.value })} className="!w-auto" aria-label="Filter by expiry window">
              <option value="">Any end date</option>
              <option value="7">Ends within 7 days</option>
              <option value="30">Ends within 30 days</option>
              <option value="60">Ends within 60 days</option>
            </Select>
          </>
        )}
        activeFilterCount={[values.mode, values.window].filter(Boolean).length}
        empty={{
          title: activeFilterCount ? 'No licences match these filters' : 'No licences yet',
          body: activeFilterCount
            ? 'Clear a filter to widen the search.'
            : 'A licence is issued from an organisation’s Licence tab. Until one exists, nobody in that organisation can sign in. Seats live on the licence.',
          action: activeFilterCount ? <Button variant="ghost" onClick={reset}>Clear filters</Button> : undefined,
        }}
        pagination={<Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={(p) => set({ page: p })} />}
      />
      <Note>{LICENSE_TZ_NOTE}</Note>
    </div>
  );
}
