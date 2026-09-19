'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/session';
import type { PanelDefinition } from '@/lib/types';
import { DataTable, type Column } from '@/components/DataTable';
import { Button, ErrorNote, Field, FieldRow, Note, Section, TextInput, Toggle } from '@/components/ui';

export default function PanelsPage() {
  const canManage = useCan('panel.manage');
  const [rows, setRows] = useState<PanelDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<{ rows: PanelDefinition[] }>('/admin/panels')
      .then((d) => { setRows(d.rows); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/admin/panels', {
        method: 'POST',
        body: JSON.stringify({ slug, label, description: description || undefined, sortOrder: rows.length * 10 + 10 }),
      });
      setSlug(''); setLabel(''); setDescription('');
      load();
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(p: PanelDefinition, next: boolean) {
    try {
      await api(`/admin/panels/${p.slug}`, { method: 'PATCH', body: JSON.stringify({ isActive: next }) });
      load();
    } catch (err: unknown) {
      setError(errorMessage(err));
    }
  }

  const columns: Column<PanelDefinition>[] = [
    { key: 'slug', header: 'Slug', cell: (r) => <span className="font-mono text-small">{r.slug}</span>, csv: (r) => r.slug },
    { key: 'label', header: 'Label', cell: (r) => r.label, csv: (r) => r.label },
    {
      key: 'description', header: 'Description',
      cell: (r) => <span className="text-ink-3">{r.description ?? '—'}</span>,
      csv: (r) => r.description ?? '',
    },
    {
      key: 'order', header: 'Order', optional: true,
      cell: (r) => <span className="tabular-nums text-ink-3">{r.sortOrder}</span>,
      csv: (r) => String(r.sortOrder),
    },
    {
      key: 'active', header: 'Assignable',
      // A never-gated panel has no meaningful toggle: it is on every licence by
      // definition, and the API refuses to deactivate it. Say so instead.
      cell: (r) => {
        if (r.neverGated) {
          return <span className="text-ink-3" title="Carries About, Updates and Sign in">Always on</span>;
        }
        return canManage
          ? <Toggle checked={r.isActive} onChange={(next) => toggle(r, next)} label={`${r.slug} assignable`} />
          : <span className="text-ink-3">{r.isActive ? 'On' : 'Off'}</span>;
      },
      csv: (r) => (r.neverGated ? 'always' : String(r.isActive)),
    },
  ];

  return (
    <div className="space-y-6">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Section
        title="Panel catalog"
        note={
          <>
            These slugs are the contract with the shipped add-in. A licence assigns slugs to the user and admin roles,
            the token carries the resolved list, and the add-in only asks{' '}
            <code className="font-mono">HasPanel(&quot;cleanup&quot;)</code>. It never maps a role to visibility.
          </>
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.slug}
          loading={loading}
          csvName="panels"
          noun="panels"
          empty={{
            title: 'No panels defined',
            body: 'Until a slug exists here, no licence can assign a panel and the add-in ribbon stays empty. Add the slugs compiled into the current DLL.',
          }}
        />
        <Note>
          Never rename a slug that has shipped. It is compiled into installed add-ins, so renaming it
          removes that panel from every workstation in the field. Turn one off instead.
        </Note>
      </Section>

      {canManage && (
        <Section title="Add a panel">
          <form onSubmit={create} className="space-y-4">
            <FieldRow cols={3}>
              <Field label="Slug" hint="lowercase snake_case, matching the DLL constant.">
                <TextInput value={slug} onChange={(e) => setSlug(e.target.value)} className="font-mono" placeholder="coordination" required />
              </Field>
              <Field label="Label"><TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Coordination" required /></Field>
              <Field label="Description"><TextInput value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            </FieldRow>
            <Button variant="primary" type="submit" disabled={busy || !slug || !label}>
              {busy ? 'Adding…' : 'Add panel'}
            </Button>
          </form>
        </Section>
      )}
    </div>
  );
}
