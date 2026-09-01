import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeQr } from './qr.ts';

/**
 * The QR encoder exists twice on purpose.
 *
 * `apps/admin` has no workspace dependencies, and `@app/core`'s barrel
 * re-exports `crypto.ts`, which imports `@node-rs/argon2` — a native binary.
 * `QrCode.tsx` is a client component, so importing the encoder from `@app/core`
 * would pull a `.node` file into the browser bundle. Copying ~400 lines of a
 * frozen, pure function is the cheaper of the two bad options.
 *
 * What copying cannot survive is drift: a bug fixed in one and not the other
 * produces codes that scan in the terminal and not in the browser, or the
 * reverse, and nothing anywhere would report it. This is that report.
 *
 * `packages/core/src/qr.ts` is a strict superset — the admin file, plus
 * `qrToTerminal`, which has no business in a React component.
 */
describe('QR encoder copies', () => {
  const norm = (p: string): string =>
    readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
      .replace(/\r\n/g, '\n');

  test('the admin copy is a prefix of the core copy, character for character', () => {
    const core = norm('./qr.ts');
    const admin = norm('../../../apps/admin/src/lib/qr.ts');

    assert.ok(
      core.startsWith(admin),
      'packages/core/src/qr.ts and apps/admin/src/lib/qr.ts have diverged. '
      + 'Port the change to both, keeping core as admin + qrToTerminal.',
    );
  });

  test('both copies encode the same otpauth URI to the same modules', () => {
    // The prefix check above compares source. This compares behaviour, so a
    // change that only reformats does not fail, and one that alters output
    // cannot pass by being copied identically into a broken pair.
    const uri = 'otpauth://totp/DBH%20Portal:a@b.test?secret=JBSWY3DPEHPK3PXP&issuer=DBH';
    const grid = encodeQr(uri);
    assert.equal(grid.length, grid[0]?.length, 'a QR grid must be square');
    assert.ok(grid.length >= 21 && grid.length <= 177);
    // Finder patterns: a 7x7 ring in three corners. If the encoder ever starts
    // emitting a blank or inverted grid, this is what notices.
    const finder = (ox: number, oy: number): boolean =>
      grid[oy]?.[ox] === true && grid[oy + 1]?.[ox + 1] === false
      && grid[oy + 2]?.[ox + 2] === true;
    assert.ok(finder(0, 0), 'top-left finder pattern missing');
    assert.ok(finder(grid.length - 7, 0), 'top-right finder pattern missing');
    assert.ok(finder(0, grid.length - 7), 'bottom-left finder pattern missing');
  });
});
