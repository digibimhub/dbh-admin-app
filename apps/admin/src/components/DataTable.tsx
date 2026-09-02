'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { downloadCsv, toCsv } from '@/lib/csv';
import { Button, EmptyState, Loading } from './ui';

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

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  /** Explains what would populate the table, per the spec's empty-state rule. */
  empty: { title: string; body: ReactNode; action?: ReactNode };
  csvName?: string;
  onRowClick?: (row: T) => void;
  /** Rows the operator should look at — rendered with a left rule. */
  flagRow?: (row: T) => string | null;

  /** The two or three filters worth permanent space. */
  filters?: ReactNode;
  /** The rest, behind a disclosure so they stop costing vertical space. */
  moreFilters?: ReactNode;
  /** Badges the disclosure, so an active filter cannot hide inside it. */
  activeFilterCount?: number;
  /** Page-level actions — Add organisation, Import CSV. */
  toolbar?: ReactNode;
  /** Rendered as a footer row of this card rather than floating beneath it. */
  pagination?: ReactNode;
};

export function DataTable<T>({
  columns, rows, rowKey, loading, empty, csvName, onRowClick, flagRow,
  filters, moreFilters, activeFilterCount = 0, toolbar, pagination,
}: Props<T>) {
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.optional).map((c) => c.key)),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => columns.filter((c) => !hidden.has(c.key)), [columns, hidden]);

  // A dropdown that closes only by pressing its own trigger again follows the
  // pointer around the screen. Escape closes it too, for the keyboard path.
  useEffect(() => {
    if (!menuOpen) return undefined;
    function onDown(e: MouseEvent) {
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

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
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

  // A row click is a navigation and nothing else. The drawer that used to
  // intercept it showed a summary and then offered a link to the page the
  // reader had already asked for — two destinations for one click, and the
  // detail it held (contact, plan, counts) now has a tab of its own.
  const activate = onRowClick;
  const clickable = Boolean(activate);

  const hasOptionalColumns = columns.some((c) => c.optional);
  const hasHeader = Boolean(
    filters || moreFilters || toolbar || csvName || hasOptionalColumns,
  );

  return (
    <div className="border border-rule rounded-md bg-card shadow-card">
      {hasHeader && (
        <div className="flex flex-wrap items-end gap-2 px-4 py-3 border-b border-rule">
          {filters && <div className="flex flex-wrap items-end gap-2 flex-1 min-w-0">{filters}</div>}

          {moreFilters && (
            <Button variant="ghost" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}>
              {moreOpen ? 'Fewer filters' : 'More filters'}
              {!moreOpen && activeFilterCount > 0 && (
                <span className="ml-1.5 tabular-nums text-micro bg-signal-soft text-signal rounded-sm px-1.5 py-0.5">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          )}

          {toolbar}

          <div className="relative ml-auto" ref={menuRef}>
            <Button
              variant="ghost"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Table options"
            >
              &#8943;
            </Button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-20 bg-card border border-rule rounded-md p-2 shadow-pop min-w-[210px]"
              >
                <p className="text-micro uppercase tracking-wider text-ink-3 px-1.5 pb-1">Columns</p>
                {columns.map((c) => (
                  <label
                    key={c.key}
                    className="flex items-center gap-2 text-body px-1.5 py-1 hover:bg-paper-2 rounded-sm cursor-pointer"
                  >
                    <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggle(c.key)} />
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
                      className="w-full text-left text-body px-1.5 py-1 rounded-sm hover:bg-paper-2 disabled:text-ink-3 disabled:hover:bg-transparent"
                    >
                      Export CSV
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {moreFilters && moreOpen && (
        <div className="flex flex-wrap items-end gap-2 px-4 py-3 border-b border-rule bg-paper">
          {moreFilters}
        </div>
      )}

      {loading && <div className="px-4 py-6"><Loading /></div>}

      {!loading && !rows.length && (
        <div className="p-4">
          <EmptyState title={empty.title} action={empty.action}>{empty.body}</EmptyState>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-body bg-card border-collapse">
            <thead>
              <tr className="text-left border-b border-rule bg-paper">
                {visible.map((c) => (
                  <th
                    key={c.key}
                    className={`text-micro font-medium uppercase tracking-[0.1em] text-ink-3 px-4 py-3 whitespace-nowrap ${c.headClassName ?? ''}`}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const flag = flagRow?.(row) ?? null;
                return (
                  <tr
                    key={rowKey(row)}
                    onClick={activate ? () => activate(row) : undefined}
                    // A drawer reachable only by mouse hides everything that
                    // moved into it from anyone navigating by keyboard.
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={clickable ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        activate!(row);
                      }
                    } : undefined}
                    title={flag ?? undefined}
                    className={`border-b border-rule last:border-0 align-middle ${
                      clickable ? 'cursor-pointer hover:bg-paper focus-visible:bg-paper' : ''
                    } ${flag ? 'border-l-2 border-l-warn' : ''}`}
                  >
                    {visible.map((c) => (
                      <td key={c.key} className={`px-4 py-3 ${c.className ?? ''}`}>{c.cell(row)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination && <div className="px-4 py-2.5 border-t border-rule">{pagination}</div>}

    </div>
  );
}

/** Server-side pagination, 50 rows a page. */
export function Pagination({ page, pageSize, total, onPage }: {
  page: number; pageSize: number; total: number; onPage: (page: number) => void;
}) {
  if (total <= pageSize) {
    return total > 0
      ? <p className="tabular-nums text-micro text-ink-3">{total} row{total === 1 ? '' : 's'}</p>
      : null;
  }
  const pages = Math.ceil(total / pageSize);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="tabular-nums text-micro text-ink-3">{from}&#8211;{to} of {total}</p>
      <div className="flex gap-2 items-center">
        <Button variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="tabular-nums text-micro text-ink-3">page {page} / {pages}</span>
        <Button variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export const PAGE_SIZE = 50;
