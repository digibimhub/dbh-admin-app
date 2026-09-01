'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/session';
import type { PanelDefinition, RoleRow } from '@/lib/types';
import {
  Button, EmptyState, ErrorNote, Field, Loading, Note, Pill, Section,
  TextInput, Toggle,
} from '@/components/ui';

/**
 * Roles are data, so an operator can add one without a deploy.
 *
 * The screen is built around the split that makes that safe: `key` is set once
 * and never editable, `name` is editable at will. Everything else in the system
 * — member rows, seat rows, the add-in token — references the key, so renaming
 * a role rewrites exactly one column and breaks nothing.
 */
export default function RolesPage() {
  const canManage = useCan('role.manage');

  const [rows, setRows] = useState<RoleRow[] | null>(null);
  const [scopes, setScopes] = useState<PanelDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      api<{ rows: RoleRow[] }>('/admin/roles'),
      api<{ rows: PanelDefinition[] }>('/admin/panels'),
    ])
      .then(([r, p]) => { setRows(r.rows); setScopes(p.rows); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function patch(key: string, body: Record<string, unknown>) {
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
  }

  if (!rows) return <Loading what="Loading roles" />;

  return (
    <div className="space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      {rows.length === 0 && (
        <EmptyState title="No roles">
          Nobody can be provisioned until at least one role exists and is marked as the default.
        </EmptyState>
      )}

      {rows.map((role) => (
        <RoleCard
          key={role.key}
          role={role}
          scopes={scopes}
          canManage={canManage}
          busy={busy}
          onPatch={(body) => patch(role.key, body)}
        />
      ))}

      {canManage && <CreateRole scopes={scopes} onCreated={load} />}

      <Note>
        A key is permanent. It is what <code className="font-mono">org_users.role_key</code>, the
        seat rows and the add-in token all carry, so reusing one would silently attach old members
        to a new role. Retire a role by switching it off — never by deleting it.
      </Note>
    </div>
  );
}

function RoleCard({ role, scopes, canManage, busy, onPatch }: {
  role: RoleRow;
  scopes: PanelDefinition[];
  canManage: boolean;
  busy: boolean;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(role.name);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => { setName(role.name); }, [role.name]);

  const granted = new Set(role.scopes);

  return (
    <Section
      title={role.name}
      note={role.description ?? undefined}
      actions={(
        <div className="flex items-center gap-2">
          {role.isDefault && (
            <Pill tone="signal" title="New members are provisioned into this role">default</Pill>
          )}
          <span className="text-meta text-ink-3 tabular-nums">{role.activeMembers} active</span>
          {canManage && (
            role.isDefault
              // The default role has no meaningful switch: the API refuses to
              // deactivate it, and offering a control that only ever explains
              // its own refusal is worse than not offering one.
              ? <Pill tone="allow" title="The default role cannot be switched off">always on</Pill>
              : (
                <Toggle
                  checked={role.isActive}
                  disabled={busy}
                  label={`${role.name} assignable`}
                  onChange={(next) => onPatch({ isActive: next })}
                />
              )
          )}
        </div>
      )}
    >
      <dl className="grid sm:grid-cols-[168px_minmax(0,1fr)] gap-y-3 items-baseline">
        <dt className="text-micro uppercase tracking-[0.1em] text-ink-3">Key</dt>
        <dd className="font-mono text-meta">
          {role.key}
          <span className="ml-2 text-ink-3 font-sans">permanent</span>
        </dd>

        <dt className="text-micro uppercase tracking-[0.1em] text-ink-3">Name</dt>
        <dd>
          {!canManage ? role.name : renaming ? (
            <form
              className="flex flex-wrap gap-2 items-center"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                onPatch({ name: name.trim() });
                setRenaming(false);
              }}
            >
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="!w-[220px] !py-1"
                aria-label={`Name for ${role.key}`}
                required
                minLength={2}
              />
              <Button variant="primary" type="submit" disabled={busy}>Save</Button>
              <Button variant="ghost" type="button" onClick={() => { setName(role.name); setRenaming(false); }}>
                Cancel
              </Button>
            </form>
          ) : (
            <span className="flex items-center gap-3">
              {role.name}
              <Button variant="ghost" onClick={() => setRenaming(true)}>Rename</Button>
            </span>
          )}
        </dd>

        <dt className="text-micro uppercase tracking-[0.1em] text-ink-3">Scopes</dt>
        <dd>
          <div className="flex flex-wrap gap-1.5">
            {scopes.map((s) => {
              if (s.neverGated) {
                return (
                  <span
                    key={s.slug}
                    title="Carries About, Updates and Sign in — granted to everybody whatever their role"
                    className="font-mono text-meta px-2 py-1 rounded-sm border bg-allow-soft border-allow text-allow"
                  >
                    {s.slug} ●
                  </span>
                );
              }
              const on = granted.has(s.slug);
              return (
                <button
                  key={s.slug}
                  type="button"
                  disabled={!canManage || busy}
                  title={s.description ?? s.label}
                  onClick={() => {
                    const next = new Set(role.scopes);
                    if (next.has(s.slug)) next.delete(s.slug); else next.add(s.slug);
                    onPatch({ scopes: [...next] });
                  }}
                  className={`font-mono text-meta px-2 py-1 rounded-sm border disabled:cursor-default ${
                    on ? 'bg-signal-soft border-signal text-signal' : 'border-rule text-ink-3 hover:border-ink-3'
                  }`}
                >
                  {s.slug}
                </button>
              );
            })}
          </div>
          <p className="text-meta text-ink-3 mt-2 max-w-[70ch]">
            ● is never gated: it carries About, Updates and Sign in, so it is added to every grant
            whatever this role says. A licence that could hide it would also remove the means of
            fixing the licence.
          </p>
        </dd>

        {!role.isDefault && canManage && (
          <>
            <dt className="text-micro uppercase tracking-[0.1em] text-ink-3">Default</dt>
            <dd>
              <Button disabled={busy || !role.isActive} onClick={() => onPatch({ isDefault: true })}>
                Make this the default
              </Button>
              <span className="text-meta text-ink-3 ml-2">
                New members are provisioned into the default role.
              </span>
            </dd>
          </>
        )}
      </dl>
    </Section>
  );
}

function CreateRole({ scopes, onCreated }: { scopes: PanelDefinition[]; onCreated: () => void }) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
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
      await api('/admin/roles', {
        method: 'POST',
        body: JSON.stringify({
          key: key.trim(),
          name: name.trim(),
          description: description.trim() || undefined,
          scopes: [...picked],
        }),
      });
      setKey(''); setName(''); setDescription(''); setPicked(new Set());
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
      <form onSubmit={submit} className="grid sm:grid-cols-2 gap-3">
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
        <Field label="Key" hint="Lowercase snake_case. Permanent — it cannot be changed or reused.">
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
        <div className="sm:col-span-2">
          <span className="block text-micro uppercase tracking-[0.1em] text-ink-3 mb-1.5">Scopes</span>
          <div className="flex flex-wrap gap-1.5">
            {scopes.filter((s) => !s.neverGated).map((s) => {
              const on = picked.has(s.slug);
              return (
                <button
                  key={s.slug}
                  type="button"
                  onClick={() => {
                    const next = new Set(picked);
                    if (next.has(s.slug)) next.delete(s.slug); else next.add(s.slug);
                    setPicked(next);
                  }}
                  className={`font-mono text-meta px-2 py-1 rounded-sm border ${
                    on ? 'bg-signal-soft border-signal text-signal' : 'border-rule text-ink-3 hover:border-ink-3'
                  }`}
                >
                  {s.slug}
                </button>
              );
            })}
          </div>
        </div>
        <div className="sm:col-span-2 flex justify-end">
          <Button variant="primary" type="submit" disabled={busy || !key || name.trim().length < 2}>
            {busy ? 'Creating…' : 'Create role'}
          </Button>
        </div>
      </form>
      <Note>
        A new role has no seats on any licence until somebody gives it some, so creating one grants
        nothing by itself.
      </Note>
    </Section>
  );
}
