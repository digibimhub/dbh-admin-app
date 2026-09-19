'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { LICENSE_TZ_NOTE, addMonths, daysUntil, formatDateOnly, todayIso } from '@/lib/format';
import { useCan } from '@/lib/session';
import { useOrg } from '@/components/OrgContext';
import { DangerDialog } from '@/components/DangerDialog';
import {
  LICENSE_MODES, MODE_LABEL,
  type LicenseEventRow, type LicenseMode, type License, type RoleRow, type SeatRow,
} from '@/lib/types';
import {
  Button, EmptyState, ErrorNote, FormBar, FormGrid, Note, Row, Section,
  Select, StatusText, TextInput, TimeAgo,
} from '@/components/ui';

const EXTEND_OPTIONS = [1, 3, 6, 12];

const MODE_NOTE: Record<LicenseMode, string> = {
  internal: 'Our own people. Not a commercial relationship. Give it a far-future end date.',
  trial: 'A customer evaluating. Short term, small seat counts.',
  standard: 'A paying customer.',
};

/* ------------------------------------------------------------------ seats */

/**
 * Seats per role, with occupancy.
 *
 * `used` is a live count of active members in that role, so it moves the
 * moment somebody is assigned or moved. There is no counter to refresh.
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
      note="How many people may hold each role. Past the count, the next person waits."
      actions={canManage && !editing ? <Button size="sm" onClick={start}>Edit seats</Button> : undefined}
    >
      <div className="overflow-x-auto -mx-6">
        <table className="w-full text-control text-ink">
          <thead>
            <tr className="text-left border-y border-ink/10">
              <th className="font-bold px-6 py-4">Role</th>
              <th className="font-bold px-4 py-4 text-right">Used</th>
              <th className="font-bold px-4 py-4 text-right">Seats</th>
              <th className="px-6 py-4" />
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const full = s.used >= s.seats;
              const over = s.used > s.seats;
              return (
                <tr key={s.roleKey} className="border-b border-rule last:border-0">
                  <td className="px-6 py-4 font-semibold">{s.name}</td>
                  <td className={`px-4 py-4 text-right tabular-nums ${over ? 'font-bold' : ''}`}>{s.used}</td>
                  <td className="px-4 py-4 text-right tabular-nums">
                    {editing ? (
                      <TextInput
                        type="number"
                        min={0}
                        value={draft[s.roleKey] ?? '0'}
                        onChange={(e) => setDraft({ ...draft, [s.roleKey]: e.target.value })}
                        className="!w-[96px] !h-8 text-right ml-auto"
                        aria-label={`Seats for ${s.name}`}
                      />
                    ) : s.seats}
                  </td>
                  <td className="px-6 py-4 tabular-nums">
                    {over
                      ? <b className="text-ink">Over by {s.used - s.seats}</b>
                      : full
                        ? <b className="text-ink">Full</b>
                        : <span className="text-ink-3">{s.seats - s.used} free</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="flex justify-end gap-3 mt-4">
          <Button onClick={() => setEditing(false)}>Cancel</Button>
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
        Lowering a count below the people already in a role evicts nobody. It shows as over-cap
        until somebody leaves.
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
      <div className="space-y-6">
        {error && <ErrorNote>{error}</ErrorNote>}
        <Section title="No active licence">
          <EmptyState title="Nobody in this organisation can work">
            Every validation is denied with{' '}
            <code className="font-mono text-small">license_missing</code>, and nobody new can be
            provisioned. Seats live on the licence, so without one there is nothing to assign.
          </EmptyState>
        </Section>
        {canManage && <IssueLicence orgId={orgId} roles={roles} onDone={() => { reload(); loadAside(); }} />}
      </div>
    );
  }

  const remaining = daysUntil(license.endDate);

  return (
    <div className="space-y-6">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Section
        title="Term"
        note={LICENSE_TZ_NOTE}
        actions={canManage ? (
          license.status === 'suspended'
            ? (
              <Button
                size="sm"
                onClick={() => call(`/admin/licenses/${license.id}/resume`, { reason: 'resumed from the portal' })}
                disabled={busy}
              >
                Resume
              </Button>
            )
            : <Button size="sm" onClick={() => setSuspending(true)}>Suspend…</Button>
        ) : undefined}
      >
        <FormGrid>
          <Row label="Mode" hint={MODE_NOTE[license.mode]}>
            {canManage ? (
              <Select
                value={license.mode}
                disabled={busy}
                onChange={(e) => call(`/admin/licenses/${license.id}`, { mode: e.target.value }, 'PATCH')}
                className="!w-[170px] !h-8 !text-small !py-0"
                aria-label="Licence mode"
              >
                {LICENSE_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </Select>
            ) : MODE_LABEL[license.mode]}
          </Row>
          <Row label="Status"><StatusText status={license.status} attention={license.status !== 'active'} /></Row>
          <Row label="Period">
            <span className="tabular-nums">
              {formatDateOnly(license.startDate)} → {formatDateOnly(license.endDate)}
            </span>
            {remaining !== null && (
              <span className={`ml-2 tabular-nums ${remaining <= 30 ? 'font-bold text-ink' : 'text-ink-3'}`}>
                {remaining < 0 ? `${-remaining} days overdue` : `${remaining} days left`}
              </span>
            )}
          </Row>
          <Row label="Grace days" hint="Days offline still allowed, counted from the last successful check.">
            <span className="tabular-nums">{license.graceDays}</span>
          </Row>
          {canManage && (
            <Row label="Extend by">
              <span className="flex flex-wrap gap-2">
                {EXTEND_OPTIONS.map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    disabled={busy}
                    onClick={() => call(`/admin/licenses/${license.id}/extend`, {
                      months: m,
                      reason: `extended ${m} month${m === 1 ? '' : 's'} from the portal`,
                    })}
                    title={`New end date: ${formatDateOnly(addMonths(
                      license.endDate > todayIso() ? license.endDate : todayIso(), m,
                    ))}`}
                  >
                    {m} month{m === 1 ? '' : 's'}
                  </Button>
                ))}
              </span>
            </Row>
          )}
        </FormGrid>
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
          <ul>
            {events.map(({ event, actorEmail }, i) => (
              <li key={event.id} className={`py-3 flex flex-wrap gap-x-3 gap-y-1 items-baseline ${i > 0 ? 'border-t border-rule' : ''}`}>
                <span className="font-mono text-small text-ink">{event.eventType}</span>
                {event.oldEndDate && event.newEndDate && (
                  <span className="tabular-nums text-meta text-ink-3">
                    {formatDateOnly(event.oldEndDate)} → {formatDateOnly(event.newEndDate)}
                  </span>
                )}
                {event.reason && <span className="text-body text-ink-2">{event.reason}</span>}
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
        verb="suspend"
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
        <Row label="End date" htmlFor="lic-end" width="short" hint="Inclusive. A licence ending today is still valid today.">
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
      <Note>A role with no seats cannot be held by anybody. Leaving one at 0 is how a plan excludes it.</Note>
    </Section>
  );
}
