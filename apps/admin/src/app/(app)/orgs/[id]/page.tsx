'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatAbsolute } from '@/lib/format';
import { useCan } from '@/lib/session';
import { useOrg } from '@/components/OrgContext';
import {
  Button, ErrorNote, FormBar, FormGrid, Pill, Row, Section, TextInput, TimeAgo,
} from '@/components/ui';

/** One line of the sign-in checklist: a state, what it means, and where to fix it. */
function Check({ ok, label, detail, href }: {
  ok: boolean; label: string; detail: string; href: string;
}) {
  return (
    <li className="flex items-baseline gap-2.5">
      <Pill tone={ok ? 'allow' : 'warn'}>{ok ? 'yes' : 'no'}</Pill>
      <span className="min-w-0">
        <Link href={href} className="text-ink hover:underline">{label}</Link>
        <span className="text-ink-3"> — {detail}</span>
      </span>
    </li>
  );
}

export default function OrgOverviewPage() {
  const { detail, reload } = useOrg();
  const org = detail.org;
  const canEdit = useCan('org.edit');

  const totalSeats = detail.seats.reduce((n, s) => n + s.seats, 0);
  const freeSeats = detail.seats.reduce((n, s) => n + Math.max(0, s.seats - s.used), 0);

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

  return (
    <div className="space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Section
        title="Details"
        note="Name, slug and who to contact. Everything else lives on the other tabs."
        actions={canEdit && !editing ? <Button onClick={() => setEditing(true)}>Edit</Button> : undefined}
      >
        {/*
          Read and edit are the SAME grid, so pressing Edit swaps the controls
          and moves nothing. They used to be a two-column dl and a two-column
          form that disagreed about where a label sits.
        */}
        {!editing ? (
          <FormGrid>
            <Row label="Name">{org.name}</Row>
            <Row label="Slug">
              <span className="font-mono text-meta">{org.slug}</span>
            </Row>
            <Row label="Contact email">
              {org.primaryContactEmail
                ? (
                  <a href={`mailto:${org.primaryContactEmail}`} className="text-signal hover:underline">
                    {org.primaryContactEmail}
                  </a>
                )
                : <span className="text-ink-3">—</span>}
            </Row>
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
              <span className="font-mono text-meta">{org.slug}</span>
            </Row>
            <Row label="Contact email" htmlFor="org-email" width="email">
              <TextInput
                id="org-email"
                type="email"
                value={form.primaryContactEmail}
                onChange={(e) => setForm({ ...form, primaryContactEmail: e.target.value })}
              />
            </Row>
            <FormBar>
              <Button variant="ghost" type="button" onClick={() => setEditing(false)}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </FormBar>
          </FormGrid>
        )}
      </Section>

      {/*
        A checklist against THIS organisation, not an explanation of the model.
        It used to be three paragraphs restating the README, which told a reader
        who already knew the product nothing about why nobody could sign in.
      */}
      <Section title="Can people sign in?" note="The three things that have to be true, checked against this organisation.">
        <ul className="text-body space-y-2 max-w-[74ch]">
          <Check
            ok={detail.domains.length > 0}
            href={`/orgs/${org.id}/domains`}
            label="A domain is registered"
            detail={detail.domains.length > 0
              ? `${detail.domains.length} registered`
              : 'Nobody can be matched to this organisation yet'}
          />
          <Check
            ok={freeSeats > 0}
            href={`/orgs/${org.id}/license`}
            label="A licence has a free seat"
            detail={!detail.license
              ? 'No licence, so there are no seats'
              : freeSeats > 0
                ? `${freeSeats} free of ${totalSeats}`
                : `All ${totalSeats} seats are taken — new people wait`}
          />
          <Check
            ok={detail.counts.pending === 0}
            href={`/orgs/${org.id}/people`}
            label="Nobody is waiting"
            detail={detail.counts.pending === 0
              ? 'No one is held up'
              : `${detail.counts.pending} waiting for a seat`}
          />
        </ul>
      </Section>
    </div>
  );
}
