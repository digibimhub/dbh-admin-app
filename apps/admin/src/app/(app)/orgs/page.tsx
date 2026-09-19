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
  Avatar, Button, ErrorNote, Field, Note, PageHeader, SearchInput, Select, StatusText, TextInput,
  memberStatusLabel,
} from '@/components/ui';

const FILTER_DEFAULTS = { q: '', status: '' };

/** The date, and the days left in bold once it is worth acting on. */
function expiry(endDate: string | null) {
  if (!endDate) return <span className="text-ink-3">—</span>;
  const d = daysUntil(endDate);
  if (d === null) return <span className="text-ink-3">—</span>;
  return (
    <span className="tabular-nums">
      {formatDateOnly(endDate)}
      {d < 0 && <b className="text-ink"> · {-d} days overdue</b>}
      {d >= 0 && d <= 30 && <b className="text-ink"> · {d} days</b>}
    </span>
  );
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

  const columns: Column<OrgListRow>[] = [
    {
      key: 'name', header: 'Name',
      /*
       * Bounded, or one row decides the width of the whole table: `truncate`
       * only ellipsises inside a box that already has a width, and a name at
       * the schema maximum with no spaces has nothing to wrap on.
       */
      cell: (r) => (
        <div className="flex items-center gap-3 min-w-0 max-w-[24rem]">
          <Avatar name={r.name} />
          <div className="min-w-0">
            <div className="font-semibold text-ink truncate" title={r.name}>{r.name}</div>
            <div className="font-mono text-micro text-ink-3 truncate" title={r.slug}>{r.slug}</div>
          </div>
        </div>
      ),
      csv: (r) => `${r.name} (${r.slug})`,
    },
    {
      key: 'status', header: 'Status',
      cell: (r) => <StatusText status={r.status} />,
      csv: (r) => r.status,
    },
    {
      key: 'mode', header: 'Licence',
      cell: (r) => (r.mode ? MODE_LABEL[r.mode] : <b className="text-ink">No licence</b>),
      csv: (r) => r.mode ?? '',
    },
    {
      key: 'seats', header: 'Seats',
      cell: (r) => {
        const full = r.totalSeats > 0 && r.activeUsers >= r.totalSeats;
        return <span className={`tabular-nums ${full ? 'font-bold' : ''}`}>{r.activeUsers} / {r.totalSeats}</span>;
      },
      csv: (r) => `${r.activeUsers}/${r.totalSeats}`,
    },
    {
      key: 'pending', header: 'Awaiting',
      className: 'text-right tabular-nums',
      headClassName: 'text-right',
      cell: (r) => (r.pendingUsers > 0
        ? <b className="text-ink">{r.pendingUsers}</b>
        : <span className="text-ink-3">0</span>),
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
        ? <span className="text-ink-3">{r.primaryContactEmail}</span>
        : <span className="text-ink-3">—</span>),
      csv: (r) => r.primaryContactEmail ?? '',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Organisations"
        actions={canCreate && <Button variant="primary" onClick={() => setCreating(true)}>Add organisation…</Button>}
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        csvName="organisations"
        noun="customers"
        total={data?.total}
        // A click is a navigation. No drawer, no summary of the page you were
        // already on your way to.
        onRowClick={(r) => router.push(`/orgs/${r.id}`)}
        flagRow={(r) => (r.pendingUsers > 0 ? `${r.pendingUsers} waiting` : null)}
        filters={(
          <>
            <SearchInput
              placeholder="Search name or slug"
              defaultValue={values.q}
              onSearch={(q) => set({ q })}
              aria-label="Search organisations"
            />
            <Select value={values.status} onChange={(e) => set({ status: e.target.value })} className="!w-auto" aria-label="Filter by status">
              <option value="">Any status</option>
              {ORG_STATUSES.map((s) => <option key={s} value={s}>{memberStatusLabel(s)}</option>)}
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
            : (canCreate ? <Button variant="primary" onClick={() => setCreating(true)}>Add organisation…</Button> : undefined),
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

  // Opening is what clears it, not closing: cancelling must not leave the
  // abandoned draft, or its slug-clash error, for the next Add organisation.
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
      onCreated(row.id);
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Add organisation"
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form="create-org" disabled={busy || name.trim().length < 2 || !slug}>
            {busy ? 'Creating…' : 'Create organisation'}
          </Button>
        </>
      )}
    >
      <form id="create-org" onSubmit={submit} className="space-y-4">
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
        <Note>It starts with no licence, so nobody can sign in yet. The Licence tab is the next step.</Note>
      </form>
    </Modal>
  );
}
