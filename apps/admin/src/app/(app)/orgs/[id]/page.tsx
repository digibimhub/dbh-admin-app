'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatAbsolute } from '@/lib/format';
import { useCan } from '@/lib/session';
import { useOrg } from '@/components/OrgContext';
import type { JoinPolicy } from '@/lib/types';
import {
  Button, ErrorNote, FormBar, FormGrid, GoLink, Row, Section, SegmentedControl, TextInput, TimeAgo,
} from '@/components/ui';

const JOIN_HELP: Record<JoinPolicy, string> = {
  automatic: 'Anyone who signs in from a registered domain gets a seat straight away, if one is free.',
  approval: 'Anyone who signs in from a registered domain waits until an admin approves them.',
};

/** One line of the sign-in checklist: a state, what it means, and where to fix it. */
function Check({ ok, label, detail, href, action, first }: {
  ok: boolean; label: string; detail: string; href: string; action?: string; first?: boolean;
}) {
  return (
    <li className={`flex gap-3 py-2.5 ${first ? '' : 'border-t border-rule'}`}>
      <span aria-hidden className={`w-6 shrink-0 font-bold ${ok ? 'text-allow' : 'text-ink-3'}`}>{ok ? '✓' : '–'}</span>
      <div className="min-w-0">
        <span className="text-ink">{label}</span>
        <p className="text-meta text-ink-3">
          {detail}
          {!ok && action && <>{' '}<GoLink href={href}>{action}</GoLink></>}
        </p>
      </div>
    </li>
  );
}

export default function OrgOverviewPage() {
  const { detail, reload } = useOrg();
  const org = detail.org;
  const canEdit = useCan('org.edit');

  const totalSeats = detail.seats.reduce((n, s) => n + s.seats, 0);
  const freeSeats = detail.seats.reduce((n, s) => n + Math.max(0, s.seats - s.used), 0);
  const fullRoles = detail.seats.filter((s) => s.seats > 0 && s.used >= s.seats).map((s) => s.name);
  const licenceOk = Boolean(detail.license && detail.license.status === 'active');
  const awaiting = detail.counts.awaitingApproval ?? (org.joinPolicy === 'approval' ? detail.counts.pending : 0);

  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: org.name,
    primaryContactEmail: org.primaryContactEmail ?? '',
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/orgs/${org.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name,
          primaryContactEmail: form.primaryContactEmail || undefined,
        }),
      });
      setEditing(false);
      reload();
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** Saves the moment it is chosen — a policy is one fact, not a form. */
  async function setPolicy(joinPolicy: JoinPolicy) {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/orgs/${org.id}`, { method: 'PATCH', body: JSON.stringify({ joinPolicy }) });
      reload();
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const joining = org.joinPolicy !== undefined && (
    <Row label="Joining" hint={JOIN_HELP[org.joinPolicy]}>
      {canEdit ? (
        <SegmentedControl
          label="Join policy"
          value={org.joinPolicy}
          disabled={busy}
          onChange={setPolicy}
          options={[{ value: 'automatic', label: 'Automatic' }, { value: 'approval', label: 'Approval' }]}
        />
      ) : (org.joinPolicy === 'approval' ? 'Approval' : 'Automatic')}
    </Row>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Section
        title="Details"
        actions={canEdit && !editing ? <Button size="sm" onClick={() => setEditing(true)}>Edit</Button> : undefined}
      >
        {/*
          Read and edit are the SAME grid, so pressing Edit swaps the controls
          and moves nothing.
        */}
        {!editing ? (
          <FormGrid>
            <Row label="Name">{org.name}</Row>
            <Row label="Slug"><span className="font-mono text-small">{org.slug}</span></Row>
            <Row label="Contact email">
              {org.primaryContactEmail
                ? <a href={`mailto:${org.primaryContactEmail}`} className="text-link hover:underline">{org.primaryContactEmail}</a>
                : <span className="text-ink-3">—</span>}
            </Row>
            {joining}
            <Row label="Created">
              <span title={formatAbsolute(org.createdAt)}><TimeAgo value={org.createdAt} /></span>
            </Row>
            <Row label="Updated"><TimeAgo value={org.updatedAt} /></Row>
          </FormGrid>
        ) : (
          <FormGrid onSubmit={save}>
            <Row label="Name" htmlFor="org-name" width="name">
              <TextInput
                id="org-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                minLength={2}
              />
            </Row>
            <Row label="Slug" hint="Fixed after creation — it is in URLs and in the audit log.">
              <span className="font-mono text-small">{org.slug}</span>
            </Row>
            <Row label="Contact email" htmlFor="org-email" width="email">
              <TextInput
                id="org-email"
                type="email"
                value={form.primaryContactEmail}
                onChange={(e) => setForm({ ...form, primaryContactEmail: e.target.value })}
              />
            </Row>
            {joining}
            <FormBar>
              <Button type="button" onClick={() => setEditing(false)}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </FormBar>
          </FormGrid>
        )}
      </Section>

      {/*
        A checklist against THIS organisation, not an explanation of the model.
      */}
      <Section
        title="Can people sign in?"
        note={`What a first sign-in from ${detail.domains[0]?.value ?? 'a registered domain'} meets today.`}
      >
        <ul>
          <Check
            first
            ok={detail.domains.length > 0}
            href={`/orgs/${org.id}/domains`}
            label="A domain is registered"
            action="Register a domain"
            detail={detail.domains.length > 0
              ? `${detail.domains.length} registered: ${detail.domains.map((d) => d.value).join(', ')}`
              : 'Nobody can be matched to this organisation yet.'}
          />
          <Check
            ok={licenceOk}
            href={`/orgs/${org.id}/license`}
            label="The licence is active"
            action={detail.license ? 'Manage licence' : 'Issue a licence'}
            detail={!detail.license
              ? 'No licence, so there are no seats.'
              : detail.license.status !== 'active'
                ? `The licence is ${detail.license.status}.`
                : `${detail.license.mode === 'trial' ? 'Trial' : detail.license.mode === 'internal' ? 'Internal' : 'Standard'}, ends ${detail.license.endDate}.`}
          />
          <Check
            ok={freeSeats > 0}
            href={`/orgs/${org.id}/license`}
            label="A role has a free seat"
            action="Manage seats"
            detail={!detail.license
              ? 'Seats live on the licence.'
              : freeSeats > 0
                ? `${freeSeats} free of ${totalSeats}.${fullRoles.length ? ` ${fullRoles.join(', ')} ${fullRoles.length === 1 ? 'is' : 'are'} full.` : ''}`
                : `All ${totalSeats} seats are taken. New people wait.`}
          />
          <Check
            ok={awaiting === 0}
            href={`/orgs/${org.id}/requests`}
            label="Nobody is awaiting approval"
            action="Review requests"
            detail={awaiting === 0
              ? (org.joinPolicy === 'approval' ? 'The queue is clear.' : 'Joining is automatic.')
              : `${awaiting} ${awaiting === 1 ? 'person is' : 'people are'}.`}
          />
        </ul>
        {detail.counts.pending > 0 && awaiting === 0 && (
          <p className="text-meta text-ink-3 mt-3">
            {detail.counts.pending} {detail.counts.pending === 1 ? 'person is' : 'people are'} waiting on a seat or a licence.{' '}
            <Link href={`/orgs/${org.id}/requests`} className="text-link hover:underline">See who</Link>.
          </p>
        )}
      </Section>
    </div>
  );
}
