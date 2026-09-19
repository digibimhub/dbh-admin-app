'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useUrlState } from '@/lib/useUrlState';
import type { AuditEntry, AuditRow, Paged } from '@/lib/types';
import { DataTable, PAGE_SIZE, Pagination, type Column } from './DataTable';
import { Modal } from './Modal';
import { Button, ErrorNote, Field, Note, SearchInput, Select, TextInput, TimeAgo } from './ui';

const FILTER_DEFAULTS = { q: '', action: '', actor: '', from: '', to: '' };

/**
 * Actions worth a bold row: anything that took something away or changed a
 * privilege. Matching on the verb rather than a loose substring keeps it honest.
 */
const ATTENTION = /\.(disable|suspend|delete|reject|totp_reset|revoke|role_change)$/;

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
      org: orgId, q: values.q, action: values.action, actor: values.actor,
      from: values.from, to: values.to, page, pageSize: PAGE_SIZE,
    })}`)
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [orgId, values.q, values.action, values.actor, values.from, values.to, page]);

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
      cell: (r) => <TimeAgo value={r.entry.createdAt} className="text-ink-3" />,
      csv: (r) => r.entry.createdAt,
    },
    {
      key: 'actor', header: 'Actor',
      cell: (r) => r.entry.actorEmail ?? <span className="text-ink-3">{r.entry.actorType}</span>,
      csv: (r) => r.entry.actorEmail ?? r.entry.actorType,
    },
    {
      key: 'action', header: 'Action',
      cell: (r) => (
        <span className={`font-mono text-small ${ATTENTION.test(r.entry.action) ? 'font-bold text-ink' : 'text-ink-2'}`}>
          {r.entry.action}
        </span>
      ),
      csv: (r) => r.entry.action,
    },
    {
      key: 'target', header: 'Target',
      // The type alone said "org_user" on every row and identified nobody. The
      // id is what an operator pastes into a search or a support ticket.
      cell: (r) => (r.entry.targetType
        ? (
          <span className="text-ink-3">
            {r.entry.targetType}
            {r.entry.targetId && (
              <span className="block font-mono text-micro" title={r.entry.targetId}>
                {r.entry.targetId.slice(0, 8)}
              </span>
            )}
          </span>
        )
        : <span className="text-ink-3">—</span>),
      csv: (r) => [r.entry.targetType ?? '', r.entry.targetId ?? ''].filter(Boolean).join(' '),
    },
    ...(orgId ? [] : [{
      key: 'org', header: 'Organisation',
      cell: (r: AuditRow) => (r.entry.orgId
        ? <Link href={`/orgs/${r.entry.orgId}`} className="text-link hover:underline">{r.orgName ?? 'Open'}</Link>
        : <span className="text-ink-3">—</span>),
      csv: (r: AuditRow) => r.orgName ?? '',
    }]),
    {
      key: 'ip', header: 'IP', optional: true,
      cell: (r) => <span className="font-mono text-small text-ink-3">{r.entry.ip ?? '—'}</span>,
      csv: (r) => r.entry.ip ?? '',
    },
    {
      key: 'detail', header: '', className: 'text-right',
      cell: (r) => <Button variant="ghost" size="sm" onClick={() => setOpen(r.entry)}>Before / after</Button>,
    },
  ];

  return (
    <div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.entry.id)}
        loading={loading}
        csvName="audit-log"
        noun="entries"
        total={targetId ? undefined : data?.total}
        filters={(
          <>
            <SearchInput
              placeholder="Search actor or action"
              defaultValue={values.q}
              onSearch={(q) => set({ q })}
              aria-label="Search the audit log"
            />
            <Select value={values.action} onChange={(e) => set({ action: e.target.value })} className="!w-auto" aria-label="Filter by action">
              <option value="">Any action</option>
              {actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
            {activeFilterCount > 0 && <Button variant="ghost" onClick={reset}>Clear</Button>}
          </>
        )}
        moreFilters={(
          <>
            <Field label="From">
              <TextInput type="date" value={values.from} onChange={(e) => set({ from: e.target.value })} className="!w-auto" />
            </Field>
            <Field label="To">
              <TextInput type="date" value={values.to} onChange={(e) => set({ to: e.target.value })} className="!w-auto" />
            </Field>
            <Field label="Actor id">
              <TextInput
                placeholder="portal user uuid"
                defaultValue={values.actor}
                onKeyDown={(e) => { if (e.key === 'Enter') set({ actor: (e.target as HTMLInputElement).value }); }}
                className="!w-[320px] font-mono !text-small"
                aria-label="Filter by actor id"
              />
            </Field>
          </>
        )}
        activeFilterCount={[values.from, values.to, values.actor].filter(Boolean).length}
        empty={{
          title: activeFilterCount || targetId ? 'Nothing matches these filters' : 'No entries yet',
          body: activeFilterCount || targetId
            ? 'Widen the dates or clear the action to reach older entries.'
            : 'Every change made through the API is written here. An empty log means nothing has changed yet.',
          action: activeFilterCount ? <Button variant="ghost" onClick={reset}>Clear filters</Button> : undefined,
        }}
        pagination={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={(p) => set({ page: p })} />}
      />
      {targetId && (
        <Note>
          Narrowed to this record from the loaded page. The API has no target filter, so page through for older entries.
        </Note>
      )}

      <Modal open={!!open} title={open?.action ?? 'Audit entry'} onClose={() => setOpen(null)} wide>
        {open && (
          <div className="space-y-4">
            <p className="text-body text-ink-2">
              {open.actorEmail ?? open.actorType} · <TimeAgo value={open.createdAt} /> · {open.targetType ?? 'no target'}
              {open.ip && <> · <span className="font-mono text-small">{open.ip}</span></>}
            </p>
            <AuditDiff before={open.beforeState} after={open.afterState} />
          </div>
        )}
      </Modal>
    </div>
  );
}

// audit_log before/after are jsonb, so they arrive as unknown. Anything that is
// not a plain object has no fields to diff and falls through to the raw view.
type State = Record<string, unknown> | null;

function asState(v: unknown): State {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function render(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/**
 * What actually changed, rather than two JSON dumps to diff by eye. Keys that
 * did not change are folded away; the raw states stay one click below.
 */
function AuditDiff({ before: rawBefore, after: rawAfter }: { before: unknown; after: unknown }) {
  const before = asState(rawBefore);
  const after = asState(rawAfter);
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  const changed = keys.filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));

  if (!before && !after) {
    return <p className="text-body text-ink-3">This action recorded no before/after state.</p>;
  }

  return (
    <div className="space-y-4">
      {changed.length === 0 ? (
        <p className="text-body text-ink-3">No field changed value.</p>
      ) : (
        <table className="w-full text-small border-collapse">
          <thead>
            <tr className="text-left border-b border-ink/10">
              <th className="font-bold text-ink px-2 py-2">Field</th>
              <th className="font-bold text-ink px-2 py-2">Before</th>
              <th className="font-bold text-ink px-2 py-2">After</th>
            </tr>
          </thead>
          <tbody>
            {changed.map((k) => (
              <tr key={k} className="border-b border-rule last:border-0 align-top">
                <td className="px-2 py-2 font-mono text-ink whitespace-nowrap">{k}</td>
                <td className="px-2 py-2 font-mono text-ink-3 break-all line-through decoration-rule">{render(before?.[k])}</td>
                <td className="px-2 py-2 font-mono text-ink break-all">{render(after?.[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="text-small">
        <summary className="cursor-pointer text-ink-3 hover:text-ink">Raw before / after</summary>
        <div className="grid md:grid-cols-2 gap-4 mt-2">
          <div>
            <p className="text-label text-ink-2 mb-1">Before</p>
            <pre className="font-mono text-small bg-paper-2 border border-rule rounded-sm p-3 overflow-auto max-h-[320px]">
              {before ? JSON.stringify(before, null, 2) : '—'}
            </pre>
          </div>
          <div>
            <p className="text-label text-ink-2 mb-1">After</p>
            <pre className="font-mono text-small bg-paper-2 border border-rule rounded-sm p-3 overflow-auto max-h-[320px]">
              {after ? JSON.stringify(after, null, 2) : '—'}
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}
