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
import { Button, ErrorNote, Note, Pill, Select, StatusPill, TextInput } from '@/components/ui';

type Row = { license: License; orgName: string; orgSlug: string };

const FILTER_DEFAULTS = { q: '', status: '', mode: '', window: '' };

/**
 * A pill only where the number means "act on this". Anything further out is
 * plain text, so the two pills a row can show — status and an imminent expiry —
 * still read as exceptions rather than decoration.
 */
function remaining(endDate: string) {
  const d = daysUntil(endDate);
  if (d === null) return <span className="text-ink-3">—</span>;
  if (d < 0) return <Pill tone="deny">{-d}d overdue</Pill>;
  if (d <= 7) return <Pill tone="deny">{d}d left</Pill>;
  if (d <= 30) return <Pill tone="warn">{d}d left</Pill>;
  return <span className="tabular-nums text-meta text-ink-3">{d}d left</span>;
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
        <div className="min-w-0">
          <div className="font-medium truncate">{r.orgName}</div>
          <div className="font-mono text-micro text-ink-3 truncate">{r.orgSlug}</div>
        </div>
      ),
      csv: (r) => `${r.orgName} (${r.orgSlug})`,
    },
    {
      key: 'mode', header: 'Mode',
      cell: (r) => <span className="text-meta">{MODE_LABEL[r.license.mode]}</span>,
      csv: (r) => r.license.mode,
    },
    {
      key: 'status', header: 'Status',
      cell: (r) => <StatusPill status={r.license.status} />,
      csv: (r) => r.license.status,
    },
    {
      key: 'ends', header: 'Ends',
      cell: (r) => <span className="tabular-nums text-meta">{formatDateOnly(r.license.endDate)}</span>,
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
      cell: (r) => <span className="tabular-nums text-meta">{r.license.graceDays}d</span>,
      csv: (r) => String(r.license.graceDays),
    },
  ];

  return (
    <div>
      <div className="mb-4">
        <h2 className="font-semibold text-page leading-tight tracking-tight">Licences</h2>
        <p className="text-meta text-ink-3 mt-1 tabular-nums">
          {filtered.length} licence{filtered.length === 1 ? '' : 's'}
        </p>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <DataTable
        columns={columns}
        rows={paged}
        rowKey={(r) => r.license.id}
        loading={loading}
        csvName="licences"
        // This screen is the queue. Everything is edited on the organisation's
        // own Licence tab, which is where a row takes you.
        onRowClick={(r) => router.push(`/orgs/${r.license.orgId}/license`)}
        flagRow={(r) => {
          const d = daysUntil(r.license.endDate);
          return d !== null && d <= 30 ? 'Expiring soon' : null;
        }}
        filters={(
          <>
            <TextInput
              placeholder="Search organisation"
              defaultValue={values.q}
              onKeyDown={(e) => { if (e.key === 'Enter') set({ q: (e.target as HTMLInputElement).value }); }}
              className="!w-auto flex-1 min-w-[200px]"
              aria-label="Search licences"
            />
            <Select value={values.status} onChange={(e) => set({ status: e.target.value })} className="!w-auto" aria-label="Filter by status">
              <option value="">Any status</option>
              {LICENSE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
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
            {activeFilterCount > 0 && <Button variant="ghost" onClick={reset}>Clear</Button>}
          </>
        )}
        empty={{
          title: activeFilterCount ? 'No licences match these filters' : 'No licences yet',
          body: activeFilterCount
            ? 'Clear a filter to widen the search.'
            : 'A licence is issued from an organisation’s Licence tab. Until one exists, nobody in that organisation can sign in — seats live on the licence.',
          action: activeFilterCount ? <Button variant="ghost" onClick={reset}>Clear filters</Button> : undefined,
        }}
        pagination={<Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={(p) => set({ page: p })} />}
      />
      <Note>
        {LICENSE_TZ_NOTE} This screen is the queue, not the editor — a row opens the
        organisation&apos;s Licence tab, where the term, the mode and the seats are changed.
      </Note>
    </div>
  );
}
