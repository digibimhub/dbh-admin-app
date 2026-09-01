import { test, expect } from '@playwright/test';
import { API, createOrg, portalApi, trackOrg, unique } from './helpers/portal';

/**
 * The input matrix for organisations and domains.
 *
 * The browser specs cover one case per equivalence class, because driving forty
 * variants through a rendered dialog costs forty page loads to exercise the same
 * two `zod` schemas. This file covers the classes exhaustively at the boundary
 * the dialog posts to — same schema, same route, same error bodies — so a gap in
 * validation shows up here and a gap in the screen shows up there.
 *
 * Every case states the status it expects. A case whose comment disagrees with
 * its expectation is a finding, not a typo.
 */

const tag = unique();

type Case = {
  what: string;
  body: Record<string, unknown>;
  status: number;
};

/* ---------------------------------------------------------- organisations */

const ORG_CASES: Case[] = [
  // --- name
  { what: 'name at the 2-character minimum', body: { name: 'Ab', slug: `m-${tag}-name-min` }, status: 201 },
  { what: 'name of 1 character', body: { name: 'A', slug: `m-${tag}-name-short` }, status: 400 },
  { what: 'name of 200 characters', body: { name: 'x'.repeat(200), slug: `m-${tag}-name-max` }, status: 201 },
  { what: 'name of 201 characters', body: { name: 'x'.repeat(201), slug: `m-${tag}-name-over` }, status: 400 },
  { what: 'name that is only whitespace', body: { name: '   ', slug: `m-${tag}-name-blank` }, status: 400 },
  { what: 'name with non-ASCII letters', body: { name: 'Nordvest Rådgivning AS', slug: `m-${tag}-name-utf8` }, status: 201 },
  { what: 'name missing entirely', body: { slug: `m-${tag}-name-absent` }, status: 400 },

  // --- slug
  { what: 'slug of digits only', body: { name: 'Digits', slug: `1234${tag}` }, status: 201 },
  { what: 'slug at the 2-character minimum', body: { name: 'Min Slug', slug: 'zz' }, status: 201 },
  { what: 'slug of 1 character', body: { name: 'Short Slug', slug: 'z' }, status: 400 },
  { what: 'slug of 80 characters', body: { name: 'Long Slug', slug: `m${tag}${'a'.repeat(80 - 1 - tag.length)}` }, status: 201 },
  { what: 'slug of 81 characters', body: { name: 'Too Long Slug', slug: 'b'.repeat(81) }, status: 400 },
  { what: 'slug with a capital letter', body: { name: 'Capital Slug', slug: `M-${tag}-caps` }, status: 400 },
  { what: 'slug with a space', body: { name: 'Spaced Slug', slug: `m ${tag}` }, status: 400 },
  { what: 'slug with an underscore', body: { name: 'Underscore Slug', slug: `m_${tag}` }, status: 400 },
  { what: 'slug with a leading hyphen', body: { name: 'Leading Hyphen', slug: `-m-${tag}` }, status: 400 },
  { what: 'slug with a trailing hyphen', body: { name: 'Trailing Hyphen', slug: `m-${tag}-` }, status: 400 },
  { what: 'slug with a double hyphen', body: { name: 'Double Hyphen', slug: `m--${tag}` }, status: 400 },
  { what: 'slug with a dot', body: { name: 'Dotted Slug', slug: `m.${tag}` }, status: 400 },
  { what: 'slug missing entirely', body: { name: 'No Slug At All' }, status: 400 },
  { what: 'slug already taken', body: { name: 'Duplicate', slug: 'acme-engineering' }, status: 409 },

  // --- contact email
  { what: 'contact email omitted', body: { name: 'No Contact', slug: `m-${tag}-nocontact` }, status: 201 },
  { what: 'contact email valid', body: { name: 'With Contact', slug: `m-${tag}-contact`, primaryContactEmail: 'ops@e2e.test' }, status: 201 },
  { what: 'contact email malformed', body: { name: 'Bad Contact', slug: `m-${tag}-badcontact`, primaryContactEmail: 'not-an-email' }, status: 400 },
  { what: 'contact email empty string', body: { name: 'Empty Contact', slug: `m-${tag}-emptycontact`, primaryContactEmail: '' }, status: 400 },

  // --- shape
  { what: 'status supplied by the caller (must not be settable)', body: { name: 'Sneaky Status', slug: `m-${tag}-status`, status: 'suspended' }, status: 201 },
];

test.describe('organisation input matrix', () => {
  for (const c of ORG_CASES) {
    test(`create: ${c.what} → ${c.status}`, async () => {
      const api = await portalApi('owner');
      const res = await api.post(`${API}/admin/orgs`, { data: c.body });
      // Nine of these cases legitimately create an organisation, several with
      // names chosen to be awkward rather than recognisable - `Ab`, `Min Slug`,
      // two hundred x's. Untracked, they are what left sixteen rows behind
      // after every run and made the Organisations list unreadable.
      if (res.status() === 201) {
        const { row } = await res.json() as { row: { id: string } };
        trackOrg(row.id);
      }
      expect(res.status(), `${c.what}: ${await res.text()}`).toBe(c.status);
    });
  }

  test('a caller cannot suspend an organisation by supplying a status on create', async () => {
    const api = await portalApi('owner');
    const res = await api.get(`${API}/admin/orgs?q=${tag}-status`);
    const { rows } = await res.json() as { rows: { slug: string; status: string }[] };
    const created = rows.find((r) => r.slug === `m-${tag}-status`);
    // If this is 'suspended', the create route is writing caller-supplied
    // columns straight through, which is a mass-assignment hole.
    expect(created?.status, 'status must come from the server, not the request').toBe('active');
  });
});

/* ---------------------------------------------------------------- domains */

let domainOrgId = '';

const DOMAIN_CASES: Case[] = [
  { what: 'a plain two-label domain', body: { value: `d1-${tag}.test` }, status: 201 },
  { what: 'the shortest domain that passes the 4-character minimum', body: { value: 'a.co' }, status: 201 },
  { what: 'a domain of 3 characters', body: { value: 'a.c' }, status: 400 },
  { what: 'a four-label domain', body: { value: `a.b.c-${tag}.test` }, status: 201 },
  { what: 'a punycode domain', body: { value: `xn--bcher-kva-${tag}.test` }, status: 201 },
  { what: 'a domain with no dot', body: { value: `abcd${tag}` }, status: 400 },
  { what: 'a domain with a capital letter', body: { value: `D2-${tag}.Test` }, status: 400 },
  { what: 'a domain with surrounding whitespace', body: { value: ` d3-${tag}.test ` }, status: 400 },
  { what: 'a domain with an @', body: { value: `me@d4-${tag}.test` }, status: 400 },
  { what: 'a domain with a protocol', body: { value: `https://d5-${tag}.test` }, status: 400 },
  { what: 'a domain with a trailing dot', body: { value: `d6-${tag}.test.` }, status: 400 },
  { what: 'a domain with a leading hyphen', body: { value: `-d7-${tag}.test` }, status: 400 },
  { what: 'a label ending in a hyphen', body: { value: `d8-${tag}-.test` }, status: 400 },
  { what: 'a label of 64 characters', body: { value: `${'a'.repeat(64)}.test` }, status: 400 },
  { what: 'a domain over 200 characters', body: { value: `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(30)}.test` }, status: 400 },
  { what: 'an underscore in a label', body: { value: `d9_${tag}.test` }, status: 400 },
  { what: 'a unicode domain', body: { value: `münchen-${tag}.test` }, status: 400 },
  { what: 'an empty value', body: { value: '' }, status: 400 },
  { what: 'no value at all', body: {}, status: 400 },
  { what: 'a public mailbox domain', body: { value: 'gmail.com' }, status: 400 },
  { what: 'another public mailbox domain', body: { value: 'proton.me' }, status: 400 },
  { what: 'a domain held by another organisation', body: { value: 'acme-eng.com' }, status: 409 },
  { what: 'a subdomain of another organisation domain', body: { value: `sub-${tag}.acme-eng.com` }, status: 201 },
];

test.describe('domain input matrix', () => {
  test.beforeAll(async () => {
    const api = await portalApi('owner');
    const org = await createOrg(api, { name: `E2E Matrix ${tag}`, slug: `e2e-matrix-${tag}` });
    domainOrgId = org.id;
  });

  for (const c of DOMAIN_CASES) {
    test(`domain: ${c.what} → ${c.status}`, async () => {
      const api = await portalApi('owner');
      const res = await api.post(`${API}/admin/orgs/${domainOrgId}/domains`, { data: c.body });
      expect(res.status(), `${c.what}: ${await res.text()}`).toBe(c.status);
    });
  }

  test('the same domain twice on the same organisation is a conflict', async () => {
    const api = await portalApi('owner');
    const value = `twice-${tag}.test`;
    const first = await api.post(`${API}/admin/orgs/${domainOrgId}/domains`, { data: { value } });
    expect(first.status()).toBe(201);

    const second = await api.post(`${API}/admin/orgs/${domainOrgId}/domains`, { data: { value } });
    expect(second.status()).toBe(409);
    expect(await second.text()).toMatch(/already registered to this organisation/i);
  });

  test('a domain on an organisation that does not exist is a 404, not a 201', async () => {
    const api = await portalApi('owner');
    const res = await api.post(
      `${API}/admin/orgs/00000000-0000-4000-8000-000000000000/domains`,
      { data: { value: `ghost-${tag}.test` } },
    );
    expect(res.status()).toBe(404);
  });

  test('an organisation id that is not a uuid is refused before any lookup', async () => {
    const api = await portalApi('owner');
    const res = await api.post(`${API}/admin/orgs/not-a-uuid/domains`, {
      data: { value: `bad-${tag}.test` },
    });
    expect([400, 404]).toContain(res.status());
  });
});

/* ------------------------------------------------------------ org updates */

test.describe('organisation update matrix', () => {
  let editableId = '';

  test.beforeAll(async () => {
    const api = await portalApi('owner');
    const org = await createOrg(api, { name: `E2E Patch ${tag}`, slug: `e2e-patch-${tag}` });
    editableId = org.id;
  });

  test('the slug cannot be changed, even by a caller who asks nicely', async () => {
    const api = await portalApi('owner');
    const res = await api.patch(`${API}/admin/orgs/${editableId}`, {
      data: { name: 'Renamed By Patch', slug: 'a-brand-new-slug' },
    });
    expect(res.status(), await res.text()).toBe(200);

    const after = await api.get(`${API}/admin/orgs/${editableId}`);
    const { org } = await after.json() as { org: { slug: string; name: string } };
    expect(org.slug, 'the slug is in URLs and the audit log; it must be immutable').toBe(`e2e-patch-${tag}`);
    expect(org.name).toBe('Renamed By Patch');
  });

  test('a name of one character is refused on update as well as on create', async () => {
    const api = await portalApi('owner');
    const res = await api.patch(`${API}/admin/orgs/${editableId}`, { data: { name: 'A' } });
    expect(res.status()).toBe(400);
  });

  test('a whitespace-only name is refused on update', async () => {
    const api = await portalApi('owner');
    const res = await api.patch(`${API}/admin/orgs/${editableId}`, { data: { name: '   ' } });
    expect(res.status()).toBe(400);
  });

  test('suspending an organisation with no reason is refused', async () => {
    const api = await portalApi('owner');
    const res = await api.post(`${API}/admin/orgs/${editableId}/suspend`, { data: {} });
    // 403 for the missing step-up or 400 for the missing reason — either way it
    // must not suspend anybody on an empty body.
    expect([400, 403]).toContain(res.status());

    const after = await api.get(`${API}/admin/orgs/${editableId}`);
    const { org } = await after.json() as { org: { status: string } };
    expect(org.status).toBe('active');
  });
});
