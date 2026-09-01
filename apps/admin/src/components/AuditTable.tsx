'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useUrlState } from '@/lib/useUrlState';
import type { AuditEntry, AuditRow, Paged } from '@/lib/types';
import { DataTable, PAGE_SIZE, Pagination, type Column } from './DataTable';
import { Modal } from './Modal';
import { Button, ErrorNote, Field, Note, Pill, Select, TextInput, TimeAgo } from './ui';

const FILTER_DEFAULTS = { q: '', action: '', from: '', to: '' };

export function AuditTable({ orgId, targetId }: {
  orgId?: string;
  /** Narrows the loaded page to one target — the API has no target filter. */
  targetId?: string;
}) {
  const { values, set, page, reset, activeFilterCount } = useUrlState(FILTER_DEFAULTS);
  const [data, setData] = useState<Paged<AuditRow> | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AuditEntry | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<Paged<AuditRow>>(`/admin/audit-log${qs({
      org: orgId, q: values.q, action: values.action, from: values.from, to: values.to,
      page, pageSize: PAGE_SIZE,
    })}`)
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [orgId, values.q, values.action, values.from, values.to, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api<{ rows: string[] }>('/admin/audit-log/actions')
      .then((d) => setActions(d.rows))
      .catch(() => undefined);
  }, []);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    return targetId ? all.filter((r) => r.entry.targetId === targetId) : all;
  }, [data, targetId]);

  const columns: Column<AuditRow>[] = [
    {
      key: 'when', header: 'When',
      cell: (r) => <TimeAgo value={r.entry.createdAt} className="tabular-nums text-meta text-ink-2" />,
      csv: (r) => r.entry.createdAt,
    },
    {
      key: 'actor', header: 'Actor',
      cell: (r) => (
        <span className="text-body">
          {r.entry.actorEmail ?? <span className="text-ink-3">{r.entry.actorType}</span>}
        </span>
      ),
      csv: (r) => r.entry.actorEmail ?? r.entry.actorType,
    },
    {
      key: 'action', header: 'Action',
      cell: (r) => (
        <Pill tone={/(disable|suspend|delete|reject|reset|failed)/.test(r.entry.action) ? 'deny' : 'signal'}>
          {r.entry.action}
        </Pill>
      ),
      csv: (r) => r.entry.action,
    },
    {
      key: 'target', header: 'Target',
      cell: (r) => <span className="text-meta text-ink-2">{r.entry.targetType ?? '—'}</span>,
      csv: (r) => r.entry.targetType ?? '',
    },
    ...(orgId ? [] : [{
      key: 'org', header: 'Organisation',
      cell: (r: AuditRow) => (r.entry.orgId
        ? <Link href={`/orgs/${r.entry.orgId}`} className="text-signal hover:underline text-meta">{r.orgName ?? 'open'}</Link>
        : <span className="text-ink-3">—</span>),
      csv: (r: AuditRow) => r.orgName ?? '',
    }]),
    {
      key: 'ip', header: 'IP', optional: true,
      cell: (r) => <span className="font-mono text-meta text-ink-3">{r.entry.ip ?? '—'}</span>,
      csv: (r) => r.entry.ip ?? '',
    },
    {
      key: 'detail', header: '',
      cell: (r) => (
        <button onClick={() => setOpen(r.entry)} className="text-meta text-signal hover:underline">
          Before / after
        </button>
      ),
    },
  ];

  return (
    <div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-wrap items-end gap-2 mb-3">
        <TextInput
          placeholder="Search actor or action"
          defaultValue={values.q}
          onKeyDown={(e) => { if (e.key === 'Enter') set({ q: (e.target as HTMLInputElement).value }); }}
          className="!w-auto flex-1 min-w-[200px]"
          aria-label="Search the audit log"
        />
        <Select value={values.action} onChange={(e) => set({ action: e.target.value })} className="!w-auto" aria-label="Filter by action">
          <option value="">Any action</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
        <Field label="From">
          <TextInput type="date" value={values.from} onChange={(e) => set({ from: e.target.value })} className="!w-auto" />
        </Field>
        <Field label="To">
          <TextInput type="date" value={values.to} onChange={(e) => set({ to: e.target.value })} className="!w-auto" />
        </Field>
        {activeFilterCount > 0 && <Button variant="ghost" onClick={reset}>Clear</Button>}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.entry.id)}
        loading={loading}
        csvName="audit-log"
        empty={{
          title: activeFilterCount || targetId ? 'Nothing matches these filters' : 'No entries yet',
          body: activeFilterCount || targetId
            ? 'Every filter except the target is applied in SQL across the whole table, so widening the dates or clearing the action is the way to find an older entry.'
            : 'Every mutation through the API writes here with its before and after state. An empty log means nothing has been changed yet.',
          action: activeFilterCount ? <Button variant="ghost" onClick={reset}>Clear filters</Button> : undefined,
        }}
        pagination={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={(p) => set({ page: p })} />}
      />
      {targetId && (
        <Note>
          Narrowed to this record from the loaded page. The API filters by organisation, actor, action and date in
          SQL, but not by target id, so page through if you are looking for something older.
        </Note>
      )}

      <Modal open={!!open} title={open?.action ?? 'Audit entry'} onClose={() => setOpen(null)} wide>
        {open && (
          <div className="space-y-3">
            <p className="text-body text-ink-2">
              {open.actorEmail ?? open.actorType} · <TimeAgo value={open.createdAt} /> · {open.targetType ?? 'no target'}
              {open.ip && <> · <span className="font-mono text-meta">{open.ip}</span></>}
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <p className="text-micro uppercase tracking-[0.1em] text-ink-3 mb-1">Before</p>
                <pre className="font-mono text-meta bg-paper-2 border border-rule rounded-sm p-2 overflow-x-auto max-h-[320px]">
                  {open.beforeState ? JSON.stringify(open.beforeState, null, 2) : '—'}
                </pre>
              </div>
              <div>
                <p className="text-micro uppercase tracking-[0.1em] text-ink-3 mb-1">After</p>
                <pre className="font-mono text-meta bg-paper-2 border border-rule rounded-sm p-2 overflow-x-auto max-h-[320px]">
                  {open.afterState ? JSON.stringify(open.afterState, null, 2) : '—'}
                </pre>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
