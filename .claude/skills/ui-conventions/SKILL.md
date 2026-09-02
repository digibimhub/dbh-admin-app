---
name: ui-conventions
description: How screens in the admin portal are built — the ui.tsx primitives, DataTable, Modal, capability-gated controls, URL-backed filters, and the tone/format rules. Load before adding or changing any screen, table, dialog, form or status indicator in apps/admin.
---

# Admin portal UI conventions

Everything lives in `apps/admin/src/`. There is a real design system here; do not
hand-roll a `<table>`, a `<dialog>`, or a coloured `<span>`.

## Primitives — `src/components/ui.tsx`

Import from `@/components/ui`. Never restyle these inline beyond a `className`
that adjusts layout.

| Primitive | Use for |
| --- | --- |
| `PageHeader({ eyebrow, title, lede, actions })` | Top of a detail screen |
| `Section({ title, note, actions })` | A card-ish grouping inside a screen |
| `Button({ variant })` | `primary` \| `secondary` (default) \| `ghost` |
| `Field({ label, hint })` | Label + control in a dialog |
| `FieldRow({ cols })` | Two to four `Field`s side by side |
| `Row({ label, hint, htmlFor, width })` | Label + control inside `FormGrid` |
| `FormGrid` / `FormBar` | Settings-style forms and their action bar |
| `TextInput` / `TextArea` / `Select` / `Toggle` | Controls |
| `Pill({ tone })` / `StatusPill({ status })` | Status and counts |
| `TimeAgo({ value })` | Any timestamp — relative, absolute on hover |
| `EmptyState` / `Loading` / `ErrorNote` / `Note` | The four states |
| `DefList({ items })` | Label/value pairs |

### Never align a row of fields with `items-end`

A `Field` with a `hint` is taller than one without, so `items-end` (or
`items-center`) on the row pushes every other input down by the height of a hint
that is not theirs. That was live on the panels form for months. Use `FieldRow`,
which flows its fields from the top; put the submit button after it, not in it.
Filter bands built from bare controls are the exception and stay `items-end`.

### Pill tones carry meaning

`PillTone = 'neutral' | 'signal' | 'allow' | 'deny' | 'warn'`.

Prefer `StatusPill` — it already maps the domain vocabulary
(`active`→allow, `trial`→signal, `pending`/`stale`→warn,
`suspended`/`disabled`/`expired`/`cancelled`/`rejected`→deny, `churned`→neutral).
Reach for a raw `Pill` only for a number that means *act on this*, and follow the
rule already in `orgs/page.tsx`: **a pill only where the number is actionable.**
A healthy zero renders as plain muted text, not a pill.

## Tables — `src/components/DataTable.tsx`

One component covers list screens. Define `Column<T>[]` and pass rows; do not
build markup.

```tsx
const columns: Column<OrgListRow>[] = [
  { key: 'name', header: 'Name', cell: (r) => …, csv: (r) => … },
  { key: 'contact', header: 'Contact', optional: true, cell: …, csv: … },
];
```

- `csv` opts the column into the CSV export; omit it and the column is skipped.
  Pass `csvName` to enable the export menu item at all.
- `optional: true` starts hidden behind the columns menu (`⋯`).
- `className` / `headClassName` — use `text-right` for numeric columns, and
  `tabular-nums` on the value so digits align.
- `onRowClick` is **navigation and nothing else**. No drawers: the row already
  has a detail page. Keyboard activation (Enter/Space) is handled for you.
- `flagRow` returns a string to draw a left warn rule and set the row title —
  use it for "needs attention", not decoration.
- `empty` is required and must say *what would populate the table*, not "no data".
  Give it an `action` when the operator can create the first row.
- `pagination={<Pagination …/>}` renders as a footer of the same card.
  `PAGE_SIZE` is 50 and pagination is server-side.

## Dialogs — `src/components/Modal.tsx`, `DangerDialog.tsx`

`Modal` traps focus, restores it on close, locks body scroll and closes on
Escape. `DangerDialog` is the destructive-confirm variant and resets its state on
open.

Two rules worth knowing because they have bitten before:

- **Reset dialog state on `open`, not on success.** Otherwise cancelling leaves
  the draft — and any stale error — for the next time the dialog is opened.
- Focus lands on the first focusable element. If a dialog opens with focus on the
  header's Close button, that is this bug: the search must be scoped to the body,
  not the whole panel.

## Capability-gated controls — `src/lib/permissions.ts`, `src/lib/session.tsx`

```tsx
const canCreate = useCan('org.create');
…
{canCreate && <Button variant="primary">Add organisation</Button>}
```

`permissions.ts` is a **deliberate mirror** of `CAPABILITY_MATRIX` in
`packages/shared/src/index.ts` — duplicated so zod stays out of the browser
bundle. The API enforces the same table with `requireCapability`.

**Hide, never disable, what a role cannot do**, and never treat this file as the
boundary — it exists so nobody is shown a button that will 403.
If you add a capability, add it in *both* places, and `tests/e2e/orgs-rbac.spec.ts`
walks every role against the real routes so the copies cannot drift silently.

Portal roles are `owner | admin | support | viewer` (`ROLE_LABEL` has the display
strings). These are **not** the org member roles — those live in the `roles`
table, are data rather than an enum, and default to `user` (`is_default`).

## Filters live in the URL — `src/lib/useUrlState.ts`

```tsx
const { values, set, page, reset, activeFilterCount } = useUrlState({ q: '', status: '' });
```

Filter state belongs in the query string so a view can be shared and reloaded.
Put the two or three filters worth permanent space in `filters`; put the rest in
`moreFilters` and pass `activeFilterCount` so an active filter cannot hide inside
a collapsed disclosure.

## Formatting — `src/lib/format.ts`

`formatDateOnly`, `daysUntil`, and `TimeAgo` for timestamps. Use `tabular-nums`
on anything numeric that stacks vertically.

## Checklist for a new screen

1. `PageHeader` (or the `h2` + count pattern in `orgs/page.tsx`).
2. `useUrlState` for filters, `useCan` for every mutating control.
3. One `api()` call in a `useCallback`, `useEffect` to fire it, `ErrorNote` on failure.
4. `DataTable` with a real `empty` state and `csv` on the columns worth exporting.
5. Dialogs via `Modal`/`DangerDialog`, resetting on open.
6. `pnpm --filter @app/admin typecheck` before you call it done.
