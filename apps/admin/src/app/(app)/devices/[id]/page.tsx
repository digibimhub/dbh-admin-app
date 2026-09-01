'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { formatAbsolute, shortHash } from '@/lib/format';
import { useCan } from '@/lib/session';
import type { DeviceUsage } from '@/lib/types';
import { DangerDialog } from '@/components/DangerDialog';
import { LineChart } from '@/components/charts';
import {
  Button, ErrorNote, FormGrid, Loading, Note, Row, Section, StatusPill, TimeAgo,
} from '@/components/ui';

/**
 * What used to be the devices drawer.
 *
 * Its 30-day usage chart is the reason a device is worth its own screen rather
 * than a wider row: it is one request per device, made when somebody asks for
 * this machine, not fifty requests for a page of them.
 */
export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canManage = useCan('device.manage');

  const [usage, setUsage] = useState<DeviceUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<DeviceUsage>(`/admin/devices/${id}/usage?days=30`)
      .then((d) => { setUsage(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function enable() {
    setBusy(true);
    try {
      await api(`/admin/devices/${id}/enable`, { method: 'POST', body: '{}' });
      load();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!usage) return <Loading what="Loading device" />;

  const d = usage.device;

  return (
    <div>
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-meta text-ink-3 mb-1">
            <Link href="/devices" className="text-signal hover:underline">Devices</Link>
            <span className="mx-1.5">/</span>
            <span>{d.machineName ?? shortHash(d.deviceHash, 24)}</span>
          </p>
          <h2 className="font-semibold text-page leading-tight tracking-tight flex items-center gap-2.5 flex-wrap">
            {d.machineName ?? <span className="text-ink-3">unnamed machine</span>}
            <StatusPill status={d.status} />
          </h2>
        </div>
        {canManage && (
          <div className="ml-auto pt-1">
            {d.status === 'disabled'
              ? <Button variant="secondary" disabled={busy} onClick={enable}>Enable device</Button>
              : <Button variant="danger" onClick={() => setDisabling(true)}>Disable device</Button>}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <Section title="Machine">
          <FormGrid>
            <Row label="Organisation">
              <Link href={`/orgs/${d.orgId}`} className="text-signal hover:underline">Open organisation</Link>
            </Row>
            <Row label="Person">
              {d.orgUserId
                ? <Link href={`/users/${d.orgUserId}`} className="text-signal hover:underline">Open person</Link>
                : <span className="text-warn">unlinked — validated without resolving to a person</span>}
            </Row>
            <Row label="Revit versions">
              <span className="tabular-nums">{(d.revitVersions ?? []).join(', ') || '—'}</span>
            </Row>
            <Row label="Add-in version">
              <span className="tabular-nums">{d.addinVersion ?? '—'}</span>
            </Row>
            <Row label="First seen">
              <span title={formatAbsolute(d.firstSeenAt)}><TimeAgo value={d.firstSeenAt} /></span>
            </Row>
            <Row label="Last seen">
              <span title={formatAbsolute(d.lastSeenAt)}><TimeAgo value={d.lastSeenAt} /></span>
            </Row>
            <Row label="Device hash" hint="Reported by the add-in and recorded for analytics. It is never trusted for an access decision — a patched DLL can send anything.">
              <span className="font-mono text-meta break-all">{d.deviceHash}</span>
            </Row>
          </FormGrid>
        </Section>

        <Section title="Usage, last 30 days">
          {usage.totals.activeDays === 0 ? (
            <p className="text-body text-ink-3">
              No telemetry in the last 30 days. Either nobody has used this machine, or the add-in
              has not reported since.
            </p>
          ) : (
            <>
              <p className="tabular-nums text-meta text-ink-2 mb-3">
                {usage.totals.activeDays} active day{usage.totals.activeDays === 1 ? '' : 's'} ·{' '}
                {usage.totals.launches} launches · {usage.totals.activeMinutes} minutes
              </p>
              <LineChart
                points={usage.daily.map((x) => ({ label: x.usageDate.slice(5), value: x.activeMinutes }))}
                height={140}
                unit=" min"
              />
            </>
          )}
          <Note>
            Per-command counts are still accepted from the add-in but are not stored this phase —
            the panel that read them arrives with the Usage screen.
          </Note>
        </Section>
      </div>

      <DangerDialog
        open={disabling}
        title="Disable device"
        targetKind="device"
        target={d.machineName ?? shortHash(d.deviceHash, 24)}
        consequence="Validations from this machine are denied with device_disabled, for every person who signs in on it."
        confirmLabel="Disable device"
        onCancel={() => setDisabling(false)}
        onConfirm={async (reason) => {
          await api(`/admin/devices/${id}/disable`, {
            method: 'POST', body: JSON.stringify({ reason }),
          });
          setDisabling(false);
          load();
        }}
      />
    </div>
  );
}
