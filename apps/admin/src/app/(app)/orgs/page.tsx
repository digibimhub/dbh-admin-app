'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useUrlState } from '@/lib/useUrlState';
import { useCan } from '@/lib/session';
import { daysUntil, formatDateOnly } from '@/lib/format';
import {
  MODE_LABEL, ORG_STATUSES,
  type OrgListRow, type Paged,
} from '@/lib/types';
import { DataTable, PAGE_SIZE, Pagination, type Column } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import {
  Button, ErrorNote, Field, Note, Pill, SEARCH_FIELD, Select, StatusPill, TextInput,
} from '@/components/ui';

const FILTER_DEFAULTS = { q: '', status: '' };

/** A pill only where the number means "act on this". */
function expiry(endDate: string | null) {
  if (!endDate) return <span className="text-ink-3">—</span>;
  const d = daysUntil(endDate);
  if (d === null) return <span className="text-ink-3">—</span>;
  if (d < 0) return <Pill tone="deny">{-d}d overdue</Pill>;
  if (d <= 30) return <Pill tone="warn">{d}d left</Pill>;
  return <span className="tabular-nums text-meta text-ink-2">{formatDateOnly(endDate)}</span>;
}

export default function OrgsPage() {
  const router = useRouter();
  const { values, set, page, reset, activeFilterCount } = useUrlState(FILTER_DEFAULTS);
  const [data, setData] = useState<Paged<OrgListRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const canCreate = useCan('org.create');

  const load = useCallback(() => {
    setLoading(true);
    api<Paged<OrgListRow>>(`/admin/orgs${qs({
      q: values.q, status: values.status, page, pageSize: PAGE_SIZE,
    })}`)
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [values.q, values.status, page]);

  useEffect(() => { load(); }, [load]);

  /*
   * Every column here is on the row the API returns. There is no second
   * request joined in the browser any more, and Seats and Awaiting — the two
   * numbers an operator actually acts on — were on neither the old list nor
   * its drawer.
   */
  const columns: Column<OrgListRow>[] = [
    {
      key: 'name', header: 'Name',
      /*
       * Bounded, or one row decides the width of the whole table.
       *
       * `truncate` is `white-space: nowrap` plus an ellipsis, and it only
       * ellipsises inside a box that already has a width. A name at the
       * schema maximum of 200 characters — with no spaces in it, so there is
       * nothing to wrap on — makes an auto-layout cell grow to fit, and every
       * other column is pushed out into the horizontal scroll. The name is
       * the one column worth spending width on, but not all of it.
       *
       * `title` because a truncated name is hidden information, and the full
       * value should still be readable without opening the row.
       */
      cell: (r) => (
        <div className="min-w-0 max-w-[22rem]">
          <div className="font-medium truncate" title={r.name}>{r.name}</div>
          <div className="font-mono text-micro text-ink-3 truncate" title={r.slug}>{r.slug}</div>
        </div>
      ),
      csv: (r) => `${r.name} (${r.slug})`,
    },
    {
      key: 'status', header: 'Status',
      cell: (r) => <StatusPill status={r.status} />,
      csv: (r) => r.status,
    },
    {
      key: 'mode', header: 'Licence',
      cell: (r) => (r.mode
        ? <span className="text-meta">{MODE_LABEL[r.mode]}</span>
        : <Pill tone="deny">none</Pill>),
      csv: (r) => r.mode ?? '',
    },
    {
      key: 'seats', header: 'Seats',
      className: 'text-right',
      headClassName: 'text-right',
      cell: (r) => {
        const full = r.totalSeats > 0 && r.activeUsers >= r.totalSeats;
        return (
          <span className={`tabular-nums text-meta ${full ? 'text-warn font-medium' : ''}`}>
            {r.activeUsers} / {r.totalSeats}
          </span>
        );
      },
      csv: (r) => `${r.activeUsers}/${r.totalSeats}`,
    },
    {
      key: 'pending', header: 'Awaiting',
      className: 'text-right',
      headClassName: 'text-right',
      cell: (r) => (r.pendingUsers > 0
        ? <Pill tone="warn">{r.pendingUsers}</Pill>
        : <span className="text-ink-3 tabular-nums text-meta">0</span>),
      csv: (r) => String(r.pendingUsers),
    },
    {
      key: 'ends', header: 'Licence ends',
      cell: (r) => expiry(r.licenseEnd),
      csv: (r) => r.licenseEnd ?? '',
    },
    {
      key: 'contact', header: 'Contact',
      optional: true,
      cell: (r) => (r.primaryContactEmail
        ? <span className="text-meta text-ink-2">{r.primaryContactEmail}</span>
        : <span className="text-ink-3">—</span>),
      csv: (r) => r.primaryContactEmail ?? '',
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <div>
          <h2 className="font-semibold text-page leading-tight tracking-tight">Organisations</h2>
          <p className="text-meta text-ink-3 mt-1 tabular-nums">
            {data ? `${data.total} customer${data.total === 1 ? '' : 's'}` : ' '}
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
            Add organisation
          </Button>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        csvName="organisations"
        // A click is a navigation. No drawer, no summary of the page you were
        // already on your way to.
        onRowClick={(r) => router.push(`/orgs/${r.id}`)}
        flagRow={(r) => (r.pendingUsers > 0 ? `${r.pendingUsers} waiting for a seat` : null)}
        filters={(
          <>
            <TextInput
              placeholder="Search name or slug"
              defaultValue={values.q}
              onKeyDown={(e) => { if (e.key === 'Enter') set({ q: (e.target as HTMLInputElement).value }); }}
              className={SEARCH_FIELD}
              aria-label="Search organisations"
            />
            <Select value={values.status} onChange={(e) => set({ status: e.target.value })} className="!w-auto" aria-label="Filter by status">
              <option value="">Any status</option>
              {ORG_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            {activeFilterCount > 0 && <Button variant="ghost" onClick={reset}>Clear</Button>}
          </>
        )}
        empty={{
          title: activeFilterCount ? 'No organisations match these filters' : 'No organisations yet',
          body: activeFilterCount
            ? 'Clear a filter to widen the search. The filters live in the URL, so this view can be shared.'
            : 'An organisation is the container for a licence, its domains and its people. Create the first one to start issuing licences.',
          action: activeFilterCount
            ? <Button variant="ghost" onClick={reset}>Clear filters</Button>
            : (canCreate ? <Button variant="primary" onClick={() => setCreating(true)}>Add organisation</Button> : undefined),
        }}
        pagination={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={(p) => set({ page: p })} />}
      />

      <CreateOrgDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => { setCreating(false); router.push(`/orgs/${id}`); }}
      />
    </div>
  );
}

function CreateOrgDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [contactEmail, setContactEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Opening is what clears it, not closing.
   *
   * The fields used to be reset only on a SUCCESSFUL create, so cancelling left
   * them behind and the next Add organisation opened on the abandoned draft —
   * including the error from a slug clash the operator had walked away from.
   * DangerDialog has always reset on open; these two dialogs disagreeing about
   * it was the bug.
   */
  useEffect(() => {
    if (!open) return;
    setName(''); setSlug(''); setSlugTouched(false);
    setContactEmail(''); setError(null); setBusy(false);
  }, [open]);

  function suggestSlug(value: string) {
    return value.toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { row } = await api<{ row: { id: string } }>('/admin/orgs', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          primaryContactEmail: contactEmail.trim() || undefined,
        }),
      });
      setName(''); setSlug(''); setSlugTouched(false); setContactEmail('');
      onCreated(row.id);
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Add organisation" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Name">
          <TextInput
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(suggestSlug(e.target.value));
            }}
            required
            minLength={2}
          />
        </Field>
        <Field label="Slug" hint="Lowercase, hyphen separated. Used in URLs and never changes.">
          <TextInput
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
            className="font-mono"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
        </Field>
        <Field label="Contact email" hint="Optional. Who to reach about renewals.">
          <TextInput type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </Field>
        <Note>
          It starts with no licence, so nobody can sign in yet. The Licence tab is the next step.
        </Note>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || name.trim().length < 2 || !slug}>
            {busy ? 'Creating…' : 'Create organisation'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
