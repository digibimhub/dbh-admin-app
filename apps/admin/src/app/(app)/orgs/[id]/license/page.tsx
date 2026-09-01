'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { LICENSE_TZ_NOTE, daysUntil, formatDateOnly } from '@/lib/format';
import { useCan } from '@/lib/session';
import { useOrg } from '@/components/OrgContext';
import { DangerDialog } from '@/components/DangerDialog';
import {
  LICENSE_MODES, MODE_LABEL,
  type LicenseEventRow, type LicenseMode, type License, type RoleRow, type SeatRow,
} from '@/lib/types';
import {
  Button, EmptyState, ErrorNote, FormBar, FormGrid, Note, Pill, Row, Section,
  Select, StatusPill, TextInput, TimeAgo,
} from '@/components/ui';

const EXTEND_OPTIONS = [1, 3, 6, 12];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

const MODE_NOTE: Record<LicenseMode, string> = {
  internal: 'Our own people. Not a commercial relationship — give it a far-future end date.',
  trial: 'A customer evaluating. Short term, small seat counts.',
  standard: 'A paying customer.',
};

/* ------------------------------------------------------------------ seats */

/**
 * Seats per role, with occupancy.
 *
 * `used` is a live count of active members in that role, so it moves the
 * moment somebody is assigned or moved — there is no counter to refresh.
 */
function Seats({ seats, roles, canManage, onSave, busy }: {
  seats: SeatRow[];
  roles: RoleRow[];
  canManage: boolean;
  onSave: (next: { roleKey: string; seats: number }[]) => Promise<void>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);

  function start() {
    const d: Record<string, string> = {};
    for (const r of roles) {
      d[r.key] = String(seats.find((s) => s.roleKey === r.key)?.seats ?? 0);
    }
    setDraft(d);
    setEditing(true);
  }

  const shown = editing
    ? roles.map((r) => ({
        roleKey: r.key,
        name: r.name,
        seats: Number(draft[r.key] ?? 0),
        used: seats.find((s) => s.roleKey === r.key)?.used ?? 0,
        sortOrder: r.sortOrder,
      }))
    : seats;

  return (
    <Section
      title="Seats"
      note="How many people may hold each role. Auto-provisioning fills up to the count, then the next person waits."
      actions={canManage && !editing
        ? <Button onClick={start}>Edit seats</Button>
        : undefined}
    >
      <div className="overflow-x-auto -mx-4 sm:-mx-6">
        <table className="w-full text-body">
          <thead>
            <tr className="text-left border-y border-rule bg-paper">
              <th className="text-micro font-medium uppercase tracking-[0.1em] text-ink-3 px-4 sm:px-6 py-2.5">Role</th>
              <th className="text-micro font-medium uppercase tracking-[0.1em] text-ink-3 px-4 py-2.5 text-right">Used</th>
              <th className="text-micro font-medium uppercase tracking-[0.1em] text-ink-3 px-4 py-2.5 text-right">Seats</th>
              <th className="text-micro font-medium uppercase tracking-[0.1em] text-ink-3 px-4 sm:px-6 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const full = s.used >= s.seats;
              const over = s.used > s.seats;
              return (
                <tr key={s.roleKey} className={`border-b border-rule last:border-0 ${over ? 'border-l-2 border-l-warn' : ''}`}>
                  <td className="px-4 sm:px-6 py-2.5 font-medium">{s.name}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${over ? 'text-warn font-medium' : ''}`}>
                    {s.used}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {editing ? (
                      <TextInput
                        type="number"
                        min={0}
                        value={draft[s.roleKey] ?? '0'}
                        onChange={(e) => setDraft({ ...draft, [s.roleKey]: e.target.value })}
                        className="!w-[88px] !py-1 text-right"
                        aria-label={`Seats for ${s.name}`}
                      />
                    ) : s.seats}
                  </td>
                  <td className="px-4 sm:px-6 py-2.5">
                    {over
                      ? <Pill tone="warn">over by {s.used - s.seats}</Pill>
                      : full
                        ? <Pill tone="warn">full</Pill>
                        : <span className="text-meta text-ink-3 tabular-nums">{s.seats - s.used} free</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              await onSave(roles.map((r) => ({ roleKey: r.key, seats: Number(draft[r.key] ?? 0) })));
              setEditing(false);
            }}
          >
            {busy ? 'Saving…' : 'Save seats'}
          </Button>
        </div>
      )}

      <Note>
        Lowering a count below the people already in a role is allowed and evicts nobody — it shows
        as over-cap until somebody leaves. Seats gate becoming active in a role; they never revisit
        access already granted.
      </Note>
    </Section>
  );
}

/* ------------------------------------------------------------------- page */

export default function OrgLicensePage() {
  const { detail, reload } = useOrg();
  const orgId = detail.org.id;
  const canManage = useCan('license.manage');

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [events, setEvents] = useState<LicenseEventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suspending, setSuspending] = useState(false);

  const license = detail.license;

  const loadAside = useCallback(() => {
    api<{ rows: RoleRow[] }>('/admin/roles').then((d) => setRoles(d.rows)).catch(() => undefined);
    if (license) {
      api<{ rows: LicenseEventRow[] }>(`/admin/licenses/${license.id}/events`)
        .then((d) => setEvents(d.rows)).catch(() => undefined);
    }
  }, [license]);

  useEffect(() => { loadAside(); }, [loadAside]);

  async function call(path: string, body: unknown, method = 'POST') {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method, body: JSON.stringify(body) });
      reload();
      loadAside();
      return true;
    } catch (e: unknown) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!license) {
    return (
      <div className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <Section title="No active licence">
          <EmptyState title="Nobody in this organisation can work">
            Every validation is denied with{' '}
            <code className="font-mono text-meta">license_missing</code>, and nobody new can be
            provisioned — seats live on the licence, so without one there is nothing to assign.
          </EmptyState>
        </Section>
        {canManage && <IssueLicence orgId={orgId} roles={roles} onDone={() => { reload(); loadAside(); }} />}
      </div>
    );
  }

  const remaining = daysUntil(license.endDate);

  return (
    <div className="space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Section
        title="Term"
        note={LICENSE_TZ_NOTE}
        actions={canManage ? (
          <div className="flex gap-2">
            {license.status === 'suspended'
              ? (
                <Button
                  onClick={() => call(`/admin/licenses/${license.id}/resume`, { reason: 'resumed from the portal' })}
                  disabled={busy}
                >
                  Resume
                </Button>
              )
              : <Button variant="danger" onClick={() => setSuspending(true)}>Suspend</Button>}
          </div>
        ) : undefined}
      >
        <FormGrid>
          <Row label="Mode">
            {canManage ? (
              <Select
                value={license.mode}
                disabled={busy}
                onChange={(e) => call(`/admin/licenses/${license.id}`, { mode: e.target.value }, 'PATCH')}
                className="!w-[160px] !py-1"
                aria-label="Licence mode"
              >
                {LICENSE_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </Select>
            ) : MODE_LABEL[license.mode]}
          </Row>
          <Row label="Status"><StatusPill status={license.status} /></Row>
          <Row label="Period">
            <span className="tabular-nums">
              {formatDateOnly(license.startDate)} → {formatDateOnly(license.endDate)}
            </span>
            {remaining !== null && (
              <span className={`ml-2 text-meta ${remaining < 0 ? 'text-deny' : remaining <= 30 ? 'text-warn' : 'text-ink-3'}`}>
                {remaining < 0 ? `${-remaining}d overdue` : `${remaining}d left`}
              </span>
            )}
          </Row>
          <Row label="Grace days" hint="Days a workstation may keep working offline, measured from its last successful check — not from token expiry.">
            <span className="tabular-nums">{license.graceDays}</span>
          </Row>
        </FormGrid>

        <p className="text-meta text-ink-3 mt-3">{MODE_NOTE[license.mode]}</p>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-rule">
            <span className="text-micro uppercase tracking-wider text-ink-3 mr-1">Extend by</span>
            {EXTEND_OPTIONS.map((m) => (
              <Button
                key={m}
                disabled={busy}
                onClick={() => call(`/admin/licenses/${license.id}/extend`, {
                  months: m,
                  reason: `extended ${m} month${m === 1 ? '' : 's'} from the portal`,
                })}
                title={`New end date: ${addMonths(
                  license.endDate > todayIso() ? license.endDate : todayIso(), m,
                )}`}
              >
                +{m}m
              </Button>
            ))}
          </div>
        )}
      </Section>

      <Seats
        seats={detail.seats}
        roles={roles.filter((r) => r.isActive)}
        canManage={canManage}
        busy={busy}
        onSave={async (next) => { await call(`/admin/licenses/${license.id}`, { seats: next }, 'PATCH'); }}
      />

      <Section title="History" note="Every change to this licence, with the reason it was given.">
        {events.length ? (
          <ul className="space-y-2">
            {events.map(({ event, actorEmail }) => (
              <li key={event.id} className="text-body flex flex-wrap gap-x-2 items-baseline">
                <span className="font-mono text-meta text-signal">{event.eventType}</span>
                {event.oldEndDate && event.newEndDate && (
                  <span className="tabular-nums text-meta">
                    {formatDateOnly(event.oldEndDate)} → {formatDateOnly(event.newEndDate)}
                  </span>
                )}
                {event.reason && <span className="text-ink-2">{event.reason}</span>}
                <span className="text-meta text-ink-3 ml-auto">
                  {actorEmail ?? 'system'} · <TimeAgo value={event.createdAt} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-ink-3">No changes recorded yet.</p>
        )}
      </Section>

      <DangerDialog
        open={suspending}
        title="Suspend licence"
        targetKind="licence"
        target={`${MODE_LABEL[license.mode]} — ${detail.org.name}`}
        consequence={`Every validation is denied with license_suspended. Sessions stay valid, so resuming restores ${detail.counts.users} people without anybody signing in again.`}
        confirmLabel="Suspend licence"
        onCancel={() => setSuspending(false)}
        onConfirm={async (reason) => {
          await api(`/admin/licenses/${license.id}/suspend`, {
            method: 'POST', body: JSON.stringify({ reason }),
          });
          setSuspending(false);
          reload();
          loadAside();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ issue a new */

function IssueLicence({ orgId, roles, onDone }: {
  orgId: string; roles: RoleRow[]; onDone: () => void;
}) {
  const [mode, setMode] = useState<LicenseMode>('trial');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(addMonths(todayIso(), 12));
  const [graceDays, setGraceDays] = useState('7');
  const [seats, setSeats] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = roles.filter((r) => r.isActive);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api<{ row: License }>(`/admin/orgs/${orgId}/license`, {
        method: 'POST',
        body: JSON.stringify({
          mode,
          startDate,
          endDate,
          graceDays: Number(graceDays),
          seats: active.map((r) => ({ roleKey: r.key, seats: Number(seats[r.key] ?? 0) })),
        }),
      });
      onDone();
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Issue a licence">
      {error && <ErrorNote>{error}</ErrorNote>}
      <FormGrid onSubmit={submit}>
        <Row label="Mode" htmlFor="lic-mode" width="short" hint={MODE_NOTE[mode]}>
          <Select id="lic-mode" value={mode} onChange={(e) => setMode(e.target.value as LicenseMode)}>
            {LICENSE_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </Select>
        </Row>
        <Row label="Start date" htmlFor="lic-start" width="short">
          <TextInput id="lic-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </Row>
        <Row label="End date" htmlFor="lic-end" width="short" hint="Inclusive — a licence ending today is still valid today.">
          <TextInput id="lic-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
        </Row>
        <Row label="Grace days" htmlFor="lic-grace" width="tiny">
          <TextInput id="lic-grace" type="number" min={0} max={90} value={graceDays} onChange={(e) => setGraceDays(e.target.value)} />
        </Row>

        {active.map((r) => (
          <Row key={r.key} label={`${r.name} seats`} htmlFor={`seats-${r.key}`} width="tiny">
            <TextInput
              id={`seats-${r.key}`}
              type="number"
              min={0}
              value={seats[r.key] ?? '0'}
              onChange={(e) => setSeats({ ...seats, [r.key]: e.target.value })}
            />
          </Row>
        ))}

        <FormBar>
          <Button variant="primary" type="submit" disabled={busy || !active.length}>
            {busy ? 'Issuing…' : 'Issue licence'}
          </Button>
        </FormBar>
      </FormGrid>
      <Note>
        A role with no seats cannot be held by anybody. Leave one at 0 deliberately — that is how an
        organisation is told &ldquo;you do not get Admins on this plan&rdquo;.
      </Note>
    </Section>
  );
}
