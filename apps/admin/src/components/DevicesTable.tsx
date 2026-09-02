'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useUrlState } from '@/lib/useUrlState';
import { useCan } from '@/lib/session';
import { shortHash } from '@/lib/format';
import {
  DEVICE_STATUSES, type DeviceRow, type Organization, type Paged,
} from '@/lib/types';
import { DataTable, PAGE_SIZE, Pagination, type Column } from './DataTable';
import { DangerDialog } from './DangerDialog';
import { Button, ErrorNote, Note, Pill, SEARCH_FIELD, Select, StatusPill, TextInput, TimeAgo } from './ui';

const FILTER_DEFAULTS = { q: '', org: '', status: '', revit: '', stale: '' };

export function DevicesTable({ orgId }: { orgId?: string }) {
  const router = useRouter();
  const { values, set, page, reset, activeFilterCount } = useUrlState(FILTER_DEFAULTS);
  const [data, setData] = useState<Paged<DeviceRow> | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState<DeviceRow | null>(null);
  const [revitOptions, setRevitOptions] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  const canManage = useCan('device.manage');
  const effectiveOrg = orgId ?? values.org;

  const load = useCallback(() => {
    setLoading(true);
    api<Paged<DeviceRow>>(`/admin/devices${qs({
      q: values.q, org: effectiveOrg, status: values.status, revit: values.revit, page, pageSize: PAGE_SIZE,
    })}`)
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [values.q, values.status, values.revit, effectiveOrg, page]);

  useEffect(() => { load(); }, [load, tick]);

  useEffect(() => {
    if (orgId) return;
    api<Paged<Organization>>('/admin/orgs?pageSize=100').then((d) => setOrgs(d.rows)).catch(() => undefined);
  }, [orgId]);

  // The Revit filter runs server-side, so the option list has to accumulate
  // across loads or it would collapse to the one version already selected.
  useEffect(() => {
    if (!data?.rows.length) return;
    setRevitOptions((prev) => {
      const next = new Set(prev);
      for (const r of data.rows) for (const v of r.device.revitVersions ?? []) next.add(v);
      return [...next].sort().reverse();
    });
  }, [data]);

  /** "Not seen in N days" narrows the loaded page — the API has no parameter for it. */
  const rows = useMemo(() => {
    let out = data?.rows ?? [];
    if (values.stale) {
      const cutoff = Date.now() - Number(values.stale) * 86_400_000;
      out = out.filter((r) => new Date(r.device.lastSeenAt).getTime() < cutoff);
    }
    return out;
  }, [data, values.stale]);

  async function enable(row: DeviceRow) {
    await api(`/admin/devices/${row.device.id}/enable`, { method: 'POST', body: '{}' })
      .catch((e: unknown) => setError(errorMessage(e)));
    setTick((t) => t + 1);
  }

  const columns: Column<DeviceRow>[] = [
    {
      key: 'machine', header: 'Machine',
      cell: (r) => (
        <div>
          <div className="font-medium">
            {r.device.machineName ?? <span className="text-ink-3">unnamed</span>}
          </div>
          <div className="font-mono text-micro text-ink-3">{shortHash(r.device.deviceHash)}</div>
        </div>
      ),
      csv: (r) => `${r.device.machineName ?? ''} ${r.device.deviceHash}`.trim(),
    },
    {
      key: 'user', header: 'User',
      cell: (r) => (r.device.orgUserId
        ? <span className="text-meta">{r.userEmail ?? r.userName ?? 'linked user'}</span>
        : <Pill tone="warn" title="No linked user — worth a look">unlinked</Pill>),
      csv: (r) => r.userEmail ?? '',
    },
    ...(orgId ? [] : [{
      key: 'org', header: 'Organisation',
      cell: (r: DeviceRow) => <span className="text-meta">{r.orgName}</span>,
      csv: (r: DeviceRow) => r.orgName,
    }]),
    {
      key: 'seen', header: 'Last seen',
      cell: (r) => <TimeAgo value={r.device.lastSeenAt} className="tabular-nums text-meta text-ink-2" />,
      csv: (r) => r.device.lastSeenAt,
    },
    { key: 'status', header: 'Status', cell: (r) => <StatusPill status={r.device.status} />, csv: (r) => r.device.status },
  ];

  // Only the filters behind the disclosure are counted, so the badge means
  // "there is an active filter you cannot see" rather than restating the ones
  // already on screen.
  const hiddenFilterCount = [values.revit, values.stale].filter(Boolean).length;

  return (
    <div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.device.id}
        loading={loading}
        csvName="devices"
        filters={(
          <>
            <TextInput
              placeholder="Search machine name or hash"
              defaultValue={values.q}
              onKeyDown={(e) => { if (e.key === 'Enter') set({ q: (e.target as HTMLInputElement).value }); }}
              className={SEARCH_FIELD}
              aria-label="Search devices"
            />
            {!orgId && (
              <Select value={values.org} onChange={(e) => set({ org: e.target.value })} className="!w-auto" aria-label="Filter by organisation">
                <option value="">All organisations</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            )}
            <Select value={values.status} onChange={(e) => set({ status: e.target.value })} className="!w-auto" aria-label="Filter by status">
              <option value="">Any status</option>
              {DEVICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            {activeFilterCount > 0 && <Button variant="ghost" onClick={reset}>Clear</Button>}
          </>
        )}
        moreFilters={(
          <>
            <Select value={values.revit} onChange={(e) => set({ revit: e.target.value })} className="!w-auto" aria-label="Filter by Revit version">
              <option value="">Any Revit</option>
              {revitOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
            <Select value={values.stale} onChange={(e) => set({ stale: e.target.value })} className="!w-auto" aria-label="Filter by last seen">
              <option value="">Seen any time</option>
              <option value="14">Not seen in 14 days</option>
              <option value="30">Not seen in 30 days</option>
              <option value="90">Not seen in 90 days</option>
            </Select>
          </>
        )}
        activeFilterCount={hiddenFilterCount}
        onRowClick={(r) => router.push(`/devices/${r.device.id}`)}
        flagRow={(r) => (r.device.orgUserId ? null : 'No linked user — this device validated without resolving to a person')}
        empty={{
          title: activeFilterCount ? 'No devices match these filters' : 'No devices yet',
          body: activeFilterCount
            ? 'Clear a filter to widen the search. Only "not seen in N days" narrows the loaded page; the rest are applied by the server.'
            : 'A device row is created automatically on the first successful validation from a workstation. Nothing to do here until someone runs the add-in.',
          action: activeFilterCount ? <Button variant="ghost" onClick={reset}>Clear filters</Button> : undefined,
        }}
        pagination={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={(p) => set({ page: p })} />}
      />
      <Note>
        Devices are analytics; disabling one is the only access decision they carry. Rows with no
        linked user are flagged — that is the anomaly worth opening.
      </Note>

      {disabling && (
        <DangerDialog
          open
          title="Disable device"
          targetKind="device"
          target={`${disabling.device.machineName ?? shortHash(disabling.device.deviceHash, 24)} — ${disabling.orgName}`}
          consequence="Validations from this machine are denied with device_disabled, for every user who signs in on it."
          confirmLabel="Disable device"
          onCancel={() => setDisabling(null)}
          onConfirm={async (reason) => {
            await api(`/admin/devices/${disabling.device.id}/disable`, {
              method: 'POST', body: JSON.stringify({ reason }),
            });
            setDisabling(null);
            setTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}
