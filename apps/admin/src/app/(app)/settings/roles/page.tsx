'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/session';
import type { RoleRow } from '@/lib/types';
import { Modal } from '@/components/Modal';
import { DataTable, type Column } from '@/components/DataTable';
import {
  Button, ErrorNote, Field, FieldRow, Loading, Note, Pill, Section,
  TextInput, Toggle,
} from '@/components/ui';

/**
 * Roles are data, so an operator can add one without a deploy.
 *
 * The screen is built around the split that makes that safe: `key` is set once
 * and never editable, `name` is editable at will. Everything else in the system
 * references the key, so renaming a role rewrites exactly one column and
 * breaks nothing.
 *
 * Scopes are not on this screen. `roles.scopes` still decides what the add-in
 * switches on and the values already in the table are untouched, but nothing
 * in the portal reads or writes them any more.
 */
export default function RolesPage() {
  const canManage = useCan('role.manage');

  const [rows, setRows] = useState<RoleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<RoleRow | null>(null);

  const load = useCallback(() => {
    api<{ rows: RoleRow[] }>('/admin/roles')
      .then((r) => { setRows(r.rows); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  useEffect(() => { load(); }, [load]);

  const patch = useCallback(async (key: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/roles/${encodeURIComponent(key)}`, {
        method: 'PATCH', body: JSON.stringify(body),
      });
      load();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [load]);

  if (!rows) return <Loading what="Loading roles" />;

  const columns: Column<RoleRow>[] = [
    {
      key: 'name',
      header: 'Role',
      cell: (r) => (
        <>
          <p className="font-semibold text-ink flex items-center gap-2">
            {r.name}
            {r.isDefault && <Pill title="New members are provisioned into this role">Default</Pill>}
          </p>
          {r.description && <p className="text-small text-ink-3">{r.description}</p>}
        </>
      ),
      csv: (r) => r.name,
    },
    {
      key: 'key',
      header: 'Key',
      cell: (r) => (
        <span className="font-mono text-small text-ink-3" title="Permanent. Every member row and token carries it.">
          {r.key}
        </span>
      ),
      csv: (r) => r.key,
    },
    {
      key: 'members',
      header: 'Active',
      className: 'text-right tabular-nums',
      headClassName: 'text-right',
      cell: (r) => r.activeMembers,
      csv: (r) => String(r.activeMembers),
    },
    {
      key: 'assignable',
      header: 'Assignable',
      cell: (r) => {
        if (!canManage) return <span className="text-ink-3">{r.isActive ? 'Yes' : 'Retired'}</span>;
        // The default role has no meaningful switch: the API refuses to
        // deactivate it, and a control that only explains its own refusal is
        // worse than none.
        return r.isDefault
          ? <span className="text-ink-3" title="The default role cannot be switched off">Always on</span>
          : (
            <Toggle
              checked={r.isActive}
              disabled={busy}
              label={`${r.name} assignable`}
              onChange={(next) => patch(r.key, { isActive: next })}
            />
          );
      },
      csv: (r) => (r.isActive ? 'yes' : 'retired'),
    },
    ...(canManage ? [{
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (r: RoleRow) => (
        <span className="flex justify-end gap-1 whitespace-nowrap">
          {!r.isDefault && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || !r.isActive}
              title="New members are provisioned into the default role"
              onClick={() => patch(r.key, { isDefault: true })}
            >
              Make default
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setRenaming(r)}>Rename…</Button>
        </span>
      ),
    }] : []),
  ];

  return (
    <div className="space-y-6">
      {error && <ErrorNote>{error}</ErrorNote>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        csvName="roles"
        noun="roles"
        empty={{
          title: 'No roles',
          body: 'Nobody can be provisioned until at least one role exists and is marked as the default.',
        }}
      />

      {canManage && <CreateRole onCreated={load} />}

      <Note>
        A key is permanent, and reusing one would attach old members to a new role. Retire a role by
        switching it off, never by deleting it.
      </Note>

      {renaming && (
        <RenameRole
          role={renaming}
          busy={busy}
          onClose={() => setRenaming(null)}
          onSave={async (name) => { await patch(renaming.key, { name }); setRenaming(null); }}
        />
      )}
    </div>
  );
}

/** Renaming is the one edit a role has, so it gets a dialog rather than a row that grows. */
function RenameRole({ role, busy, onClose, onSave }: {
  role: RoleRow;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(role.name);

  return (
    <Modal
      open
      title={`Rename ${role.name}`}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="rename-role" disabled={busy || name.trim().length < 2}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      )}
    >
      <form
        id="rename-role"
        className="space-y-4"
        onSubmit={(e: FormEvent) => { e.preventDefault(); onSave(name.trim()); }}
      >
        <Field label="Name" hint="What everyone sees. The key never changes.">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={`Name for ${role.key}`}
            required
            minLength={2}
          />
        </Field>
        <p className="text-meta text-ink-3">
          <span className="font-mono">{role.key}</span> stays as it is, so no workstation notices.
        </p>
      </form>
    </Modal>
  );
}

function CreateRole({ onCreated }: { onCreated: () => void }) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function suggestKey(value: string) {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // `scopes` is omitted rather than sent empty: `createRoleSchema` defaults
      // it to [] and `assertScopes` short-circuits on empty.
      await api('/admin/roles', {
        method: 'POST',
        body: JSON.stringify({
          key: key.trim(),
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });
      setKey(''); setName(''); setDescription('');
      onCreated();
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Add a role">
      {error && <ErrorNote>{error}</ErrorNote>}
      <form onSubmit={submit}>
        <FieldRow cols={2}>
          <Field label="Name" hint="What everyone sees. Editable later.">
            <TextInput
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setKey(suggestKey(e.target.value));
              }}
              required
              minLength={2}
            />
          </Field>
          <Field label="Key" hint="Lowercase snake_case. Permanent. It cannot be changed or reused.">
            <TextInput
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="font-mono"
              pattern="[a-z][a-z0-9_]*"
              required
            />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <TextInput value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="sm:col-span-2 flex justify-end">
            <Button variant="primary" type="submit" disabled={busy || !key || name.trim().length < 2}>
              {busy ? 'Creating…' : 'Create role'}
            </Button>
          </div>
        </FieldRow>
      </form>
      <Note>A new role has no seats on any licence, so creating one grants nothing by itself.</Note>
    </Section>
  );
}
