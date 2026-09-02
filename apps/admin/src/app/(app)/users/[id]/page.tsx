'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { formatAbsolute, formatDateOnly, shortHash } from '@/lib/format';
import { useCan } from '@/lib/session';
import {
  SOURCE_LABEL, type Device, type OrgUser, type RoleRow, type UserDeviceRow,
} from '@/lib/types';
import { DangerDialog } from '@/components/DangerDialog';
import {
  Button, ErrorNote, FormBar, FormGrid, Loading, Note, Pill, Row, Section, Select,
  StatusPill, TextInput, TimeAgo,
} from '@/components/ui';

type Detail = { user: OrgUser; orgName: string; roleName: string; devices: Device[] };

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canManage = useCan('user.manage');

  const [data, setData] = useState<Detail | null>(null);
  const [devices, setDevices] = useState<UserDeviceRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');

  const load = useCallback(() => {
    Promise.all([
      api<Detail>(`/admin/users/${id}`),
      api<{ rows: RoleRow[] }>('/admin/roles'),
      // Carries the last usage date per machine, which the embedded list does not.
      api<{ rows: UserDeviceRow[] }>(`/admin/users/${id}/devices`)
        .catch(() => ({ rows: [] as UserDeviceRow[] })),
    ])
      .then(([d, r, dev]) => {
        setData(d);
        setRoles(r.rows);
        setDevices(dev.rows.length
          ? dev.rows
          : d.devices.map((device) => ({ device, lastUsage: null })));
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function act(path: string, body: unknown = {}) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      load();
    } catch (e: unknown) {
      // A full role and a full seat count both surface here, naming the count.
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading what="Loading person" />;

  const u = data.user;

  /**
   * The one editable field on this card.
   *
   * `PATCH /admin/users/:id` has existed since the route file was written and
   * nothing ever called it, so a name typed wrong in the Add person dialog or
   * imported from a bad CSV could not be corrected anywhere in the portal.
   * Email is deliberately not editable: it is the global unique that ties a
   * person to one organisation.
   */
  async function saveName(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName: draftName.trim() }),
      });
      setEditing(false);
      load();
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-wrap items-start gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-meta text-ink-3 mb-1">
            <Link href="/users" className="text-signal hover:underline">Users</Link>
            <span className="mx-1.5">/</span>
            <Link href={`/orgs/${u.orgId}/people`} className="text-signal hover:underline">{data.orgName}</Link>
          </p>
          <h2 className="font-semibold text-page leading-tight tracking-tight flex items-center gap-2.5 flex-wrap">
            {u.displayName ?? u.email ?? 'Person'}
            {u.status === 'pending'
              ? <Pill tone="warn">awaiting a seat</Pill>
              : <StatusPill status={u.status} />}
          </h2>
          <p className="text-meta text-ink-3 mt-1">{u.email ?? 'no email on record'}</p>
        </div>

        {canManage && (
          <div className="ml-auto pt-1 flex gap-2">
            {u.status === 'pending' && (
              <Button variant="primary" disabled={busy} onClick={() => act(`/admin/users/${id}/approve`)}>
                Give a seat
              </Button>
            )}
            {u.status === 'disabled' && (
              <Button variant="secondary" disabled={busy} onClick={() => act(`/admin/users/${id}/enable`)}>
                Enable
              </Button>
            )}
            {u.status === 'active' && (
              <Button variant="danger" onClick={() => setDisabling(true)}>Disable</Button>
            )}
          </div>
        )}
      </div>

      {u.status === 'pending' && (
        <p className="bg-warn-soft text-warn border border-warn/30 rounded-sm px-3 py-2 mb-4 text-body">
          There was no free <b>{data.roleName}</b> seat when they signed in. Their session is still
          valid — give them a seat, or raise the count on the{' '}
          <Link href={`/orgs/${u.orgId}/license`} className="underline">Licence tab</Link>, and they
          are working at their next check without signing in again.
        </p>
      )}

      <div className="space-y-4">
        <Section
          title="Profile"
          actions={canManage && !editing ? (
            <Button onClick={() => { setDraftName(u.displayName ?? ''); setEditing(true); }}>Edit</Button>
          ) : undefined}
        >
          <FormGrid onSubmit={editing ? saveName : undefined}>
            <Row label="Display name" htmlFor={editing ? 'user-name' : undefined} width="name">
              {editing ? (
                <TextInput
                  id="user-name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  maxLength={120}
                  placeholder="Not set"
                />
              ) : (
                u.displayName ?? <span className="text-ink-3">not set</span>
              )}
            </Row>
            <Row label="Email">
              {u.email
                ? <span className="break-all">{u.email}</span>
                : <span className="text-ink-3">—</span>}
            </Row>
            <Row label="Organisation">
              <Link href={`/orgs/${u.orgId}`} className="text-signal hover:underline">{data.orgName}</Link>
            </Row>
            <Row
              label="Role"
              hint="Frees a seat in the old role and takes one in the new. Applies at their next check."
            >
              {canManage ? (
                <Select
                  value={u.roleKey}
                  disabled={busy}
                  aria-label="Role"
                  className="!w-[180px] !py-1"
                  onChange={(e) => act(`/admin/users/${id}/role`, { roleKey: e.target.value })}
                >
                  {roles.filter((r) => r.isActive || r.key === u.roleKey).map((r) => (
                    <option key={r.key} value={r.key}>{r.name}</option>
                  ))}
                </Select>
              ) : <Pill tone="neutral">{data.roleName}</Pill>}
            </Row>
            <Row label="Source">{SOURCE_LABEL[u.source] ?? u.source}</Row>
            <Row label="Autodesk ID">
              <span className="font-mono text-meta break-all">{u.autodeskId ?? '—'}</span>
            </Row>
            <Row label="Email verified">
              {u.emailVerified
                ? <Pill tone="allow">verified</Pill>
                : <Pill tone="warn">unverified</Pill>}
            </Row>
            <Row label="First seen">
              <span title={formatAbsolute(u.firstSeenAt)}><TimeAgo value={u.firstSeenAt} /></span>
            </Row>
            <Row label="Last activity"><TimeAgo value={u.lastActivityAt} /></Row>
            {editing && (
              <FormBar>
                <Button variant="ghost" type="button" onClick={() => setEditing(false)}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Save changes'}
                </Button>
              </FormBar>
            )}
          </FormGrid>
          <Note>
            Email and Autodesk ID come from Autodesk and cannot be edited — they are what tie this
            person to one organisation. Nobody is ever deleted; disable them instead.
          </Note>
        </Section>

        <Section title="Devices" note="Every machine this person has validated from.">
          {devices.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-body">
                <thead>
                  <tr className="text-left border-b border-rule">
                    {['Machine', 'Revit', 'Add-in', 'Last seen', 'Last usage', 'Status'].map((h) => (
                      <th key={h} className="text-micro uppercase tracking-[0.1em] text-ink-3 py-1.5 pr-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {devices.map(({ device: d, lastUsage }) => (
                    <tr key={d.id} className="border-b border-rule last:border-0">
                      <td className="py-1.5 pr-3">
                        <Link href={`/devices/${d.id}`} className="font-mono text-meta text-signal hover:underline">
                          {d.machineName ?? shortHash(d.deviceHash)}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-meta">{(d.revitVersions ?? []).join(', ') || '—'}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-meta">{d.addinVersion ?? '—'}</td>
                      <td className="py-1.5 pr-3"><TimeAgo value={d.lastSeenAt} className="tabular-nums text-meta text-ink-2" /></td>
                      <td className="py-1.5 pr-3 tabular-nums text-meta">{lastUsage ? formatDateOnly(lastUsage) : '—'}</td>
                      <td className="py-1.5 pr-3"><StatusPill status={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-body text-ink-3">
              No devices. A device row appears the first time this person validates from a workstation.
            </p>
          )}
        </Section>
      </div>

      <DangerDialog
        open={disabling}
        title="Disable person"
        targetKind="person"
        target={`${u.email ?? u.id} — ${data.orgName}`}
        consequence="Their next validation is denied with user_disabled and their add-in sessions are revoked, so re-enabling means signing in again. It also frees their seat, which somebody else may take."
        confirmLabel="Disable person"
        onCancel={() => setDisabling(false)}
        onConfirm={async (reason) => {
          await api(`/admin/users/${id}/disable`, { method: 'POST', body: JSON.stringify({ reason }) });
          setDisabling(false);
          load();
        }}
      />
    </div>
  );
}
