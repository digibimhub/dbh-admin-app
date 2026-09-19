'use client';

import {
  useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode,
} from 'react';
import { downloadCsv, toCsv } from '@/lib/csv';
import { Button, EmptyState, TableSkeleton } from './ui';

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Value written to the CSV export. Defaults to nothing. */
  csv?: (row: T) => string;
  /** Hidden until the viewer turns it on in the columns menu. */
  optional?: boolean;
  className?: string;
  headClassName?: string;
};

export type Selectable = {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Bulk actions, rendered beside the count. Disable them yourself at zero selected. */
  actions?: ReactNode;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  /** Explains what would populate the table, per the spec's empty-state rule. */
  empty: { title: string; body: ReactNode; action?: ReactNode };
  csvName?: string;
  onRowClick?: (row: T) => void;
  /** Rows the operator should look at — the string becomes the row's title. */
  flagRow?: (row: T) => string | null;

  /** Search and the two or three filters worth permanent space. */
  filters?: ReactNode;
  /** The rest, behind `▽ Filter`. */
  moreFilters?: ReactNode;
  /** Badges the disclosure, so an active filter cannot hide inside it. */
  activeFilterCount?: number;
  /** Page-level actions — Add organisation, Import CSV — right of the toolbar. */
  toolbar?: ReactNode;
  /** Rendered as a footer row of this card rather than floating beneath it. */
  pagination?: ReactNode;

  /** Checkbox column plus a selection strip. */
  selectable?: Selectable;
  /** "3 customers" in the count strip. Plural form; singular is derived. */
  noun?: string;
  /** Server-side total for the count strip. Defaults to the rows on this page. */
  total?: number;
};

function singular(noun: string): string {
  if (noun.endsWith('ies')) return `${noun.slice(0, -3)}y`;
  if (noun.endsWith('s')) return noun.slice(0, -1);
  return noun;
}

/**
 * One card for every list: a toolbar strip (search and filters left, actions
 * right), a count strip (total, selection, bulk actions, the columns menu),
 * the table itself, and a pagination footer.
 */
export function DataTable<T>({
  columns, rows, rowKey, loading, empty, csvName, onRowClick, flagRow,
  filters, moreFilters, activeFilterCount = 0, toolbar, pagination,
  selectable, noun, total,
}: Props<T>) {
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.optional).map((c) => c.key)),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const allRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => columns.filter((c) => !hidden.has(c.key)), [columns, hidden]);

  // A dropdown that closes only by pressing its own trigger again follows the
  // pointer around the screen. Escape closes it too, for the keyboard path.
  useEffect(() => {
    if (!menuOpen) return undefined;
    function onDown(e: globalThis.MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const keys = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const selectedOnPage = selectable ? keys.filter((k) => selectable.selected.has(k)).length : 0;
  const allOnPage = keys.length > 0 && selectedOnPage === keys.length;

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = selectedOnPage > 0 && !allOnPage;
  }, [selectedOnPage, allOnPage]);

  function toggleColumn(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleRow(key: string) {
    if (!selectable) return;
    const next = new Set(selectable.selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    selectable.onChange(next);
  }

  function toggleAll() {
    if (!selectable) return;
    const next = new Set(selectable.selected);
    if (allOnPage) keys.forEach((k) => next.delete(k));
    else keys.forEach((k) => next.add(k));
    selectable.onChange(next);
  }

  function exportCsv() {
    const cols = visible.filter((c) => c.csv);
    const csv = toCsv(
      cols.map((c) => c.header),
      rows.map((r) => cols.map((c) => c.csv!(r))),
    );
    downloadCsv(`${csvName ?? 'export'}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    setMenuOpen(false);
  }

  // A row click is a navigation and nothing else. Clicks that land on a
  // control inside the row — a role select, an Approve button, the checkbox —
  // belong to that control, so they never navigate.
  const clickable = Boolean(onRowClick);
  function onRow(e: MouseEvent<HTMLTableRowElement>, row: T) {
    if (!onRowClick) return;
    const el = e.target as HTMLElement;
    if (el.closest('a,button,input,select,textarea,label')) return;
    onRowClick(row);
  }

  const hasToolbar = Boolean(filters || moreFilters || toolbar);
  const hasOptionalColumns = columns.some((c) => c.optional);
  const hasStrip = Boolean(noun || selectable || csvName || hasOptionalColumns);
  const count = total ?? rows.length;

  return (
    <div className="border border-rule rounded-md bg-card overflow-hidden">
      {hasToolbar && (
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-rule">
          {filters && <div className="flex flex-wrap items-center gap-3 min-w-0">{filters}</div>}

          {moreFilters && (
            <Button variant="ghost" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}>
              <span aria-hidden>▽</span> Filter
              {!moreOpen && activeFilterCount > 0 && (
                <span className="tabular-nums">({activeFilterCount})</span>
              )}
            </Button>
          )}

          {toolbar && <div className="flex flex-wrap items-center gap-3 ml-auto">{toolbar}</div>}
        </div>
      )}

      {moreFilters && moreOpen && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-rule bg-paper-2">
          {moreFilters}
        </div>
      )}

      {hasStrip && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-rule text-meta text-ink-3">
          {noun && (
            <span className="tabular-nums">{count} {count === 1 ? singular(noun) : noun}</span>
          )}
          {selectable && (
            <>
              {noun && <span aria-hidden>·</span>}
              <span className="tabular-nums text-ink font-semibold">{selectable.selected.size} selected</span>
              {selectable.actions && <div className="flex flex-wrap gap-2 ml-2">{selectable.actions}</div>}
            </>
          )}

          {(csvName || hasOptionalColumns || columns.length > 0) && (
            <div className="relative ml-auto" ref={menuRef}>
              <Button
                variant="link"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label="Table options"
              >
                <span aria-hidden>▥</span> Columns
              </Button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1 z-20 bg-card border border-rule rounded-sm p-2 shadow-pop min-w-[220px]"
                >
                  <p className="text-label text-ink-3 px-2 pb-1">Columns</p>
                  {columns.filter((c) => c.header).map((c) => (
                    <label
                      key={c.key}
                      className="flex items-center gap-2 text-small text-ink px-2 py-1.5 hover:bg-paper-2 rounded-sm cursor-pointer"
                    >
                      <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleColumn(c.key)} />
                      {c.header}
                    </label>
                  ))}
                  {csvName && (
                    <>
                      <div className="border-t border-rule my-1.5" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={exportCsv}
                        disabled={!rows.length}
                        className="w-full text-left text-small text-ink px-2 py-1.5 rounded-sm hover:bg-paper-2 disabled:opacity-40 disabled:pointer-events-none"
                      >
                        Export CSV
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {loading && <TableSkeleton cols={Math.min(visible.length, 5)} />}

      {!loading && !rows.length && (
        <EmptyState title={empty.title} action={empty.action}>{empty.body}</EmptyState>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-control text-ink border-collapse">
            <thead>
              <tr className="text-left border-b border-ink/10">
                {selectable && (
                  <th className="w-12 pl-4 pr-0 py-6">
                    <input
                      ref={allRef}
                      type="checkbox"
                      checked={allOnPage}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                )}
                {visible.map((c) => (
                  <th
                    key={c.key}
                    className={`font-bold px-4 py-6 whitespace-nowrap ${c.headClassName ?? ''}`}
                  >
                    {c.header}
                  </th>
                ))}
                {clickable && <th className="w-10 px-4 py-6" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = rowKey(row);
                const flag = flagRow?.(row) ?? null;
                const isSelected = selectable?.selected.has(key) ?? false;
                return (
                  <tr
                    key={key}
                    onClick={(e) => onRow(e, row)}
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={clickable ? (e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                        e.preventDefault();
                        onRowClick!(row);
                      }
                    } : undefined}
                    title={flag ?? undefined}
                    aria-selected={selectable ? isSelected : undefined}
                    className={`border-b border-rule last:border-0 align-middle ${
                      clickable ? 'cursor-pointer hover:bg-paper-2 focus-visible:bg-paper-2' : ''
                    } ${isSelected ? 'bg-paper-2' : ''}`}
                  >
                    {selectable && (
                      <td className="w-12 pl-4 pr-0 py-5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(key)}
                          aria-label="Select row"
                        />
                      </td>
                    )}
                    {visible.map((c) => (
                      <td key={c.key} className={`px-4 py-5 ${c.className ?? ''}`}>{c.cell(row)}</td>
                    ))}
                    {clickable && (
                      <td aria-hidden className="w-10 px-4 py-5 text-right text-ink-3 text-[20px] leading-none">›</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination && !loading && rows.length > 0 && (
        <div className="px-4 py-3 border-t border-rule">{pagination}</div>
      )}
    </div>
  );
}

/** Server-side pagination, 50 rows a page. */
export function Pagination({ page, pageSize, total, onPage }: {
  page: number; pageSize: number; total: number; onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="tabular-nums text-meta text-ink-3">{from}&#8211;{to} of {total}</p>
      <div className="flex gap-2 items-center">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export const PAGE_SIZE = 50;
