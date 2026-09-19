---
name: ui-conventions
description: How screens in the admin portal are built — the ui.tsx primitives, DataTable (with selection), Modal with a footer band, capability-gated controls, the two personas and their scope, URL-backed filters, statuses as text, and the tone/format rules. Load before adding or changing any screen, table, dialog, form or status indicator in apps/admin.
---

# Admin portal UI conventions

Everything lives in `apps/admin/src/`. There is a real design system here; do not
hand-roll a `<table>`, a `<dialog>`, or a coloured `<span>`.

The visual target is the Autodesk Account portal, measured in
`docs/design/autodesk-portal-reference.md` and approved as
`docs/design/mock/portal-mock.html`. What that means in practice:

- **Black is the brand colour.** The primary button is black; the header stack
  is black. Colour appears only as information: `link` for links, `info` for the
  one banner, `allow`/`deny` for marks. `warn` is a border-and-dot colour, never
  text (it fails contrast on white).
- **Type is Manrope, big and heavy, never uppercase.** The `fontSize` ladder in
  `tailwind.config.ts` is *replaced*, not extended: `micro label meta small body
  control dialog title page record kpi`. A stray `text-lg` renders at browser
  default on purpose. No `uppercase`, no `tracking-*`, anywhere.
- **Borders, not shadows.** Cards are `border border-rule rounded-md`. The only
  `shadow-pop` in the product is on dialogs and menus.
- **Statuses are words.** `StatusText` renders plain grey text; `attention` makes
  it 600 black. There are no coloured pills and no red button.
- **Buttons that open a dialog end in an ellipsis** (`Suspend…`, `Approve…`).
  Buttons that act at once do not (`Enable`, `Approve` inside the dialog).
- British spelling, sentence case, no exclamation marks.

## Primitives — `src/components/ui.tsx`

Import from `@/components/ui`. Never restyle these inline beyond a `className`
that adjusts layout.

| Primitive | Use for |
| --- | --- |
| `PageHeader({ title, breadcrumb, lede, actions, avatar, subline, variant })` | Top of every screen. `variant="record"` = 48 px avatar, 34/800 title, grey sub-line |
| `Breadcrumb({ items })` | `Organisations / Acme` above a record title (`PageHeader` takes it as a prop) |
| `Avatar({ name, email, size, dark })` | Two-letter initials on a disc: 40 in rows, 48 on records, 44 in the header |
| `KpiStrip({ items })` | One panel split by hairlines. Renders a `<dl>` — e2e reads the first `dl` on an org page |
| `Section({ title, note, actions })` | A bordered card with a 21/700 heading |
| `Button({ variant, size, icon })` | `primary` (black) \| `secondary` (outline, default) \| `ghost` \| `link` (+ `icon="go"` for the ⊕ motif). `size="sm"` for row actions |
| `ButtonLink`, `GoLink` | A navigation that looks like a button / the ⊕ text link |
| `Field({ label, hint })` / `FieldRow({ cols })` | Label above control, in a dialog |
| `Row({ label, hint, htmlFor, width })` / `FormGrid` / `FormBar` | Settings-style forms; read and edit share one grid |
| `TextInput` / `TextArea` / `Select` / `Toggle` / `SearchInput` / `SegmentedControl` | Controls |
| `Pill({ tone })` | `neutral` (a tag) or `count` (a number on a tab or the bell). Nothing else |
| `StatusText({ status, reason, attention })` | Every status. Maps `pending` + `pendingReason` to Awaiting approval / No seat free / No licence yet |
| `TimeAgo({ value })` | Any timestamp — relative, absolute on hover |
| `InfoBanner`, `ErrorNote`, `EmptyState`, `Loading`/`Skeleton`, `Note` | The states |
| `DefList({ items })` | Label/value rows |
| `MoreMenu({ items })` | The `···` overflow, for the one or two actions that do not earn a button |

### Never align a row of fields with `items-end`

A `Field` with a `hint` is taller than one without, so `items-end` on the row
pushes every other input down. Use `FieldRow`, which flows from the top; put the
submit button after it, not in it.

### Statuses are text; numbers are bold when they matter

`StatusText` is the only status renderer. `attention` defaults on for
`awaiting_approval` and `no_licence` (somebody must act) and off for
`seats_exhausted` (resolves itself). A count worth acting on — awaiting members,
attempts at five or more, days left inside 30 — is `<b>`; a healthy zero is
`text-ink-3`. Never reach for colour to say either.

## Tables — `src/components/DataTable.tsx`

One card for every list: toolbar strip (search and filters left, `▽ Filter`
disclosure, page actions right), count strip (`n {noun} · n selected`, bulk
actions, `▥ Columns` menu), the table, pagination footer.

```tsx
const columns: Column<OrgListRow>[] = [
  { key: 'name', header: 'Name', cell: (r) => …, csv: (r) => … },
  { key: 'contact', header: 'Contact', optional: true, cell: …, csv: … },
];
<DataTable columns={columns} rows={rows} rowKey={…} noun="customers" total={data.total} … />
```

- `noun` and `total` drive the count strip (`3 customers`). Give every list one.
- `csv` opts the column into Export CSV; `csvName` enables the menu item. The
  menu button keeps `aria-label="Table options"` and `role="menu"`.
- `optional: true` starts hidden behind `▥ Columns`.
- `filters` is the search plus the two or three selects worth permanent space;
  `moreFilters` goes behind `▽ Filter` with `activeFilterCount` as its badge.
- `onRowClick` is **navigation and nothing else**, and adds the trailing chevron.
  Clicks on a control inside the row never navigate; Enter/Space work.
- `selectable={{ selected, onChange, actions }}` adds the checkbox column and
  the bulk actions in the count strip. Disable them yourself at zero selected
  (`disabled` renders at 0.4 opacity, per the reference). A bulk action runs one
  call per row and reports partial results in one `InfoBanner`
  ("3 approved, 1 could not: …").
- `flagRow` returns a string that becomes the row's `title`. No coloured rule.
- `empty` must say *what would populate the table*, and gets an `action` when
  the operator can create the first row.
- Loading renders `TableSkeleton`, never a spinner.

Rows are 81 px (`px-4 py-5` cells, 40 px avatar); headers 16/700.

## Dialogs — `src/components/Modal.tsx`, `DangerDialog.tsx`

`Modal({ open, title, onClose, children, footer, wide })` — 640 px (960 wide),
`bg-black/60` scrim, 77 px header with ✕ (`aria-label="Close"`), `p-6` body,
`footer` band. Put the actions in `footer`, Cancel first, primary last. A form
puts `id` on the `<form>` and `form={id}` on the footer's submit button.

`DangerDialog` is the destructive confirm: names the target, requires a reason
(the first textbox), collects step-up TOTP unless `requireStepUp={false}`, and
its confirm is the neutral `secondary` button. There is no `danger` variant.

Two rules that have bitten before:

- **Reset dialog state on `open`, not on success**, or cancelling leaves the
  draft and its stale error for the next time.
- Focus lands on the first focusable element **in the body**. If it lands on
  the header's Close button, the search was scoped to the whole panel.

Shared dialogs: `ApproveDialog` (role select with free-seat counts; a 409 shows
inline and keeps it open), `RejectDialog` (no step-up), `DeleteRequestDialog`
(step-up), `AddOrgAdminDialog` (generated password shown once), `SignOutDialog`.

## Shell and personas — `AppShell.tsx`, `ScopeGuard.tsx`, `lib/session.tsx`

A 56 px black bar (wordmark, `GlobalSearch`, bell with count, 44 px avatar →
`ProfileMenu`) on a 48 px black nav row (`aria-label="Primary"`, active item is a
`#262626` fill). Content is a 1440 px centred `<main>`. `Tabs` (48 px, 2 px black
underline, `aria-label` defaults to `Section`) is the in-page idiom; items may
carry `active` for tabs that live in the query string.

Two personas. `useScope()` returns `{ kind: 'global' }` or
`{ kind: 'org', orgId, orgName }`. An organisation admin sees `/org/*`
(Overview · Members · Requests · Devices · Activity), `/profile`, and the member
and device record pages; `ScopeGuard` bounces anything else to
`/org?denied=<path>`, and `/` redirects to `/org`. The org section fetches the
scoped organisation into the same `OrgProvider` the portal admin's record pages
use, so `MembersTable`, `OrgRequestsTable`, `DevicesTable` and `AuditTable` are
shared rather than duplicated. Public pages (sign in, enrolment, first password)
use `PublicShell`.

## Capability-gated controls — `src/lib/permissions.ts`, `src/lib/session.tsx`

```tsx
const canReview = useCan('member.review');
…
{canReview && <Button variant="ghost" size="sm">Approve…</Button>}
```

`useCan` prefers the `capabilities[]` the API returns on `/admin/auth/me` and
falls back to the local matrix in `permissions.ts`, which is a **deliberate
mirror** of `CAPABILITY_MATRIX` in `packages/shared/src/index.ts` (duplicated so
zod stays out of the browser bundle). **Hide, never disable, what a role cannot
do**, and never treat this file as the boundary — it exists so nobody is shown a
button that will 403. If you add a capability, add it in both places;
`tests/e2e/orgs-rbac.spec.ts` walks every role against the real routes.

Portal roles are `owner | admin | support | viewer | org_admin` (`ROLE_LABEL` has
the display strings; `GLOBAL_PORTAL_ROLES` is the four assignable from Portal
users). Member capabilities are `member.review` (approve, reject, delete) and
`member.manage` (role, disable, enable); `user.manage` stays global (create,
rename, import). Org admins are minted from an organisation's Admins tab with
`org_admin.manage`.

## Filters live in the URL — `src/lib/useUrlState.ts`

```tsx
const { values, set, page, reset, activeFilterCount } = useUrlState({ q: '', status: '' });
```

Filter state belongs in the query string so a view can be shared and reloaded.
In-page tabs that select a queue (`?status=rejected`, `?tab=waiting`) follow the
same rule.

## Formatting — `src/lib/format.ts`

`formatDateOnly`, `daysUntil`, and `TimeAgo` for timestamps. Use `tabular-nums`
on anything numeric that stacks vertically. Licence dates are calendar dates in
UTC and never go through `new Date()`.

## Checklist for a new screen

1. `PageHeader` (list or record), then the content.
2. `useUrlState` for filters, `useCan` for every mutating control, `useScope`
   when a link or breadcrumb differs by persona.
3. One `api()` call in a `useCallback`, `useEffect` to fire it, `ErrorNote` on failure.
4. `DataTable` with `noun`, a real `empty` state and `csv` on the columns worth exporting.
5. Dialogs via `Modal` with `footer`, or `DangerDialog`, resetting on open.
6. Statuses through `StatusText`; buttons that open a dialog end in `…`.
7. `pnpm --filter @app/admin typecheck` before you call it done.
