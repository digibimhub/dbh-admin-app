'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatAbsolute } from '@/lib/format';
import { useCan } from '@/lib/session';
import { useOrg } from '@/components/OrgContext';
import {
  Button, ErrorNote, FormBar, FormGrid, Note, Row, Section, TextInput, TimeAgo,
} from '@/components/ui';

export default function OrgOverviewPage() {
  const { detail, reload } = useOrg();
  const org = detail.org;
  const canEdit = useCan('org.edit');

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
        note="An organisation is a name, a slug and somebody to contact. Everything else about it — who is in it, what they may do, how long for — belongs to its domains, its roles and its licence."
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

      <Section title="How people get in">
        <ol className="text-body text-ink-2 space-y-2.5 max-w-[74ch] list-none counter-reset">
          <li>
            <b className="text-ink">1. Their email domain must be registered here.</b>{' '}
            A domain belongs to exactly one organisation, so a verified Autodesk address on{' '}
            {detail.domains[0]
              ? <span className="font-mono text-meta">{detail.domains[0].value}</span>
              : 'one of them'}{' '}
            resolves to this one and no other.{' '}
            <Link href={`/orgs/${org.id}/domains`} className="text-signal hover:underline">Domains →</Link>
          </li>
          <li>
            <b className="text-ink">2. The licence must have a free seat for their role.</b>{' '}
            New people get the default role. If its seats are full they still become a member — of
            this organisation, with that role — but they wait, and the add-in tells them why.{' '}
            <Link href={`/orgs/${org.id}/license`} className="text-signal hover:underline">Licence →</Link>
          </li>
          <li>
            <b className="text-ink">3. Their role decides what the add-in shows them.</b>{' '}
            Roles carry scopes; the add-in switches features on scopes and never on a role name, so
            a role can be renamed without touching a single workstation.{' '}
            <Link href={`/orgs/${org.id}/people`} className="text-signal hover:underline">People →</Link>
          </li>
        </ol>
        <Note>
          Identity comes only from Autodesk, verified server-side during the OAuth code exchange.
          Domains map a verified email to an organisation; they never assert who somebody is, and
          nothing the add-in reports about a machine takes part in the decision.
        </Note>
      </Section>
    </div>
  );
}
