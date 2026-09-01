/**
 * WCAG AA gate for the portal's semantic colour tokens.
 *
 * The theme pass verified every ink against `card` and shipped a set where
 * `ink-3` was 4.39:1 on `paper` and 4.22:1 on `paper-2` — which is to say every
 * column header in the product and all of EmptyState's body text, because
 * `paper` is the page ground and the table `thead` band. Nothing reported it:
 * a build says nothing about colour, and the ratios that were checked all
 * passed. This is the check that would have caught it.
 *
 * Only pairings that actually occur are asserted. `text-allow` on `bg-paper-2`
 * is 4.39:1 and would fail here, but no element in the app combines them — the
 * one line mentioning both is a ternary whose branches never meet. Asserting
 * pairings that cannot happen buys nothing and eventually gets silenced.
 *
 *   pnpm check:contrast
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = path.join(ROOT, 'apps/admin/src/app/globals.css');

const tokens = {};
for (const m of fs.readFileSync(CSS, 'utf8').matchAll(/--([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)/g)) {
  if (!(m[1] in tokens)) tokens[m[1]] = [+m[2], +m[3], +m[4]];
}

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const x = lum(a); const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** [text, ground, what it is on screen] — every pairing the app actually renders. */
const PAIRS = [
  ['ink', 'card', 'primary text on a card'],
  ['ink', 'paper', 'primary text on the page ground'],
  ['ink-2', 'card', 'secondary text'],
  ['ink-2', 'paper', 'secondary text on the page ground'],
  ['ink-2', 'paper-2', 'Toggle off-state label'],
  ['ink-3', 'card', 'labels in a card'],
  ['ink-3', 'paper', 'table column headers, row hover, page ground'],
  ['ink-3', 'paper-2', 'EmptyState body text'],
  ['signal', 'card', 'links and focus'],
  ['signal', 'paper', 'links on the page ground'],
  ['allow', 'card', 'Enable / Verified text'],
  ['allow', 'paper', 'the same on a hovered row'],
  ['deny', 'card', 'destructive text'],
  ['deny', 'paper', 'the same on a hovered row'],
  ['warn', 'card', 'expiry and over-cap warnings'],
  ['warn', 'paper', 'the same on a hovered row'],
  ['signal', 'signal-soft', 'pill'],
  ['allow', 'allow-soft', 'pill'],
  ['deny', 'deny-soft', 'pill'],
  ['warn', 'warn-soft', 'pill'],
];

const AA = 4.5;
let failed = 0;

for (const [fg, bg, what] of PAIRS) {
  if (!tokens[fg] || !tokens[bg]) {
    console.log(`  MISSING  ${fg} / ${bg} — token not found in globals.css`);
    failed += 1;
    continue;
  }
  const r = ratio(tokens[fg], tokens[bg]);
  const ok = r >= AA;
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  ${`${fg} on ${bg}`.padEnd(22)} ${what}`);
}

// `rule` is a hairline, not text, so AA does not apply — but it went from 1.9:1
// to 1.23:1 in the restyle, and at any alpha below full it stops being visible
// at all. That is why the plan promotes every rule/70 and rule/60.
const hairline = ratio(tokens.rule, tokens.card);
console.log(`\n  note: rule on card is ${hairline.toFixed(2)}:1 — a hairline, never text.`);
if (hairline < 1.2) console.log('        below 1.2 it disappears; tables become floating text.');

console.log(`\n${PAIRS.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
