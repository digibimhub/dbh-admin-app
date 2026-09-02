# Scopes — the contract with the add-in

The add-in switches features on and off using **scopes**. It never looks at a
role, and it never looks at a licence.

```csharp
if (session.HasScope("coordination")) { /* show the Link Manager panel */ }
```

That one rule is what makes everything else in the portal safe to change.

## The catalog

`panel_definitions` is the vocabulary — six slugs, mirroring the `Panels` array
in the add-in's `RibbonBuilder.cs`:

| Slug | Ribbon panel |
|---|---|
| `cleanup` | Delete Duplicates |
| `parameters` | Mass Parameters |
| `excel` | Export to / Import from Excel |
| `coordination` | Link Manager |
| `troubleshoot` | Diagnose Duplicates |
| `general` | About, Updates, **Sign in** |

The catalog screen is at `/settings/panels`. It is no longer linked from the
settings tabs — the portal does not surface scopes any more — but the URL still
resolves, and it is where a new slug is added.

**A role's grant is not editable from the portal either.** `roles.scopes` is set
with `PATCH /admin/roles/:key`, and a role created in Settings → Roles starts
with none — so it grants only the never-gated `general` panel until somebody
sets them.

**Slugs are append-only.** They are compiled into shipped DLLs, so renaming one
fails nowhere and silently removes a panel from every workstation in the field.
Add rows; never rewrite them. Retire one with `is_active = false`.

## How a scope is granted

```
scopes = license_roles.scopes ?? roles.scopes      # override, else the role's own
       ∪ every never_gated slug                    # always, whatever the config
```

Roles grant scopes. A licence may override the grant for one role
(`license_roles.scopes`) — that column is null in the ordinary case and exists
only for the customer who needs to differ from the default.

Resolution happens once, in `resolveScopes()` in `packages/core/src/resolve.ts`,
and the result goes on the token. The add-in receives a flat list and never sees
the inputs.

### `never_gated` is not optional

`general` carries About, Updates and Sign in. A licensing mistake that could
hide it would also remove the means of fixing the licence — so it is unioned in
at resolution, at the single point every grant passes through. No role, no
licence override and no operator can drop it.

It is enforced there rather than in a route's validation on purpose. The
previous implementation checked it when a licence was written, and had two
holes: it validated the union of two arrays (so one could be empty), and a patch
of one array was checked without re-reading the other. Enforcing at the grant
means there is one place to be right.

`never_gated` is settable when a scope is created and absent from the patch
schema. It describes the shipped ribbon, not an operator preference; changing it
takes a migration, which is the right amount of friction.

## What the token carries

```jsonc
{
  "sub": "…", "org": "…", "org_name": "…", "email": "…",
  "role":   "coordinator",              // the role KEY — informational only
  "scopes": ["cleanup", "coordination", "excel", "general", "parameters"],
  "license_end": "2026-04-01",
  "grace_days": 7,
  "next_check": "2026-09-02T09:00:00Z"
}
```

`role` is there so a support engineer reading a token knows *why* the scopes are
what they are. **The add-in must never branch on it.** That is the rule that
makes a role rename — of its display name or even its key — invisible to every
installed DLL.

The token is ES256-signed and verifiable offline against
`/.well-known/jwks.json`. Tampering with `scopes` fails the signature check;
there is a test for precisely that forgery.

## Propagation

Scopes are re-resolved on **every refresh**, so a change to a role, a seat
override or a person's role reaches a running add-in at its next check —
`next_check` is 09:00 the following day — **with no re-authentication**. The
session is untouched; only the access token changes.

An operator who needs it immediately revokes the session, which does force a
sign-in. That is the one case where it is worth it, and it is deliberate.

## Not in this phase

Per-person overrides. `org_users.panels_override` used to let one individual be
granted one extra thing; with configurable roles that is now "give them a role",
which is auditable and countable against seats. If a genuine per-person case
appears it returns as `org_users.scopes_override`, with the same never-gated
union applied.
