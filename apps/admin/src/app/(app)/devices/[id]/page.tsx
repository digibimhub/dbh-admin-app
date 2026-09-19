'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { formatAbsolute, shortHash } from '@/lib/format';
import { useCan, useScope } from '@/lib/session';
import type { DeviceUsage } from '@/lib/types';
import { DangerDialog } from '@/components/DangerDialog';
import { LineChart } from '@/components/charts';
import {
  Button, ErrorNote, FormGrid, Loading, PageHeader, Row, Section, StatusText, TimeAgo,
} from '@/components/ui';

/**
 * A device's own screen. Its 30-day usage chart is the reason it is a page
 * rather than a wider row: one request per device, made when somebody asks
 * for this machine, not fifty requests for a page of them.
 */
export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const scope = useScope();
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
  const name = d.machineName ?? shortHash(d.deviceHash, 24);
  const listHref = scope.kind === 'org' ? '/org/devices' : '/devices';

  return (
    <div>
      <PageHeader
        variant="record"
        breadcrumb={[{ label: 'Devices', href: listHref }, { label: name }]}
        title={d.machineName ?? 'Unnamed machine'}
        subline={(
          <>
            <StatusText status={d.status} attention={d.status === 'disabled'} />
            {' · '}<span className="font-mono">{shortHash(d.deviceHash)}</span>
          </>
        )}
        actions={canManage && (
          d.status === 'disabled'
            ? <Button disabled={busy} onClick={enable}>Enable device</Button>
            : <Button onClick={() => setDisabling(true)}>Disable device…</Button>
        )}
      />

      <div className="space-y-6">
        <Section title="Machine">
          <FormGrid>
            <Row label="Organisation">
              <Link href={scope.kind === 'org' ? '/org' : `/orgs/${d.orgId}`} className="text-link hover:underline">Open organisation</Link>
            </Row>
            <Row label="Person">
              {d.orgUserId
                ? <Link href={`/users/${d.orgUserId}`} className="text-link hover:underline">Open person</Link>
                : <span className="font-semibold">Unlinked. Validated without resolving to a person.</span>}
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
            <Row label="Device hash" hint="Recorded for analytics only. Never trusted for an access decision.">
              <span className="font-mono text-small break-all">{d.deviceHash}</span>
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
              <p className="tabular-nums text-meta text-ink-3 mb-4">
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
        </Section>
      </div>

      <DangerDialog
        open={disabling}
        title="Disable device"
        verb="disable"
        targetKind="device"
        target={name}
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
