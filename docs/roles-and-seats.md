# Roles and seats

Who is in an organisation, what they are allowed to do, and how many of them
the licence pays for.

## Roles are data

Three roles ship in the seed — Admin, Coordinator, User — but nothing in the
code knows those names. Roles are rows in `roles`, editable in
**Settings → Roles**, and an operator can add a fourth without a deploy.

Every role has two identifiers, and the split between them is the whole design:

| Column | Mutable? | Who reads it |
|---|---|---|
| `key` | **never** | `org_users.role_key`, `license_roles.role_key`, the `role` claim on the add-in token |
| `name` | freely | every screen, and nothing else |

### Renaming a role is safe, and this is why

Renaming "Coordinator" to "Lead Coordinator" is one statement:

```sql
UPDATE roles SET name = 'Lead Coordinator' WHERE key = 'coordinator';
```

No other row changes. Member rows still point at `coordinator`, seat rows still
point at `coordinator`, and tokens still carry `coordinator`. Every screen shows
the new name on its next render because no screen stores the old one.

Three things enforce it:

1. `patchRoleSchema` omits `key` entirely, so the API cannot rename one even by
   accident. This mirrors `patchPanelSchema`, which omits `slug` for the same
   reason.
2. `roles.name` is `citext UNIQUE`, so "Admin" and "admin" cannot coexist.
3. The add-in gates features on **scopes**, never on the role — so even the
   *key* is invisible to a shipped DLL. See [scopes.md](scopes.md).

There is an end-to-end test for exactly this: rename the role, refresh a live
token, and assert the `role` key and the `scopes` array are byte-identical.

### Retiring a role

Set `is_active = false`. Never `DELETE`.

A deleted role orphans every historical member row that referenced it. A
deactivated one cannot be assigned to anybody new, while the people already
holding it keep working — deactivation is a change to policy, not a reason to
interrupt somebody's afternoon.

The default role cannot be deactivated. Make another role the default first;
the API refuses otherwise, because auto-provisioning with nothing to assign
would send every first sign-in to the approval queue with no visible cause.

## Seats

`license_roles` holds one row per (licence, role): how many seats, and
optionally a scope override.

**Occupancy is counted, never stored:**

```sql
SELECT count(*) FROM org_users
WHERE org_id = $1 AND role_key = $2 AND status = 'active'
```

That single decision answers the question people ask first — *what happens to
the counts when somebody changes role?* Moving a person from User to Admin
frees a User seat and takes an Admin seat **in the one statement that changes
`role_key`**. There is nothing to keep in step and nothing to drift. A stored
counter would need two writes and would be wrong the first time one failed.

### What happens when a role is full

Auto-provisioning fills up to the count, and then stops — but "stops" does not
mean "rejects":

| | |
|---|---|
| Seat available | member created `active`, token granted |
| No seat | member created **`pending`** (`seats_exhausted`), denied `seats_exhausted` |

The person is a real member of the right organisation with the right role. They
are waiting, and the portal says so: they appear on the organisation's
Requests tab as *No seat free*, and the organisation's stat strip counts them.

**They get in by themselves once a seat exists.** Under the `automatic` join
policy the resolver re-checks the count at every sign-in by a waiting member;
the first sign-in after a seat is freed or the count is raised activates them
(`user.auto_activate` in the audit log, actor `addin`) and grants in the same
call. Nobody has to press Approve. The denial itself is soft — nothing is
rotated or revoked — so a workstation that keeps checking simply starts
working. See [addin-auth.md](addin-auth.md).

## Joining an organisation

Every sign-in from a registered domain makes the person a member of that
organisation. What kind of member depends on `organizations.join_policy`:

| Policy | Licence and seat available | Otherwise |
|---|---|---|
| `automatic` (default) | `active` at once | `pending`, and promoted at their next sign-in once a seat exists |
| `approval` | `pending` (`awaiting_approval`) until an admin approves — a free seat changes nothing | `pending` all the same |

`pending_reason` is **stored on the row**, not derived, and says what the
person is waiting on:

| Reason | Set when | Ends when |
|---|---|---|
| `awaiting_approval` | policy is `approval` at the time of sign-in | an admin approves (or rejects) — never automatically, even after the policy is flipped |
| `seats_exhausted` | policy is `automatic` and the role is full | a seat exists at their next sign-in (`automatic`), or an admin approves |
| `no_licence` | the organisation has no active licence, either policy | a licence is issued: promoted at the next sign-in under `automatic`, approved under `approval` |

The reason is refreshed as the situation changes (a `no_licence` wait becomes a
seat wait once a licence exists), and `attempt_count` / `last_attempt_at` are
bumped every time a waiting or rejected person tries again, so the queue can
show who is knocking. Occupancy never consults the reason: it is still a count
of `active` rows.

Only people who match **no organisation** — an unverified email, a domain
nobody owns, no default role — go to the global access-request queue that
portal staff review.

### Reject is sticky, delete is forget

An admin has two ways to say no:

| | What happens | At the next sign-in |
|---|---|---|
| **Reject** (`POST /admin/users/:id/reject`) | the row stays, `status = rejected`, with who, when and a note | `membership_rejected`; nothing new is queued |
| **Delete** (`DELETE /admin/users/:id`, step-up) | the row is removed; only for never-active rows | a brand-new request, with a new id |

Approve accepts a rejected row too — that is how a rejection is re-opened.
Pending members never expire; the daily `pending-members-digest` job keeps
reporting them until somebody decides.

### Organisation admins

An `org_admin` is a portal account scoped to one organisation
(`portal_users.org_id`). They hold `member.review` (approve, reject, delete)
and `member.manage` (role, disable, enable) for that organisation only, and
every read is confined to it: other organisations' ids answer 404, the
estate-wide surfaces answer 403. Licences, seats and domains stay with portal
staff. A suspended organisation is read-only for its admins (every mutation is
a 409) until portal staff reactivate it.

### Where seats are enforced

| Action | Behaviour when full |
|---|---|
| Auto-provision (`resolveUser`) | member created `pending` / `seats_exhausted`, deny `seats_exhausted` |
| Next sign-in by a waiting member (`automatic`) | promoted if a seat now exists, otherwise `seats_exhausted` again and the attempt counted |
| Add somebody manually | `409` naming used/total |
| Change role | `409`; the old seat is not released until the new one is taken |
| Approve a pending or rejected member | `409` — no licence, or raise the count or move them to a role with room |
| Re-enable a disabled member | `409` — their seat may have been taken while they were away |
| CSV import | fills what it can, reports the rest as `skippedNoSeat` |

Seats gate **becoming active in a role**. They never revisit a grant already
made, so lowering a count below current occupancy is allowed: it shows as
over-cap on the Licence tab and on the dashboard, and evicts nobody.

A role with **no seat row has zero seats**, not unlimited. That is how a plan
says "you do not get Admins": leave the count at 0.

## Licence modes

`internal` · `trial` · `standard`. The mode is a label for the commercial
relationship; the seats and the dates do the work. `organizations.status` is
now only `active | suspended` — "trial" was in two places before, and only one
of them was ever updated.
