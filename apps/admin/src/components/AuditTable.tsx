'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useUrlState } from '@/lib/useUrlState';
import type { AuditEntry, AuditRow, Paged } from '@/lib/types';
import { DataTable, PAGE_SIZE, Pagination, type Column } from './DataTable';
import { Modal } from './Modal';
import { Button, ErrorNote, Field, Note, Pill, SEARCH_FIELD, Select, TextInput, TimeAgo } from './ui';

const FILTER_DEFAULTS = { q: '', action: '', actor: '', from: '', to: '' };

/**
 * Actions whose tone is deny.
 *
 * The old regex included `failed`, which is never written, and let
 * `user.role_change` — a privilege change — render in the same neutral tone as
 * a rename. Matching on the verb rather than a loose substring keeps it honest.
 */
const DENY_ACTIONS = /\.(disable|suspend|delete|reject|totp_reset|revoke)$/;
const WARN_ACTIONS = /\.(role_change|update|import_commit|reactivate|resume|enable|approve)$/;

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
        <Pill tone={tone(r.entry.action)}>{r.entry.action}</Pill>
      ),
      csv: (r) => r.entry.action,
    },
    {
      key: 'target', header: 'Target',
      // The type alone said "org_user" on every row and identified nobody. The
      // id is what an operator pastes into a search or a support ticket.
      cell: (r) => (r.entry.targetType
        ? (
          <span className="text-meta text-ink-2">
            {r.entry.targetType}
            {r.entry.targetId && (
              <span className="block font-mono text-micro text-ink-3" title={r.entry.targetId}>
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

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.entry.id)}
        loading={loading}
        csvName="audit-log"
        filters={(
          <>
            <TextInput
              placeholder="Search actor or action"
              defaultValue={values.q}
              onKeyDown={(e) => { if (e.key === 'Enter') set({ q: (e.target as HTMLInputElement).value }); }}
              className={SEARCH_FIELD}
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
                className="!w-[300px] font-mono !text-meta"
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
          Narrowed to this record from the loaded page — the API has no target filter, so page through for older entries.
        </Note>
      )}

      <Modal open={!!open} title={open?.action ?? 'Audit entry'} onClose={() => setOpen(null)} wide>
        {open && (
          <div className="space-y-3">
            <p className="text-body text-ink-2">
              {open.actorEmail ?? open.actorType} · <TimeAgo value={open.createdAt} /> · {open.targetType ?? 'no target'}
              {open.ip && <> · <span className="font-mono text-meta">{open.ip}</span></>}
            </p>
            <AuditDiff before={open.beforeState} after={open.afterState} />
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Verb-based tone. See DENY_ACTIONS / WARN_ACTIONS above for why. */
function tone(action: string): 'deny' | 'warn' | 'signal' {
  if (DENY_ACTIONS.test(action)) return 'deny';
  if (WARN_ACTIONS.test(action)) return 'warn';
  return 'signal';
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
 * What actually changed, rather than two JSON dumps to diff by eye.
 *
 * The audit modal was the only place before/after state is visible anywhere in
 * the product, and it showed both objects whole — so finding the one field that
 * moved in a forty-key row meant reading both columns. Keys that did not change
 * are folded away; the raw states stay one click below for the cases where the
 * shape itself is the question.
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
    <div className="space-y-3">
      {changed.length === 0 ? (
        <p className="text-body text-ink-3">No field changed value.</p>
      ) : (
        <table className="w-full text-meta border-collapse">
          <thead>
            <tr className="text-left border-b border-rule bg-paper">
              <th className="text-micro font-medium uppercase tracking-[0.1em] text-ink-3 px-2 py-1.5">Field</th>
              <th className="text-micro font-medium uppercase tracking-[0.1em] text-ink-3 px-2 py-1.5">Before</th>
              <th className="text-micro font-medium uppercase tracking-[0.1em] text-ink-3 px-2 py-1.5">After</th>
            </tr>
          </thead>
          <tbody>
            {changed.map((k) => (
              <tr key={k} className="border-b border-rule last:border-0 align-top">
                <td className="px-2 py-1.5 font-mono text-ink-2 whitespace-nowrap">{k}</td>
                <td className="px-2 py-1.5 font-mono text-deny break-all">{render(before?.[k])}</td>
                <td className="px-2 py-1.5 font-mono text-allow break-all">{render(after?.[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="text-meta">
        <summary className="cursor-pointer text-ink-3 hover:text-ink">Raw before / after</summary>
        <div className="grid md:grid-cols-2 gap-3 mt-2">
          <div>
            <p className="text-micro uppercase tracking-[0.1em] text-ink-3 mb-1">Before</p>
            <pre className="font-mono text-meta bg-paper-2 border border-rule rounded-sm p-2 overflow-auto max-h-[320px]">
              {before ? JSON.stringify(before, null, 2) : '—'}
            </pre>
          </div>
          <div>
            <p className="text-micro uppercase tracking-[0.1em] text-ink-3 mb-1">After</p>
            <pre className="font-mono text-meta bg-paper-2 border border-rule rounded-sm p-2 overflow-auto max-h-[320px]">
              {after ? JSON.stringify(after, null, 2) : '—'}
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}
