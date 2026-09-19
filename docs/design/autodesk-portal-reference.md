# Autodesk Account portal — UI reference

Captured from `manage.autodesk.com` on 19 Sep 2026, signed in as a primary admin of a team
with **no purchased subscriptions**. Every number below was read with `getComputedStyle` /
`getBoundingClientRect` on the live elements, at a **2072 × 1241 CSS-px viewport**, unless the
row says otherwise. Anything I could not read is written as **not measurable** rather than guessed.

No Autodesk logo, wordmark, illustration or brand image is described or recommended here — only
structure, spacing, type, colour and behaviour.

> **Privacy** — the live account contains one user (the account owner). Before every capture a
> DOM scrubber replaced names, email addresses, team IDs and subscription IDs with
> `Example Company Ltd`, `user@example.com` and `••••••`. No real name, address, order number,
> serial number, licence key or contract number appears in the text of this document.

> **About `captures/`** — screenshots were taken through the browser extension, which renders
> them into the chat rather than onto this machine's disk, so `docs/design/captures/` ships with
> a manifest (`captures/README.md`) naming each numbered file rather than the images themselves.
> Save the images from the conversation under those exact names and every reference below resolves.

---

## Screens

### 1. Home / overview — `captures/01-home.png`

- **Page title** `Good afternoon, {name}` sits at the top-left of the content column, 41 px below
  the black header stack. No breadcrumb.
- **Primary action** `Buy ▾` — a split/dropdown button pinned to the **top-right of the title row**,
  vertically centred on the title.
- **Layout** a 2-up summary strip (a single white panel divided by a vertical hairline: a
  "No subscription purchased yet" cell and an "Open support cases / 0" cell), then a
  `Get Started (1)` accordion card, then a `Learn new skills` horizontal carousel.
- **Section headings** `Summary`, `Get Started (1)`, `Learn new skills` at 21 px / 700, with a
  14 px grey sub-line under them.
- **Tabs** none on this page (the black nav row is the only tab set).
- **Badges / status** none.
- **Animation** the `Learn new skills` carousel has prev/next circular icon buttons; card hover
  is driven by `--industryCardHoverDuration: 600ms` and two custom `linear()` easings
  (`--spring-easing`, `--slow-easing`) exposed on the document element.
- **Empty state wording** "No subscription purchased yet" / "When you subscribe to products, the
  number of available seats and active users appear here." + a `Shop all products` text link.

### 2. Products and services — `captures/02-products.png`

Path `/products/all`. Renders as a bare empty state for this account:

- No page title at all — only a `Can't find a product?` underlined link at the top-left.
- Empty message, left-aligned in the content column, 16 px / 24 px, `#212121`:
  **"No products available. Either you haven't purchased any products or your organization hasn't
  assigned you product access."**
- Primary action `Buy products` directly beneath it (140 × 40 px, black, 4 px radius).
- No breadcrumb, no filters, no search, no table.

### 3. User Management → By user — `captures/03-user-management-by-user.png`

The richest screen in the portal and the best template for an admin list.

- **Page title** `User Management`, 28 px / 33.6 px / 700, top-left, no breadcrumb.
- **Tabs** `By user · By product · By group` immediately under the title — text tabs, 48 px tall,
  16 px, active 700 / `#000` with a 2 px black underline; inactive 600 / `rgba(0,0,0,.6)`.
  A 1 px hairline runs the full content width under the tab strip.
- **Context row** `Team [select ▾]` plus a `⊕ Team settings` icon-link to its right.
- **Toolbar** (top of the table card): search field on the **left**, `▽ Filter` button beside it,
  `Invite users` primary (black, 32 px) and a `···` overflow button on the **right**.
- **Selection bar** (second strip of the same card): `1 user` `0 selected`, then two
  context actions `Remove users` and `Change role`, both **disabled at 0.4 opacity** until a row
  is checked.
- **Table columns** `[select-all checkbox] · Name (avatar + name + email) · Role · Account status ·
  Products assigned · [row chevron →]`.
- **Row height** 81 px (header row 69 px); cell padding 16 px all round; 40 px circular avatar.
- **Status values** are plain grey text, **not** coloured pills — `Primary admin`, `Verified`, `None`.
- **Animation** a dismissible coach-mark tooltip (dark `#535353` bubble with a caret and an ✕)
  points at the selection bar on first visit.

### 4. User Management → By product — `captures/04-user-management-by-product.png`

Path `/uma/product-list/products`. Tabs and title persist; the panel below renders **completely
blank** — no table, no message, no illustration. Worth noting as a gap: the By-user tab and the
Products page both give the admin a sentence, this one gives nothing.

### 5. One user's detail page — `captures/05-user-detail.png`

- **Breadcrumb** `User management by user / {user}` — 14 px / 20 px, `rgba(0,0,0,.6)`, slash
  separator, above the title.
- **Page header** 48 px avatar + `{name}` at **34 px / 40.8 px / 800 ArtifaktLegend** with the role
  (`Primary admin`) as a 22 px / 700 sub-line under it.
- **Secondary actions** `Change role` and `Edit assigned groups` — outline buttons, top-right,
  aligned with the title, 40 px tall.
- **Info banner** full content width, `rgba(95,96,255,0.1)` fill with a **1 px `#5F60FF` border**,
  square corners, 1 px 16 px padding, ⓘ icon left: "To delete this admin or to change roles,
  please select a new primary admin."
- **Detail card** white, 8 px radius, 1 px `#D9D9D9`, no shadow. A definition list where labels are
  14 px / 700 black and values 14 px / 400 `rgba(0,0,0,.6)`: Assigned groups, Email, Autodesk ID,
  Account status, Added to team. A hairline separates the first row from the rest.
- **Segmented control** `Assigned (0)` / `Unassigned (0)` — 32 px tall, 4 px radius; the selected
  segment is white with a 1 px black border, the unselected one is transparent with a transparent
  border and `rgba(0,0,0,.6)` text.
- **Empty state** "No products unassigned" — 14 px, centred in its own white card.
- **Loading** this page shows the portal's only skeleton state (see Interactions).

### 6. Billing and orders — `captures/06-billing-and-orders.png`

- **Page title** `Billing and orders`, top-left; `🛒 Buy ▾` dropdown top-right.
- **Sub-tabs** 8 of them: `Summary · Subscriptions and contracts · Quotes · Invoices and credit
  memos · Upcoming payments · Order history · Payment methods · Customer details`.
  Same text-tab style as User Management.
- **KPI strip** one white panel (6 px radius, 1 px `#D8D8D8`, 36 px padding) split by vertical
  hairlines into four cells. Each cell: label (optionally with a `(next 90 days)` qualifier in
  lighter text), a large numeral, an optional 12 px **italic** helper line, and a
  `⊕ Manage …` link anchored to the bottom of the cell.
- **Subscriptions panel** heading sentence `You have 1 subscription or contract` + an underlined
  `⊕ Manage all` link, with an `Export` outline button on the far right; inside it a nested
  product tile (product icon + name, then label/value rows separated by hairlines, then a
  `Manage` small outline button and a `···` overflow).
- No breadcrumb. No status badges.

### 7. Reporting hub and Usage report — `captures/07a-reporting-hub.png`, `captures/07b-usage-report.png`

**Hub** (`/reports`): title `Reporting`, an `⊕ Email settings` link on the right, then a
**3-column card grid**. Card = 469 × 267 px, white, 8 px radius, border drawn as
`box-shadow: inset 0 0 0 1px rgba(0,0,0,.1)`, 24 px inner padding. Each card holds a 21 px / 700
title, a 14 px / 17.5 px `rgba(0,0,0,.6)` description, a hairline, and a bottom-anchored
`⊕ View` link. Seven cards: Usage report, Seat usage, Token Usage, Balances, Resource and API
usage, Activity log, Insights, plus an `⊕ Create` variant on Export.

**Usage report** (`/usage-report`):

- Breadcrumb `Reporting / Usage report`; title `Usage Report`.
- Header-right cluster: `Is this report helpful? 👍👎`, an `Export` outline button, and a circular
  icon button.
- Filter row: `Team [select]` on the left, `Date range: [Past 3 months]` on the right.
- A separate white strip holding just the `▽ Filter` button.
- Two stat panels side by side (`Subscriptions`, `Flex`), each divided into columns of
  label + large numeral, with ⓘ info icons next to the metric names and a 12 px unit line
  (`days/month`) under some values.
- Table below: `0 results` count on the left, `▥ Columns` button on the right; columns
  `[checkbox] · Name ↑ · Team · Product · Access option · Days used · Monthly average · Tokens used`.
  The sorted column carries a small `↑` next to its label.
- **Empty state** a large outline warning triangle, centred, with
  "No matches found for the selected team, date range, and filters." beneath it.

### 8. Profile / avatar menu — `captures/08-profile-menu.png`

Opens from the 44 px circular avatar at the far right of the top bar (two-letter initials on a
coloured disc — the colour is generated, it changed between page loads).

- White flyout, ~256 px wide, anchored under the avatar, right-aligned, with its own internal
  scrollbar.
- Top block: display name (700) over email (secondary), then a **full-width outlined `Sign out`
  button** — 14 px / 21 px / 700, 1 px black border, **2 px radius** (the universal header uses a
  2 px radius while the account app uses 4 px).
- Then grouped sections, each a 24 px outline icon + a 16 px / 700 heading with 14 px / 400 links
  indented beneath:
  - **Account** — Products and services, Product updates, Payment methods, Subscriptions and
    Contracts, Trials, Support cases
  - **My profile and settings** — Password and security, Language, Communications, Product privacy
  - **My community** — (below the fold)
- **Does Sign out confirm?** **Not verified** — I did not click it, to avoid ending the session.

### 9. Empty state — `captures/02-products.png` (see also 04, 05, 07b)

The portal has no single empty-state component; four different treatments coexist:

| Where | Treatment | Wording |
|---|---|---|
| Products and services | left-aligned sentence + primary button | "No products available. Either you haven't purchased any products or your organization hasn't assigned you product access." |
| Home summary card | card heading + body + text link | "No subscription purchased yet" / "When you subscribe to products, the number of available seats and active users appear here." |
| Usage report table | centred outline warning triangle + sentence | "No matches found for the selected team, date range, and filters." |
| User detail | centred sentence in a bare card | "No products unassigned" |
| Invite dialog | inline sentence under a section heading | "No products available to assign." / "There aren't any groups set up for this team  Create your first group" |
| By product tab | **nothing at all** | — |

None of them uses an illustration.

### 10. Dialog that adds something — `captures/10-invite-users-dialog.png` (opened, not submitted)

`Invite users`, opened from the User Management toolbar and closed with **Cancel**.

- **640 px wide**, 4 px radius, centred, MUI elevation shadow, scrim `rgba(0,0,0,.6)`.
- **Header** 77 px tall, 24 px padding, title left at 20 px / 700, **✕ close button top-right**,
  1 px `#D9D9D9` bottom border.
- **Body** its own tab set inside the dialog (`Invite Single` / `Import with CSV`, same underline
  tab style), then the form: `First name` and `Last name` side by side, `Email address` full width,
  then two optional sections with 14 px / 700 headings (`Assign products (optional)`,
  `Add to groups (optional)`).
- **Labels sit above their fields**, 12 px / 18 px / 400.
- **Footer** 89 px tall, 24 px padding, 1 px top border, buttons **right-aligned with the primary
  last**: `Cancel` (outline) then `Send invite` (black, **disabled at opacity 0.4** until the form
  is valid).

### 11. Destructive confirmation — **not observable**

`Remove users` is the destructive action in this portal, but the account contains a single user
who is the primary admin, so the control is permanently disabled ("To delete this admin or to
change roles, please select a new primary admin."). I did not manufacture a deletable user.
What *is* recorded: the disabled treatment (opacity 0.4, `pointer-events: none`, no colour change)
and the fact that **no `danger`/red button variant appears anywhere in the portal** — destructive
actions are rendered in the same neutral outline style as everything else.

### 12. Table with filters, search and pagination — `captures/03-user-management-by-user.png`, `captures/07b-usage-report.png`

- Search and `Filter` sit **inside the table card, above the header row**, left-aligned; primary and
  overflow actions sit on the same strip, right-aligned.
- The Usage Report adds a right-aligned `▥ Columns` button for column visibility and puts the
  result count (`0 results`) at the left of that strip.
- **Pagination: not observable** — neither table exceeded one page in this account, and no
  pagination control renders at low row counts.
- A filter applied on the Usage Report resolves to the "No matches found…" state above rather than
  to a filtered list, because the account has no usage data.

### 13. Toast / notification — **not observable**

Cancelling the invite dialog, dismissing the coach-mark and closing the survey modal produced no
toast, snackbar or inline confirmation anywhere on screen. The portal does expose a
`--feedback*` token family (`--feedbackBackgroundColor: #f5f5f5`, `--feedbackBorderColor: #e5e5e5`,
`--feedbackTextColorV2: #212121`, `--feedbackFilledCompleteIconColorV2: #2bc275`) which is the
likely toast palette, but I never saw one render, so position, duration and dismissibility are
**not measurable**.

---

## Layout

| Name | Value | Where measured |
|---|---|---|
| Top bar height | `56px` | `.uh-container-wrapper`, Home |
| Top bar inner container | `max-width 1600px`, centred | `.MuiContainer-maxWidthLg` inside the top bar |
| Nav tab row height | `48px` | `.MuiTabs-root`, User Management |
| Total black header stack | `104px` | 56 + 48, all pages |
| Content column width | `1440px` | `<table>` and page-title wrappers, User Management + Home |
| Outer gutters | `309px` left / `323px` right at a 2072 px viewport (= `margin: auto` on a 1440 px column; the 14 px difference is the scrollbar) | page-title wrapper, User Management |
| Gutters at 1024 px | ~`18px` | same page rendered in a 1024 px same-origin iframe |
| Title offset below header | `41px` (title top 145 px − header 104 px) | `User Management` title |
| Breadcrumb → title gap | `16px` | user detail page |
| Title → tab strip gap | `16px` | User Management |
| Toolbar → table card gap | `24px` | User Management |
| Anchor gap (floating elements) | `--anchor-gap-x: 24px`, `--anchor-gap-y: 24px` | document element |
| Left navigation | **none** | the portal has **no sidebar** — navigation is the horizontal black tab row |

There is no collapsible side nav to model. If your admin portal needs one, it is an addition to
this system, not a copy of it.

## Typography

Two typefaces, both Autodesk's own: **ArtifaktLegend** for display headings and **ArtifaktElement**
for everything else. Substitute your own display/UI pair; the size–weight ladder is the part worth
copying.

| Name | Value | Where measured |
|---|---|---|
| `font-family` (UI) | `ArtifaktElement` | `document.body`, all pages |
| `font-family` (display) | `ArtifaktLegend` | Home greeting, user-detail H1 |
| H1 — record page | `34px / 40.8px / 800` `#000` | user detail page name |
| H1 — list page | `28px / 33.6px / 700` `#000` | `User Management` |
| H1 — dashboard greeting | `26px / 31.2px / 800` `#000` | Home |
| H2 — section | `21px / 26.25px / 700` `#000` | `Summary` (Home), report card titles |
| H3 — dialog title | `20px / 700` | Invite users dialog header |
| Body | `16px / 24px / 400` `#212121` | Products empty-state sentence |
| Body small | `14px / 21px / 400` `#000` | user-detail values, count bar |
| Meta / secondary | `14px / 21px / 400` `rgba(0,0,0,0.6)` | user-detail values, breadcrumb |
| Card description | `14px / 17.5px / 400` `rgba(0,0,0,0.6)` | Reporting hub cards |
| Helper (italic) | `12px / 18px / 400 italic` `#212121` | Billing "Need a quote?" line |
| Form label | `12px / 18px / 400` `#000` | Invite dialog `First name` |
| Table header cell | `16px / 20px / 700` `#000`, `padding: 16px` | `th`, User Management |
| Table body cell | `16px / 20px / 400` `#000`, `padding: 16px` | `td`, User Management |
| Button — large | `16px / 20px / 600` | `Cancel`, `Export`, `Change role` |
| Button — primary large | `16px / 20px / 700` | `Buy products` |
| Button — small | `14px / 20px / 600` | `Invite users`, `Remove users` |
| In-page tab — active | `16px / 20px / 700` `#000` | `By user` |
| In-page tab — inactive | `16px / 20px / 600` `rgba(0,0,0,0.6)` | `By product` |
| Nav tab | `14px / 20px / 700` `#fff` | black nav row |
| Nav brand label | `18px / 20px / 700` `#fff` | `Account` |
| `letter-spacing` | `normal` everywhere | every element sampled |
| `text-transform` | `none` everywhere — **no uppercase labels** | buttons, table headers, tabs |

## Colour tokens

Values marked *(exposed)* are real CSS custom properties read off the document element; the rest
are computed values off the elements named.

| Name | Value | Where measured |
|---|---|---|
| Page background (account MFEs) | `#F5F5F5` — `--level0BackgroundColor` *(exposed)* | document element |
| Page background (billing MFE) | `rgb(249,249,249)` `#F9F9F9` | billing page wrapper |
| Surface / card | `#FFFFFF` — `--cardBackgroundColor` *(exposed)* | user-detail card, all panels |
| Text primary | `#000000` — `--primaryTextColor: #3c3c3c` *(exposed, but elements compute to `#000`)* | headings, table cells |
| Text primary (body copy) | `rgb(33,33,33)` `#212121` | Products empty-state sentence |
| Text primary (MUI default) | `rgba(0,0,0,0.87)` | `<table>`, dialog root |
| Text secondary | `rgba(0,0,0,0.6)` | breadcrumb, card descriptions, inactive tabs |
| Text on dark | `#FFFFFF` | top bar, nav tabs |
| Border — card (User Management) | `rgb(217,217,217)` `#D9D9D9` | user-detail card, dialog header rule |
| Border — panel (Billing) | `rgb(216,216,216)` `#D8D8D8` | billing KPI panel |
| Border — table outline | `rgba(204,204,204,0.5)` as **inset box-shadow**, not a border | `<table>`, User Management |
| Border — table header rule | `rgba(0,0,0,0.1)` | `thead tr` bottom border |
| Border — report card | `rgba(0,0,0,0.1)` as `inset 0 0 0 1px` | Reporting hub card |
| Divider (tab strip, list rows) | `rgb(212,219,225)` / `rgba(0,0,0,0.1)` | tab underline rail, flyout rows |
| Primary action background | `#000000` | `Invite users`, `Buy products` |
| Primary action text | `#FFFFFF` | same |
| Nav active background | `rgb(38,38,38)` `#262626` | selected nav tab |
| Link | `#006EAF` — `--linkColor` *(exposed)* | document element |
| Focus accent | `#0696D7` — `--bottomFocusOutlineColor` *(exposed)* | document element |
| Row hover | `#F7F7F7` — `--tableRowHoverBackgroundColor` *(exposed)* | document element |
| Table stripe (even) | `#FFFFFF` — `--tableStripeEvenBackgroundColor` *(exposed)* | document element |
| Table header background | `transarent` *(exposed — **the typo is Autodesk's**, so the declaration is invalid and the header falls back to transparent)* | `--tableHeaderBackground` |
| Info | `rgb(95,96,255)` `#5F60FF` border on `rgba(95,96,255,0.1)` fill | user-detail admin banner |
| Success | `#2BC275` — `--feedbackFilledCompleteIconColorV2` *(exposed)* | document element |
| Error / over-assigned | `#DD2222` — `--progressbar-over-assigned: #d22` *(exposed)* | document element |
| Warning | **not measurable** — no warning state rendered in this account | — |
| Tooltip background / text | `#535353` / `#F5F5F5` — `--tooltipBackgroundColor`, `--tooltipTextColor` *(exposed)* | document element |
| Flyout background / text / radius | `#FFFFFF` / `#3C3C3C` / `4px` — `--flyout*` *(exposed)* | document element |
| Dialog scrim | `rgba(0,0,0,0.6)` | modal backdrop |
| Search field fill | `rgba(0,0,0,0.04)` | User Management search |
| Disabled | `opacity: 0.4` + `pointer-events: none` (no colour change) | `Remove users`, `Send invite` |

Other exposed properties worth knowing: `--tabIndicatorColor: #3c3c3c`, `--smallTextColor: #3c3c3c`,
`--buttonOutlineColor: #000`, `--progressbar-assigned: #000`, `--progressbar-available: #fff`.

## Spacing

Observed values, not a published scale — **4 / 8 / 12 / 16 / 20 / 24 / 36**, with 16 and 24 doing
most of the work.

| Name | Value | Where measured |
|---|---|---|
| Table cell padding | `16px` | `th`, `td` |
| Card / dialog padding | `24px` | dialog header and footer, report card |
| Panel padding (billing) | `36px` | billing KPI panel |
| Card padding (user detail) | `0 20px 20px` | user-detail card |
| Button padding — large | `8px 20px` (outline variant `9px 20px`) | `Buy products`, `Export` |
| Button padding — small | `4px 12px` | `Invite users` |
| Segmented control padding | `4.5px 16px` | `Assigned (0)` |
| Tab padding | `12px 16px` | nav tabs and in-page tabs |
| Field padding | `8px 12px` | invite dialog text field |
| Select padding | `10px 32px 10px 12px` | Team select |
| Floating anchor gap | `24px` | `--anchor-gap-x/y` |
| Header row / body row height | `69px` / `81px` | User Management table |

## Components

| Component | Screens seen on | Notes |
|---|---|---|
| Top bar (universal header) | all | 56 px, `#000`, full-bleed; logo · search field · (spacer) · bell · 44 px avatar. Its own button radius is 2 px, unlike the 4 px used everywhere below it. |
| Global search | all | 295–308 px × 40 px, fill `rgba(0,0,0,.04)`, 4 px radius, leading magnifier icon, no border. Collapses to an icon below ~1024 px. |
| Nav tab bar | all | 48 px, `#000`; items `12px 16px`, 14 px/700; active item gets a `#262626` fill (not an underline). |
| Avatar / profile flyout | all | 44 px disc, generated colour, 2-letter initials. Flyout: name + email, full-width outline `Sign out`, then icon-headed link groups; scrolls internally. |
| Breadcrumb | 5, 7b | 14 px `rgba(0,0,0,.6)`, ` / ` separator, above the H1. Absent on top-level pages. |
| Page header | all | Title left, actions right on the same baseline. Record pages add a 48 px avatar and a role sub-line. |
| In-page tabs | 3, 4, 5, 6, 7b, 10 | Text tabs on a full-width hairline rail, 2 px underline indicator, 48 px tall. Used for page sections *and* inside dialogs. |
| Segmented control | 5 | 32 px, 4 px radius; selected = white + 1 px black border, unselected = transparent. |
| Card / panel | 1, 5, 6, 7a | White, **8 px radius + 1 px `#D9D9D9`** (account) or **6 px radius + 1 px `#D8D8D8`** (billing) or **8 px + `inset 0 0 0 1px rgba(0,0,0,.1)`** (reporting). **No shadows anywhere except dialogs.** |
| KPI cell strip | 1, 6, 7b | One panel, vertical hairlines instead of separate cards; label · big numeral · optional italic helper · bottom-anchored `⊕ Manage …` link. |
| Data table | 3, 7b | Toolbar and selection bar are the top of the same card as the table; borders drawn with inset shadows; 81 px rows; status shown as plain text, never a pill. |
| Toolbar (search + filter + actions) | 3, 7b | Search + `▽ Filter` left, primary + `···` right, inside the card. |
| Bulk-selection bar | 3 | `n user(s)` + `n selected` + context actions, disabled at 0.4 opacity until selection. |
| Button — primary | 2, 3, 5, 6, 10 | Black fill, white text, 4 px radius, 1 px black border. Large 40 px / small 32 px. |
| Button — secondary (outline) | 5, 6, 7b, 10 | Transparent, 1 px black, black text, same metrics as primary. |
| Button — link/ghost | 1, 6, 7a | 14 px/600 black, no border, `4px 0` padding, often with a circled-arrow icon. |
| Button — danger | — | **does not exist**; destructive actions use the neutral outline style. |
| Dropdown button | 1, 6 | `Buy ▾` with a leading cart icon and trailing chevron; outline style. |
| Select | 3, 7b | 43 px tall, 4 px radius, trailing chevron, no fill. |
| Text field | 10 | Wrapper 40 px, 4 px radius, `8px 12px`; label above at 12 px. |
| Info banner | 5 | Square corners, 1 px `#5F60FF` on 10 % tint, ⓘ icon, full content width. |
| Dialog | 10 | 640 px, 4 px radius, ✕ top-right, 24 px padding, bordered header and footer, primary **on the right**. |
| Coach-mark tooltip | 3 | `#535353` bubble, white 14 px text, caret, dismiss ✕. |
| Skeleton loader | 5 | Grey rounded blocks in the shape of the final layout. |
| Icon | all | Outline, `0 0 24 24` viewBox, **`stroke-width: 1.5`**, `currentColor`, drawn at 16 px or 24 px. Circled-arrow (`⊕`) is the house style for "go here" links. |
| Avatar (row) | 3, 5 | 40 px circle (48 px on the record page). |
| Footer | all | Light strip with pipe-separated legal links at 12 px + a floating `Privacy settings` link bottom-left. |

## Interactions

- **Hover** — `--tableRowHoverBackgroundColor: #F7F7F7` for table rows; button hover states are
  defined through `:hover` rules I could not resolve to a value without synthesising a pointer
  event, so button hover fills are **not measurable**. (`--buttonHoverColor: #8080ff` is exposed on
  the document element but nothing in the account app uses it.)
- **Focus** — handled with `:focus-visible` (173 such rules across the 203 loaded stylesheets), so
  focus rings appear on keyboard navigation only. Programmatic `.focus()` on a button or input
  computes `outline: none`, so the exact ring is **not measurable**; the intended accent is
  `--bottomFocusOutlineColor: #0696D7`.
- **Disabled** — `opacity: .4` and `pointer-events: none`, with no colour or border change.
  Applies to `Remove users`, `Change role` and the dialog's `Send invite`.
- **Selection** — checking a row enables the bulk-action buttons in place; the count bar updates.
- **Loading** — skeletons, not spinners: on the user detail page the breadcrumb renders live while
  a grey block stands in for the avatar, a wide bar for the title, three bars for the header
  buttons, and label-width bars inside the card. Nothing animates a progress bar; no spinner was
  observed anywhere.
- **Toasts** — none observed; see screen 13.
- **Dialogs** — open over a `rgba(0,0,0,.6)` scrim, dismissible by ✕ or `Cancel`; the primary
  action stays disabled until the form validates.
- **Motion** — the only custom motion tokens are on the marketing-style carousel:
  `--industryCardHoverDuration: 600ms` plus two `linear()` easing curves (`--spring-easing`,
  `--slow-easing`). Tabs, dialogs and menus use MUI defaults; nothing in the admin surfaces
  animates conspicuously.
- **Third-party overlay** — a feedback survey modal can interrupt any page. It is a vendor widget,
  not part of the design system: 480 px wide, `#272727` buttons with **2 px** borders, stacked
  full-width actions. Don't copy its styling.

## Responsive and theme

Measured by rendering the same page in a same-origin iframe at fixed widths, since the browser
window itself could not be resized.

**At ~1024 px**

- A hamburger button appears at the far left of the top bar and the logo shifts right of it.
- The global search field collapses to a magnifier icon button.
- Outer gutters drop from ~309 px to ~18 px; the content column goes effectively full-bleed.
- The nav tab row still shows all seven items.
- Table columns compress; `Primary admin` wraps to two lines. Row height grows with the wrap.

**At ~768 px**

- Same top bar treatment (hamburger + collapsed search).
- The nav tab row **overflows horizontally and is clipped** — it becomes a scrollable strip.
- The table gets its **own horizontal scrollbar** with visible left/right arrows; the Name cell
  wraps to three lines (name / name-continued / email).
- The toolbar keeps search + Filter on the left and the primary button on the right; nothing stacks.

**Theme**

- **Light only.** Zero `prefers-color-scheme` rules across all 203 loaded stylesheets.
- The document element carries `lang`, `data-locale`, `data-env`, `data-path` — **no** `data-theme`
  attribute, and there is no theme switch in the avatar menu or in Settings.
- Dark-looking custom properties do exist (`--cardBackgroundColor: #454f61`,
  `--paper-background-color: rgb(51,51,51)`, `--AppBar-background: #1976d2`) but they belong to a
  bundled vendor widget's stylesheet and are never applied to the account pages.

## What makes it feel like Autodesk

Ranked by how much each one changes the impression, from a plain Tailwind admin:

1. **The 104 px black header stack, and no sidebar at all.** A 56 px pure-`#000` utility bar sitting
   on a 48 px pure-`#000` nav tab row, full-bleed, with the active section marked by a `#262626`
   fill rather than an underline. Everything below is light. Nothing says "Autodesk" faster, and
   nothing is further from the default `sidebar + light topbar` admin shell.
2. **Black as the brand colour.** The primary button is `#000` on white; there is no blue, indigo
   or "brand-500" anywhere in the chrome. Colour appears only as information — `#5F60FF` for an
   info banner, `#006EAF` for links, `#2BC275`/`#DD2222` in tokens.
3. **Artifakt.** Two weights of one bespoke family — `ArtifaktLegend` at 800 for page titles,
   `ArtifaktElement` everywhere else — with `letter-spacing: normal` and **no uppercase anywhere**.
   Inter/system-ui at 600 reads as a different product immediately.
4. **Very heavy UI type.** Table headers are 16 px **700**. Buttons are 600–700. Tabs are 600–700.
   Tailwind admins default to 14 px / 500 labels; this portal is a step bolder and a step larger
   throughout, and that alone makes a clone feel wrong.
5. **Borders instead of shadows.** Every card and panel is a 1 px hairline (`#D9D9D9`, `#D8D8D8`,
   or an `inset 0 0 0 1px` shadow faking one) on a 6–8 px radius, with `box-shadow: none`.
   The *only* shadow in the whole portal is on the modal. Drop `shadow-sm` entirely.
6. **The toolbar lives inside the table card.** Search, `Filter`, the primary action and the
   selection bar are the top two strips of the same rounded container as the table — not a
   separate row floating above it. The table's own outline is even drawn with inset box-shadows so
   the seam disappears.
7. **Roomy rows on a tight grid.** 81 px table rows and 16 px cell padding with a 40 px avatar,
   against a spacing scale that is otherwise conservative (4 / 8 / 12 / 16 / 24). Tailwind's
   `py-3` rows feel cramped next to it.
8. **Statuses are text, not pills.** `Primary admin`, `Verified`, `None` are plain grey words in
   their columns. There are no coloured badges and no `danger` button variant — even
   `Remove users` is a neutral outline button that simply drops to `opacity: .4` when unavailable.
9. **Outline icons at `stroke-width: 1.5` on a 24 px grid, and the circled arrow.** Every
   "go here" affordance — `⊕ Manage quotes`, `⊕ View`, `⊕ Team settings` — is a thin arrow inside a
   ring, at 14 px/600 black with no underline. It is the portal's most-repeated motif.
10. **A 1440 px content column with enormous gutters, and MFE seams.** The content is capped at
    1440 px (the header at 1600 px) and centred, leaving ~300 px of `#F5F5F5` on each side at desk
    width. Because each section is a separately-deployed micro-frontend, small inconsistencies are
    part of the texture: card radius 8 px vs 6 px, border `#D9D9D9` vs `#D8D8D8`, page background
    `#F5F5F5` vs `#F9F9F9`, header button radius 2 px vs 4 px — and a shipped typo,
    `--tableHeaderBackground: transarent`. Pick one value per token; you do not need to reproduce
    the drift.
