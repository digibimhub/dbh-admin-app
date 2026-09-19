'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { formatAbsolute, formatDateOnly, shortHash } from '@/lib/format';
import { useCan, useScope } from '@/lib/session';
import {
  SOURCE_LABEL, type Device, type OrgDetail, type OrgUser, type RoleRow, type UserDeviceRow,
} from '@/lib/types';
import { DangerDialog } from '@/components/DangerDialog';
import { ApproveDialog } from '@/components/ApproveDialog';
import { DeleteRequestDialog, RejectDialog } from '@/components/RejectDialog';
import {
  Avatar, Button, ErrorNote, FormBar, FormGrid, InfoBanner, Loading, Note, PageHeader, Row,
  Section, Select, StatusText, TextInput, TimeAgo,
} from '@/components/ui';

type Detail = { user: OrgUser; orgName: string; roleName: string; devices: Device[] };

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const scope = useScope();
  const canRename = useCan('user.manage');
  const canManage = useCan('member.manage');
  const canReview = useCan('member.review');

  const [data, setData] = useState<Detail | null>(null);
  const [devices, setDevices] = useState<UserDeviceRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
        // Seats, for the Approve dialog. The organisation is readable by
        // anybody who can read this member.
        api<OrgDetail>(`/admin/orgs/${d.user.orgId}`).then(setOrg).catch(() => undefined);
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
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading what="Loading person" />;

  const u = data.user;
  const name = u.displayName ?? u.email ?? 'Person';
  const orgHref = scope.kind === 'org' ? '/org' : `/orgs/${u.orgId}`;
  const listHref = scope.kind === 'org' ? '/org/members' : '/users';

  /**
   * The one editable field on this card. Email is deliberately not editable:
   * it is the global unique that ties a person to one organisation.
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
      <PageHeader
        variant="record"
        breadcrumb={scope.kind === 'org'
          ? [{ label: 'Members', href: listHref }, { label: name }]
          : [{ label: 'Users', href: listHref }, { label: data.orgName, href: `/orgs/${u.orgId}/people` }, { label: name }]}
        avatar={<Avatar name={u.displayName} email={u.email} size={48} />}
        title={name}
        subline={(
          <>
            {u.email ?? 'no email on record'}
            {' · '}<StatusText status={u.status} reason={u.pendingReason} />
            {' · '}{data.roleName}
          </>
        )}
        actions={(
          <>
            {canReview && (u.status === 'pending' || u.status === 'rejected') && (
              <Button variant="primary" onClick={() => setApproving(true)}>Approve…</Button>
            )}
            {canReview && u.status === 'pending' && (
              <Button onClick={() => setRejecting(true)}>Reject…</Button>
            )}
            {canReview && u.status === 'rejected' && (
              <Button onClick={() => setDeleting(true)}>Delete…</Button>
            )}
            {canManage && u.status === 'disabled' && (
              <Button disabled={busy} onClick={() => act(`/admin/users/${id}/enable`)}>Enable</Button>
            )}
            {canManage && u.status === 'active' && (
              <Button onClick={() => setDisabling(true)}>Disable…</Button>
            )}
          </>
        )}
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {u.status === 'pending' && (
        <InfoBanner>
          {u.pendingReason === 'awaiting_approval' ? (
            <>They are waiting for approval. Nobody joins {data.orgName} until an admin approves them.</>
          ) : u.pendingReason === 'no_licence' ? (
            <>{data.orgName} has no active licence, so they cannot get in yet. They join automatically at their next sign-in once one is issued.</>
          ) : (
            <>
              There was no free <b>{data.roleName}</b> seat when they signed in. They get in automatically at their
              next sign-in once a seat is free, or approve them now to choose a role.
              {scope.kind === 'global' && (
                <>{' '}Seats are raised on the <Link href={`/orgs/${u.orgId}/license`} className="text-link underline">Licence tab</Link>.</>
              )}
            </>
          )}
        </InfoBanner>
      )}

      {u.status === 'rejected' && (
        <InfoBanner>
          Rejected{u.reviewedAt && <> <TimeAgo value={u.reviewedAt} /></>}{u.reviewNote && <>: {u.reviewNote}</>}.
          They see the same message each time they sign in. Approve to let them in after all.
        </InfoBanner>
      )}

      <div className="space-y-6">
        <Section
          title="Profile"
          actions={canRename && !editing ? (
            <Button size="sm" onClick={() => { setDraftName(u.displayName ?? ''); setEditing(true); }}>Edit</Button>
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
                u.displayName ?? <span className="text-ink-3">Not set</span>
              )}
            </Row>
            <Row label="Email">
              {u.email ? <span className="break-all">{u.email}</span> : <span className="text-ink-3">—</span>}
            </Row>
            <Row label="Organisation">
              <Link href={orgHref} className="text-link hover:underline">{data.orgName}</Link>
            </Row>
            <Row
              label="Role"
              hint="Frees a seat in the old role and takes one in the new. Applies at their next check."
            >
              {canManage && (u.status === 'active' || u.status === 'disabled') ? (
                <Select
                  value={u.roleKey}
                  disabled={busy}
                  aria-label="Role"
                  className="!w-[200px] !h-8 !text-small !py-0"
                  onChange={(e) => act(`/admin/users/${id}/role`, { roleKey: e.target.value })}
                >
                  {roles.filter((r) => r.isActive || r.key === u.roleKey).map((r) => (
                    <option key={r.key} value={r.key}>{r.name}</option>
                  ))}
                </Select>
              ) : data.roleName}
            </Row>
            <Row label="Status"><StatusText status={u.status} reason={u.pendingReason} /></Row>
            <Row label="Source">{SOURCE_LABEL[u.source] ?? u.source}</Row>
            <Row label="Autodesk ID">
              <span className="font-mono text-small break-all">{u.autodeskId ?? '—'}</span>
            </Row>
            <Row label="Email verified">
              <span className={u.emailVerified ? 'text-ink-3' : 'text-ink font-semibold'}>{u.emailVerified ? 'Verified' : 'Unverified'}</span>
            </Row>
            <Row label="First seen">
              <span title={formatAbsolute(u.firstSeenAt)}><TimeAgo value={u.firstSeenAt} /></span>
            </Row>
            <Row label="Last activity"><TimeAgo value={u.lastActivityAt} /></Row>
            {editing && (
              <FormBar>
                <Button type="button" onClick={() => setEditing(false)}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Save changes'}
                </Button>
              </FormBar>
            )}
          </FormGrid>
          <Note>
            Email and Autodesk ID come from Autodesk and cannot be edited. They are what tie this
            person to one organisation. An active member is never deleted; disable them instead.
          </Note>
        </Section>

        <Section title="Devices" note="Every machine this person has validated from.">
          {devices.length ? (
            <div className="overflow-x-auto -mx-6">
              <table className="w-full text-control text-ink">
                <thead>
                  <tr className="text-left border-y border-ink/10">
                    {['Machine', 'Revit', 'Add-in', 'Last seen', 'Last usage', 'Status'].map((h, i) => (
                      <th key={h} className={`font-bold py-4 ${i === 0 ? 'px-6' : 'px-4'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {devices.map(({ device: d, lastUsage }) => (
                    <tr key={d.id} className="border-b border-rule last:border-0">
                      <td className="px-6 py-4">
                        <Link href={`/devices/${d.id}`} className="font-mono text-small text-link hover:underline">
                          {d.machineName ?? shortHash(d.deviceHash)}
                        </Link>
                      </td>
                      <td className="px-4 py-4 tabular-nums text-ink-3">{(d.revitVersions ?? []).join(', ') || '—'}</td>
                      <td className="px-4 py-4 tabular-nums text-ink-3">{d.addinVersion ?? '—'}</td>
                      <td className="px-4 py-4"><TimeAgo value={d.lastSeenAt} className="text-ink-3" /></td>
                      <td className="px-4 py-4 tabular-nums text-ink-3">{lastUsage ? formatDateOnly(lastUsage) : '—'}</td>
                      <td className="px-4 py-4"><StatusText status={d.status} attention={d.status === 'disabled'} /></td>
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

      <ApproveDialog
        open={approving}
        target={{ ...u }}
        roles={roles}
        seats={org?.seats ?? []}
        licenceActive={org ? Boolean(org.license && org.license.status === 'active') : true}
        onClose={() => setApproving(false)}
        onApproved={() => { setApproving(false); load(); }}
      />
      <RejectDialog
        targets={rejecting ? [{ id: u.id, email: u.email, displayName: u.displayName }] : []}
        onClose={() => setRejecting(false)}
        onRejected={() => { setRejecting(false); load(); }}
      />
      <DeleteRequestDialog
        target={deleting ? { id: u.id, email: u.email, displayName: u.displayName } : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => { window.location.href = listHref; }}
      />
      <DangerDialog
        open={disabling}
        title="Disable person"
        verb="disable"
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
