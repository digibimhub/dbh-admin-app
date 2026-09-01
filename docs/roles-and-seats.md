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
| No seat | member created **`pending`**, denied `seats_exhausted` |

The person is a real member of the right organisation with the right role. They
are waiting, and the portal says so: they pin to the top of the People tab with
an *awaiting a seat* pill, and the organisation's stat strip counts them.

**Their session stays valid.** `seats_exhausted` is a soft denial — the refresh
token is not rotated and not revoked — so the moment an operator frees a seat or
raises the count, the next check succeeds with no sign-in. That is deliberate;
see [addin-auth.md](addin-auth.md).

### Where seats are enforced

| Action | Behaviour when full |
|---|---|
| Auto-provision (`resolveUser`) | member created `pending`, deny `seats_exhausted` |
| Add somebody manually | `409` naming used/total |
| Change role | `409`; the old seat is not released until the new one is taken |
| Approve a pending member | `409` — raise the count or move them to a role with room |
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
