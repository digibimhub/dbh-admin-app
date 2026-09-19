# captures/

Screenshots referenced by `../autodesk-portal-reference.md`.

They were taken through the browser extension, which delivers images into the chat rather than
onto the machine that wrote this document, so the image files are not committed here. Save each
one from the conversation under the exact filename below and every reference in the reference
document resolves.

All captures were taken with a DOM scrubber active: names, email addresses, team IDs and
subscription IDs are replaced with `Example Company Ltd`, `user@example.com` and `••••••`.

| # | Filename | Screen |
|---|---|---|
| 1 | `01-home.png` | Home / overview after sign-in |
| 2 | `02-products.png` | Products and services (also serves as the empty state, screen 9) |
| 3 | `03-user-management-by-user.png` | User Management → By user (also screen 12) |
| 4 | `04-user-management-by-product.png` | User Management → By product |
| 5 | `05-user-detail.png` | One user's detail page |
| 5b | `05b-user-detail-skeleton.png` | The same page mid-load, showing the skeleton state |
| 6 | `06-billing-and-orders.png` | Billing and orders → Summary |
| 7a | `07a-reporting-hub.png` | Reporting hub (card grid) |
| 7b | `07b-usage-report.png` | Reporting → Usage report (also screen 12) |
| 8 | `08-profile-menu.png` | Avatar / profile menu, opened |
| 10 | `10-invite-users-dialog.png` | Invite users dialog, opened and then cancelled |
| 12a | `12a-responsive-1024.png` | User Management rendered at 1024 px |
| 12b | `12b-responsive-768.png` | User Management rendered at 768 px |

Not captured, and why:

- **11 — destructive confirmation.** The only user in the account is the primary admin, so
  `Remove users` is permanently disabled. No deletable user was created to force the dialog.
- **13 — toast.** No toast, snackbar or inline confirmation rendered after any of the harmless
  actions performed (cancelling the invite dialog, dismissing the coach-mark, closing the survey
  modal).
