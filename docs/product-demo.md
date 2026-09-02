# Product demo — narration script

The voice-over for `tests/e2e/product-demo.spec.ts`, keyed to the numbered
steps in that file. Nine steps, one customer, from an empty Organisations list
to a governed ribbon and an audit trail. Read it over the recording; renumber a
step in the spec and renumber the paragraph here.

---

## Producing the recording

The demo drives the live stack, so the stack has to be up first.

1. `pnpm dev` in its own terminal — the suite drives the portal on :3000 and
   deliberately does not start one. A second Next server would share
   `apps/admin/.next` with `next dev`, which is the `Cannot find module
   './NNN.js'` failure `AGENTS.md` documents.
2. **Port 3002 must be free.** Playwright starts its own API there, pointed at
   the mock Autodesk issuer on :4599, so `.env` can keep real APS credentials.
3. Then, from the repo root:

```bash
pnpm test:e2e:demo              # headed, 350 ms between actions, recorded
pnpm test:e2e:demo --slow 700   # slower, if you are narrating live
```

**This reseeds the database.** `tests/e2e/global-setup.ts` TRUNCATEs everything
and re-runs the seed before the first test. Anything you were looking at
locally is gone. The runner sets `E2E_KEEP_DATA=1`, so what the demo *creates*
survives the run and can be poked at afterwards.

### Where the video lands

The runner sets `E2E_DEMO=1`, which is what makes the `demo` project in
`playwright.config.ts` exist. That project — and only that project — sets
`video: 'on'`, at 1440×900, with its own output directory:

```
test-results/demo/<spec>-<test-title>-demo/video.webm
```

One `.webm`, kept whether the run passed or failed, because a demo that fell
over halfway is still the run you wanted to watch. To find it:

```bash
ls test-results/demo/*/video.webm
```

`test-results/` is gitignored, so the file is yours to move, convert or delete.
Nothing else in the suite records: `pnpm test:e2e` runs the `e2e` project,
which ignores this spec outright and writes no video at all.

### Pacing

Timecodes below are for the default `--slow 350` on a warm dev server. The
first visit to each route compiles it, so a cold run is a minute or two longer
and the early steps drift most. Treat the marks as order and proportion, not as
a clock — and if you are narrating live, `--slow 700` buys you room.

---

## The script

### [00:00] Intro

> This is the licensing platform behind our Revit add-in. Everything you are
> about to see is one operator, in one browser session, taking a new customer
> from nothing to working software — and then keeping control of it.
>
> Nothing here is mocked. The screens are the real portal, the API is the real
> API, and when an engineer signs in from a workstation in a moment, that is
> the shipped sign-in flow running against a local Autodesk issuer. The only
> thing standing in for production is the identity provider.

### [00:25] Step 1 — Create the organisation

> We start where a new customer starts: an organisation. This is the unit we
> sell to. The licence belongs to it, the domains hang off it, and every person
> who ever signs in resolves into exactly one of them.
>
> Name, slug, done. Look at the header strip that comes up: licence "none", in
> red. The product is telling us, before we have asked, that nobody at this
> customer can sign in yet — and exactly why. That is the pattern for the whole
> console: state first, and the reason next to it.

**Why it matters commercially:** the organisation is the billing boundary and
the support boundary. One record to suspend when an invoice goes unpaid, one
record to point a support ticket at.

### [01:00] Step 2 — Register the domain

> Now the domain. This is how a customer onboards two hundred engineers without
> sending two hundred invitations: anyone whose verified Autodesk email is on
> this domain becomes a member on their first sign-in, automatically.
>
> A domain belongs to exactly one organisation — that is enforced in the
> database, globally. So resolution has one answer or none. There is no
> tie-break, no "which of these two customers did they mean", and no support
> queue built out of ambiguity.

**Why it matters commercially:** zero-touch onboarding is the difference
between a licence a customer deploys and a licence a customer files. It is also
what makes self-service growth inside an account free for us.

### [01:30] Step 3 — Issue the licence and set seats

> The commercial terms. A mode — this one is a trial — a term, and a seat count
> per role. One User seat and one Coordinator seat here, deliberately small, so
> you can watch the limits work.
>
> Seats are the control. Not a serial number, not a dongle, not a file on a
> machine. A number in one place that we can move.

**Why it matters commercially:** this screen is the price. Trials expire on
their own, expansions are one field, and nothing has to be reissued or
redistributed to a workstation for a change to take effect.

### [02:10] Step 4 — The first engineer signs in, and is granted

> Over on a workstation, an engineer clicks Sign in on the ribbon. What runs is
> the real OAuth flow to Autodesk — with the code exchange verified on our
> server, not on the machine. The workstation asserts nothing about who is
> sitting at it. That is the single most important rule in this system:
> identity comes only from Autodesk, and only server-side.
>
> She is granted, provisioned into the default role, and the token comes back
> carrying scopes — `cleanup`, `general` — not a role name. The ribbon switches
> panels on the scopes. Which means we can rename a role tomorrow and not a
> single installed DLL cares.
>
> Back in the portal: one seat of two used, and there she is on the People tab.
> She never filled in a form and nobody sent her a key.

**Why it matters commercially:** first-run success with no admin in the loop.
And because entitlement is a scope list rather than a build, we can sell
capability tiers without shipping different installers.

### [02:55] Step 5 — The second engineer fills the licence, and waits

> Now the interesting one. The second engineer signs in and there is no free
> User seat.
>
> Watch what does *not* happen. He is not rejected. He becomes a member of the
> right organisation in the right role, marked as waiting, and the add-in tells
> him he is queued for a seat rather than throwing an error at him. The portal
> agrees: "one person is waiting for a seat", with the row flagged.
>
> And note where he is *not*. Search the Access requests queue for him and it
> comes back empty. That queue is for people we could not place at all.
> Somebody waiting on a seat is already a customer's employee in a customer's
> organisation — a commercial conversation, not a security one.

**Why it matters commercially:** running out of seats is an upsell, and this is
what it looks like when the product treats it as one. Nobody's day stops,
nobody rings support, and the account manager gets a visible, countable queue
of demand.

### [03:40] Step 6 — Give him a seat

> Two moves, and both are on screen. Raise the User count from one to two —
> that is the expansion the customer just bought — and then hand the free seat
> to the man who was waiting.
>
> Seat occupancy is counted, never stored. There is no counter to drift out of
> step, no reconciliation job, and lowering a count below the people already in
> a role evicts nobody — it just shows as over-cap until somebody leaves.
>
> He does not sign in again. His session was never revoked, because a denial in
> this system never revokes anything. At his next check, at most a day away, he
> is simply working.

**Why it matters commercially:** an expansion is a number and a click, and it
lands on the workstation with no IT involvement and no interruption to a
modelling session. Losing a session mid-model is the failure that would cost us
a renewal.

### [04:25] Step 7 — The access requests queue

> A third person: a contractor, on nobody's registered domain. The resolver has
> no organisation to put her in — and it refuses to guess.
>
> So she lands here, in Access requests: the reason, the domain she came in on,
> and how many times she has been blocked. The table is for spotting who to act
> on; Review opens the decision, with the machine and the attempt history
> alongside it.
>
> An operator decides. We assign her to the customer's organisation and —
> because the User seats are full — we put her in Coordinator, where there is
> room. Approving takes a seat like any other assignment. If Coordinator had
> been full too, this would have refused and told us the count, rather than
> quietly overselling the licence.

**Why it matters commercially:** contractors, joint ventures and acquisitions
are the normal shape of this industry, and they are exactly the cases a
domain rule cannot cover. This queue turns every one of them into a decision
somebody made on purpose, with a record of who made it.

### [05:20] Step 8 — Users, and one person

> Users is everyone the platform knows about, across every customer — the
> screen support opens when the phone rings. Search, and there are our three,
> with the roles they ended up holding.
>
> Open one. Profile on the left, and underneath, every machine she has ever
> validated from. Devices are analytics here: we count them, we can disable
> one, and that is all they are allowed to do. A machine never gets a vote on
> who somebody is.

**Why it matters commercially:** first-line support can answer "why can't I
open the ribbon" in one search, without database access. And the device list is
the evidence for a conversation about how many people are really using what the
customer bought.

### [06:00] Step 9 — Roles, portal users, audit

> Last, the configuration. Roles are data, not code. The key is permanent — it
> is what the token and every member row point at — and the name is just a
> label, free to change. That split is why a customer can call it whatever they
> call it, and nothing ships.
>
> Portal users is who is allowed to operate this console: owner, admin, support
> and viewer, with the destructive actions behind a second factor.
>
> And the audit log. Every mutation in the product writes its before and after
> state through middleware — here is the seat we handed over four minutes ago,
> with the operator who handed it.

**Why it matters commercially:** roles-as-data means a customer's vocabulary is
a configuration change rather than a release. And the audit log is what makes
this sellable into an enterprise procurement process at all — every entitlement
decision is attributable, and nothing is deleted.

### [06:45] Close

> That is the whole product. A customer, a domain, a licence with seats, and
> three people who arrived by three different routes — one granted
> automatically, one queued and released, one approved by hand.
>
> Three things to take away. Identity is Autodesk's, verified on our side, and
> nothing a workstation claims about itself is ever an input. Entitlement is a
> scope list rather than a build, so what people can do is a setting and not a
> shipment. And no denial ever signs anybody out — every refusal in what you
> just watched was reversible from one screen, without a single person having
> to log in again.

---

## Notes for whoever runs this next

- The organisations, people and access requests the demo creates are left in
  the database on purpose (`E2E_KEEP_DATA=1`). The next suite run truncates
  them; so does `pnpm db:seed`.
- The names are randomised per run (`unique()` in the spec), so the customer is
  "Northgate Design" plus a six-character tag. If you are recording for
  distribution, that tag is on screen — worth knowing before you publish it.
- Do not add a step that renames a seeded role or edits a seeded organisation.
  Teardown only removes the organisations the run created, so anything the demo
  does to shared rows survives until the next reseed and turns up in somebody
  else's failing spec.
