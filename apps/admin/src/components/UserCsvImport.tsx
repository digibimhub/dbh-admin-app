'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import type {
  ImportPreview, ImportResult, Organization, Paged, UserRow,
} from '@/lib/types';
import { Modal } from './Modal';
import { Button, ErrorNote, Field, Note, Pill, Select, TextArea, TextInput } from './ui';

/**
 * Two-step import, both steps server-side.
 *
 * The preview is built by `POST /admin/users/import/preview`, which writes
 * nothing and returns a plan plus an integrity token; the commit applies
 * exactly that plan in one transaction. Doing the diff in the browser and
 * firing the writes row by row would half-apply a file the moment one row hit
 * the global unique on email — the preview exists so the operator sees the
 * conflict and can cancel before anything is written. The preview step is
 * deliberately not skippable.
 */
export function UserCsvImport({ open, orgId, onClose, onImported }: {
  open: boolean;
  orgId?: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [org, setOrg] = useState(orgId ?? '');
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [existing, setExisting] = useState<UserRow[]>([]);
  const [stage, setStage] = useState<'input' | 'preview' | 'done'>('input');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replaceAll, setReplaceAll] = useState(false);
  const [replaceConfirm, setReplaceConfirm] = useState('');
  const [result, setResult] = useState<(ImportResult & { disabled: number; failed: string[] }) | null>(null);

  const targetOrg = orgId ?? org;

  useEffect(() => {
    if (!open || orgId) return;
    api<Paged<Organization>>('/admin/orgs?pageSize=100').then((d) => setOrgs(d.rows)).catch(() => undefined);
  }, [open, orgId]);

  useEffect(() => {
    if (open) return;
    setStage('input'); setText(''); setFileName(''); setPreview(null); setExisting([]);
    setError(null); setReplaceAll(false); setReplaceConfirm(''); setResult(null);
  }, [open]);

  /** Current members, used to show old → new on role changes and to find absentees. */
  async function loadExisting(id: string): Promise<UserRow[]> {
    const all: UserRow[] = [];
    for (let page = 1; page <= 50; page += 1) {
      const d = await api<Paged<UserRow>>(`/admin/users${qs({ org: id, page, pageSize: 100 })}`);
      all.push(...d.rows);
      if (!d.rows.length || all.length >= d.total) break;
    }
    return all;
  }

  async function runPreview() {
    if (!targetOrg || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const [plan, members] = await Promise.all([
        api<ImportPreview>('/admin/users/import/preview', {
          method: 'POST',
          body: JSON.stringify({ orgId: targetOrg, csv: text }),
        }),
        loadExisting(targetOrg),
      ]);
      setPreview(plan);
      setExisting(members);
      setStage('preview');
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const byId = useMemo(() => new Map(existing.map((r) => [r.user.id, r.user])), [existing]);

  const grouped = useMemo(() => {
    const rows = preview?.rows ?? [];
    return {
      create: rows.filter((r) => r.action === 'create'),
      update: rows.filter((r) => r.action === 'update'),
      unchanged: rows.filter((r) => r.action === 'unchanged'),
      conflict: rows.filter((r) => r.action === 'conflict'),
      invalid: rows.filter((r) => r.action === 'invalid'),
    };
  }, [preview]);

  /** Active members whose email does not appear anywhere in the file. */
  const absent = useMemo(() => {
    if (!preview) return [];
    const inFile = new Set(preview.rows.map((r) => r.email.toLowerCase()));
    return existing.filter(
      (r) => r.user.status !== 'disabled' && r.user.email && !inFile.has(r.user.email.toLowerCase()),
    );
  }, [preview, existing]);

  const armed = replaceAll && replaceConfirm === 'REPLACE';
  const applyCount = grouped.create.length + grouped.update.length + (armed ? absent.length : 0);

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    let committed: ImportResult = { created: 0, updated: 0 };

    try {
      // The plan goes back exactly as it arrived: the token is computed over
      // every row, so an edited plan is rejected rather than half-applied.
      committed = await api<ImportResult>('/admin/users/import/commit', {
        method: 'POST',
        body: JSON.stringify({ orgId: preview.orgId, token: preview.token, rows: preview.rows }),
      });
    } catch (err: unknown) {
      setError(errorMessage(err));
      setBusy(false);
      return;
    }

    // Disabling absentees is a separate, explicitly armed step. It cannot
    // collide with the global unique the way a create can, and each disable
    // writes its own audit entry with the reason below.
    let disabled = 0;
    if (armed) {
      for (const a of absent) {
        try {
          await api(`/admin/users/${a.user.id}/disable`, {
            method: 'POST',
            body: JSON.stringify({ reason: `Absent from a replace-entire-list CSV import (${fileName || 'pasted file'})` }),
          });
          disabled += 1;
        } catch (err: unknown) {
          failed.push(`${a.user.email}: ${errorMessage(err)}`);
        }
      }
    }

    setResult({ ...committed, disabled, failed });
    setStage('done');
    setBusy(false);
    onImported();
  }

  return (
    <Modal open={open} title="Import users from CSV" onClose={onClose} wide>
      {error && <ErrorNote>{error}</ErrorNote>}

      {stage === 'input' && (
        <div className="space-y-3">
          {!orgId && (
            <Field label="Organisation">
              <Select value={org} onChange={(e) => setOrg(e.target.value)}>
                <option value="">Choose…</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </Field>
          )}

          <Field
            label="CSV file"
            hint="Needs an email column. display_name and role are optional; order does not matter."
          >
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                setText(await file.text());
              }}
              className="text-body"
            />
          </Field>

          <Field label="…or paste it">
            <TextArea
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'email,display_name,role\nj.smith@acme.com,Jane Smith,user\nk.patel@acme.com,Kiran Patel,admin'}
              className="font-mono !text-meta"
            />
          </Field>

          <Note>
            No member is changed by this step — the server reads the file and hands back a plan to approve.
          </Note>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={runPreview} disabled={busy || !targetOrg || !text.trim()}>
              {busy ? 'Checking…' : 'Preview changes'}
            </Button>
          </div>
        </div>
      )}

      {stage === 'preview' && preview && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-5 gap-2">
            <Tally symbol="+" tone="allow" n={grouped.create.length} label="new users" />
            <Tally symbol="~" tone="warn" n={grouped.update.length} label="changes" />
            <Tally symbol="!" tone="deny" n={grouped.conflict.length} label="conflicts" />
            <Tally symbol="✗" tone="deny" n={grouped.invalid.length} label="unusable rows" />
            <Tally symbol="=" tone="neutral" n={grouped.unchanged.length} label="unchanged" />
          </div>

          {/*
            What this plan asks of the licence. Seats were checked only at
            commit time, so a file with more people than seats looked entirely
            fine here and quietly dropped the overflow on the next screen.
          */}
          {preview.seatForecast && preview.seatForecast.length > 0 && (
            <div className="border border-rule rounded-sm p-3">
              <p className="text-micro uppercase tracking-[0.1em] text-ink-3 mb-1.5">Seats this asks for</p>
              <ul className="text-meta space-y-1">
                {preview.seatForecast.map((f) => (
                  <li key={f.roleKey} className="tabular-nums">
                    <span className="text-ink">{f.roleName}</span>
                    {' — '}{f.wanted} needed, {f.free} free of {f.seats}
                    {f.shortfall > 0 && (
                      <span className="text-warn font-medium">
                        {' · '}{f.shortfall} will not get one
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {preview.seatForecast.some((f) => f.shortfall > 0) && (
                <p className="text-meta text-ink-2 mt-2">
                  Raise the count on the Licence tab first, or apply now and import the rest later —
                  everyone who fits is still added. Counted as things stand; nothing is reserved until you apply.
                </p>
              )}
            </div>
          )}

          {grouped.conflict.length > 0 && (
            <div className="border border-deny/40 bg-deny-soft/50 rounded-sm p-3">
              <p className="text-micro uppercase tracking-[0.1em] text-deny mb-1">
                Conflicts — these rows are skipped
              </p>
              <ul className="text-meta space-y-1">
                {grouped.conflict.map((r) => (
                  <li key={`${r.line}-${r.email}`}>
                    line {r.line}: {r.email} — {r.message ?? 'already belongs to another organisation'}
                  </li>
                ))}
              </ul>
              <p className="text-meta text-ink-2 mt-2">
                One person belongs to exactly one organisation, and an import never moves anybody between
                them. These rows are left alone whatever you do next.
              </p>
            </div>
          )}

          {grouped.update.length > 0 && (
            <div>
              <p className="text-micro uppercase tracking-[0.1em] text-ink-3 mb-1">Changes</p>
              <ul className="text-meta space-y-1">
                {grouped.update.map((r) => {
                  const current = r.existingUserId ? byId.get(r.existingUserId) : undefined;
                  const roleChanged = current && r.roleKey && current.roleKey !== r.roleKey;
                  return (
                    <li key={`${r.line}-${r.email}`}>
                      {r.email}
                      {roleChanged ? (
                        <>
                          {' '}<span className="text-ink-3">{current!.roleKey} →</span>{' '}
                          {/*
                            No colour judgement. With configurable roles there
                            is no general "promotion" or "demotion" to signal —
                            the old rule painted admin→user red, which means
                            nothing once a customer has five roles.
                          */}
                          <b className="text-signal">{r.roleKey}</b>
                        </>
                      ) : (
                        <span className="text-ink-3"> · details updated</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {grouped.invalid.length > 0 && (
            <div>
              <p className="text-micro uppercase tracking-[0.1em] text-ink-3 mb-1">Unusable rows — skipped</p>
              <ul className="text-meta space-y-1 text-deny">
                {grouped.invalid.map((r) => (
                  <li key={`${r.line}-${r.email}`}>
                    line {r.line}: {r.email || '(blank)'} — {r.message ?? 'could not be read'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {grouped.create.length > 0 && (
            <details>
              <summary className="text-micro uppercase tracking-[0.1em] text-ink-3 cursor-pointer">
                New users ({grouped.create.length})
              </summary>
              <ul className="text-meta mt-1 space-y-0.5">
                {grouped.create.map((r) => (
                  <li key={`${r.line}-${r.email}`}>
                    {r.email}{r.roleKey ? ` · ${r.roleKey}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="border border-rule rounded-sm p-3 bg-paper-2">
            <p className="text-body mb-2">
              <b>{absent.length}</b> active member{absent.length === 1 ? '' : 's'} of this organisation
              {absent.length === 1 ? ' is' : ' are'} not in the file. By default they are
              {' '}<b>left exactly as they are</b>.
            </p>
            <label className="flex items-start gap-2 text-body">
              <input
                type="checkbox"
                checked={replaceAll}
                onChange={(e) => { setReplaceAll(e.target.checked); setReplaceConfirm(''); }}
                className="mt-1"
                disabled={absent.length === 0}
              />
              <span>
                Replace the entire list — disable everyone absent from this file.
                <span className="block text-ink-3 text-meta">
                  Runs after the import as {absent.length} separate disable{absent.length === 1 ? '' : 's'}, each with
                  its own audit entry. Nobody is ever deleted.
                </span>
              </span>
            </label>
            {replaceAll && (
              <div className="mt-2 max-w-[260px]">
                <Field label="Type REPLACE to arm this">
                  <TextInput
                    value={replaceConfirm}
                    onChange={(e) => setReplaceConfirm(e.target.value)}
                   
                    placeholder="REPLACE"
                  />
                </Field>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStage('input')} disabled={busy}>Back</Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={commit} disabled={busy || applyCount === 0}>
              {busy ? 'Applying…' : `Apply ${applyCount} change${applyCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      )}

      {stage === 'done' && result && (
        <div className="space-y-3">
          <p className="text-body">
            <b>{result.created}</b> created · <b>{result.updated}</b> updated
            {result.disabled > 0 && <> · <b>{result.disabled}</b> disabled</>}
            {(result.skippedNoSeat ?? 0) > 0 && (
              <> · <b className="text-warn">{result.skippedNoSeat}</b> given no seat</>
            )}
          </p>

          {/*
            The server has always returned `skipped`, and this panel has always
            ignored it — so an import of 50 people into 10 free seats reported
            "10 created" and said nothing at all about the other 40. Name them:
            they are the whole reason the number differs from the button.
          */}
          {result.skipped && result.skipped.length > 0 && (
            <div className="border border-warn/40 bg-warn-soft/50 rounded-sm p-3">
              <p className="text-micro uppercase tracking-[0.1em] text-warn mb-1">
                No free seat — these people were not added
              </p>
              <ul className="text-meta space-y-1">
                {result.skipped.map((s) => <li key={s.email}>{s.email} — {s.reason}</li>)}
              </ul>
              <p className="text-meta text-ink-2 mt-2">
                Raise the seat count on the licence, then import the same file again. Everyone already
                added is left alone.
              </p>
            </div>
          )}

          {result.failed.length > 0 && (
            <div>
              <p className="text-deny text-body mb-1">
                {result.failed.length} disable{result.failed.length === 1 ? '' : 's'} failed:
              </p>
              <ul className="text-meta text-deny space-y-0.5">
                {result.failed.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </div>
          )}
          <Note>
            Written as one transaction, with a{' '}
            <code className="font-mono">user.import_commit</code> audit entry naming everyone created,
            updated or refused a seat.
          </Note>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Tally({ symbol, n, label, tone }: {
  symbol: string; n: number; label: string; tone: 'allow' | 'warn' | 'deny' | 'neutral';
}) {
  return (
    <div className="border border-rule rounded-sm px-3 py-2 bg-card">
      <p className="flex items-baseline gap-1.5">
        <Pill tone={n === 0 ? 'neutral' : tone}>{symbol}</Pill>
        <span className="font-semibold text-page tabular-nums">{n}</span>
      </p>
      <p className="text-meta text-ink-3 mt-0.5">{label}</p>
    </div>
  );
}

