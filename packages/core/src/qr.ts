/**
 * A small QR encoder — byte mode, error-correction level M, versions 1–10.
 *
 * Written by hand rather than pulled in as a dependency: the admin bundle is
 * next + react + tailwind and nothing else, and the only thing this app ever
 * encodes is a ~100 character `otpauth://` URI. The manual secret shown beside
 * the code is the authoritative fallback, so a scanner that dislikes this
 * output is an inconvenience, not a lockout.
 *
 * The Galois-field arithmetic and Reed–Solomon codewords were checked against
 * the two published worked examples from the specification (the numeric
 * "01234567" version 1-M block and the "HELLO WORLD" version 1-Q block).
 */

type Block = { data: number[]; ec: number[] };

/** [total codewords, EC codewords per block, [blocks, data codewords per block][]] for level M. */
const VERSIONS: [total: number, ecPerBlock: number, groups: [count: number, dataPerBlock: number][]][] = [
  [26, 10, [[1, 16]]],
  [44, 16, [[1, 28]]],
  [70, 26, [[1, 44]]],
  [100, 18, [[2, 32]]],
  [134, 24, [[2, 43]]],
  [172, 16, [[4, 27]]],
  [196, 18, [[4, 31]]],
  [242, 22, [[2, 38], [2, 39]]],
  [292, 22, [[3, 36], [2, 37]]],
  [346, 26, [[4, 43], [1, 44]]],
];

const ALIGNMENT: number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

/* ------------------------------------------------------------------ GF(256) */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255] ?? 0;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0;
}

/** Product of (x − α^i) for i in [0, degree), highest-degree coefficient first. */
function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] ?? 0) ^ (poly[j] ?? 0);
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(poly[j] ?? 0, EXP[i] ?? 0);
    }
    poly = next;
  }
  return poly;
}

export function rsEncode(data: number[], ecLength: number): number[] {
  const gen = rsGenerator(ecLength);
  const out = new Array<number>(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ (out[0] ?? 0);
    out.shift();
    out.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLength; i += 1) {
        out[i] = (out[i] ?? 0) ^ gfMul(gen[i + 1] ?? 0, factor);
      }
    }
  }
  return out;
}

/* --------------------------------------------------------------- bit stream */

class Bits {
  readonly values: number[] = [];

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.values.push((value >>> i) & 1);
  }

  get length(): number { return this.values.length; }
}

/* ------------------------------------------------------------------ encoder */

function pickVersion(byteLength: number): number {
  for (let v = 1; v <= 10; v += 1) {
    const spec = VERSIONS[v - 1];
    if (!spec) continue;
    const dataCodewords = spec[2].reduce((sum, [count, per]) => sum + count * per, 0);
    const headerBits = 4 + (v <= 9 ? 8 : 16);
    if (dataCodewords * 8 >= headerBits + byteLength * 8) return v;
  }
  throw new Error('Payload is too long for a version 10 QR code');
}

function buildCodewords(bytes: number[], version: number): Block[] {
  const spec = VERSIONS[version - 1]!;
  const [, ecPerBlock, groups] = spec;
  const dataCodewords = groups.reduce((sum, [count, per]) => sum + count * per, 0);

  const bits = new Bits();
  bits.push(0b0100, 4);                              // byte mode
  bits.push(bytes.length, version <= 9 ? 8 : 16);    // character count
  for (const b of bytes) bits.push(b, 8);

  // Terminator, then pad to a byte boundary, then the alternating pad bytes.
  const capacity = dataCodewords * 8;
  bits.push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(0, 1);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits.values[i + j] ?? 0);
    codewords.push(byte);
  }
  const PAD = [0xec, 0x11];
  while (codewords.length < dataCodewords) codewords.push(PAD[codewords.length % 2]!);

  const blocks: Block[] = [];
  let offset = 0;
  for (const [count, per] of groups) {
    for (let i = 0; i < count; i += 1) {
      const data = codewords.slice(offset, offset + per);
      offset += per;
      blocks.push({ data, ec: rsEncode(data, ecPerBlock) });
    }
  }
  return blocks;
}

/** Interleave data then EC codewords, block by block, as the standard requires. */
function interleave(blocks: Block[]): number[] {
  const out: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]!);
  }
  const maxEc = Math.max(...blocks.map((b) => b.ec.length));
  for (let i = 0; i < maxEc; i += 1) {
    for (const b of blocks) if (i < b.ec.length) out.push(b.ec[i]!);
  }
  return out;
}

/* ------------------------------------------------------------------- matrix */

type Grid = { size: number; modules: (0 | 1 | null)[]; reserved: boolean[] };

function makeGrid(size: number): Grid {
  return {
    size,
    modules: new Array<0 | 1 | null>(size * size).fill(null),
    reserved: new Array<boolean>(size * size).fill(false),
  };
}

function set(g: Grid, x: number, y: number, value: 0 | 1, reserve = true): void {
  if (x < 0 || y < 0 || x >= g.size || y >= g.size) return;
  g.modules[y * g.size + x] = value;
  if (reserve) g.reserved[y * g.size + x] = true;
}

function get(g: Grid, x: number, y: number): 0 | 1 {
  return (g.modules[y * g.size + x] ?? 0) as 0 | 1;
}

function isReserved(g: Grid, x: number, y: number): boolean {
  return g.reserved[y * g.size + x] ?? false;
}

function placeFinder(g: Grid, cx: number, cy: number): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= g.size || y >= g.size) continue;
      const inRing = (dx >= 0 && dx <= 6 && (dy === 0 || dy === 6))
        || (dy >= 0 && dy <= 6 && (dx === 0 || dx === 6));
      const inCore = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      set(g, x, y, inRing || inCore ? 1 : 0);
    }
  }
}

function placeAlignment(g: Grid, version: number): void {
  const centres = ALIGNMENT[version - 1] ?? [];
  for (const cy of centres) {
    for (const cx of centres) {
      // Skip the three that would collide with the finder patterns.
      const nearFinder = (cx <= 8 && cy <= 8)
        || (cx <= 8 && cy >= g.size - 9)
        || (cx >= g.size - 9 && cy <= 8);
      if (nearFinder) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const ring = Math.max(Math.abs(dx), Math.abs(dy));
          set(g, cx + dx, cy + dy, ring === 1 ? 0 : 1);
        }
      }
    }
  }
}

function placeTiming(g: Grid): void {
  for (let i = 8; i < g.size - 8; i += 1) {
    const bit: 0 | 1 = i % 2 === 0 ? 1 : 0;
    set(g, i, 6, bit);
    set(g, 6, i, bit);
  }
}

function reserveFormat(g: Grid): void {
  for (let i = 0; i < 9; i += 1) {
    if (i === 6) continue; // (6,8) and (8,6) belong to the timing patterns
    set(g, i, 8, 0);
    set(g, 8, i, 0);
  }
  for (let i = 0; i < 8; i += 1) {
    set(g, g.size - 1 - i, 8, 0);
    set(g, 8, g.size - 1 - i, 0);
  }
  set(g, 8, g.size - 8, 1); // the always-dark module
}

function bch(value: number, generator: number, generatorBits: number): number {
  let out = value;
  const shift = generatorBits - 1;
  for (let i = shift - 1; i >= 0; i -= 1) {
    if (out & (1 << (i + shift))) out ^= generator << i;
  }
  return out;
}

function placeFormat(g: Grid, mask: number): void {
  // EC level M is 0b00; the 15-bit sequence is BCH(15,5) XORed with the mask
  // pattern from the standard.
  const data = (0b00 << 3) | mask;
  const bits = (((data << 10) | bch(data << 10, 0b10100110111, 11)) ^ 0b101010000010010);

  for (let i = 0; i < 15; i += 1) {
    const bit: 0 | 1 = ((bits >> i) & 1) as 0 | 1;
    if (i < 6) set(g, 8, i, bit);
    else if (i === 6) set(g, 8, 7, bit);
    else if (i === 7) set(g, 8, 8, bit);
    else if (i === 8) set(g, 7, 8, bit);
    else set(g, 14 - i, 8, bit);

    if (i < 8) set(g, g.size - 1 - i, 8, bit);
    else set(g, 8, g.size - 15 + i, bit);
  }
  set(g, 8, g.size - 8, 1);
}

function placeVersion(g: Grid, version: number): void {
  if (version < 7) return;
  const bits = (version << 12) | bch(version << 12, 0b1111100100101, 13);
  for (let i = 0; i < 18; i += 1) {
    const bit: 0 | 1 = ((bits >> i) & 1) as 0 | 1;
    const a = Math.floor(i / 3);
    const b = i % 3;
    set(g, a, g.size - 11 + b, bit);
    set(g, g.size - 11 + b, a, bit);
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function placeData(g: Grid, codewords: number[], mask: number): void {
  const maskFn = MASKS[mask]!;
  let bitIndex = 0;
  let upward = true;

  for (let right = g.size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern: shift the pair left past it so
    // the following pairs stay aligned instead of overlapping.
    if (right === 6) right = 5;
    for (let step = 0; step < g.size; step += 1) {
      const y = upward ? g.size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (isReserved(g, x, y)) continue;
        const byte = codewords[bitIndex >> 3] ?? 0;
        let bit = (byte >> (7 - (bitIndex & 7))) & 1;
        bitIndex += 1;
        if (maskFn(x, y)) bit ^= 1;
        set(g, x, y, bit as 0 | 1, false);
      }
    }
    upward = !upward;
  }
}

function penalty(g: Grid): number {
  const n = g.size;
  let score = 0;

  // Rule 1 — runs of five or more identical modules.
  for (let i = 0; i < n; i += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      let prev = horizontal ? get(g, 0, i) : get(g, i, 0);
      for (let j = 1; j < n; j += 1) {
        const cur = horizontal ? get(g, j, i) : get(g, i, j);
        if (cur === prev) {
          run += 1;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
          prev = cur;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Rule 2 — 2×2 blocks of one colour.
  for (let y = 0; y < n - 1; y += 1) {
    for (let x = 0; x < n - 1; x += 1) {
      const v = get(g, x, y);
      if (v === get(g, x + 1, y) && v === get(g, x, y + 1) && v === get(g, x + 1, y + 1)) score += 3;
    }
  }

  // Rule 3 — finder-like 1:1:3:1:1 patterns.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x <= n - 11; x += 1) {
      let matchA = true;
      let matchB = true;
      let matchAv = true;
      let matchBv = true;
      for (let k = 0; k < 11; k += 1) {
        if (get(g, x + k, y) !== A[k]) matchA = false;
        if (get(g, x + k, y) !== B[k]) matchB = false;
        if (get(g, y, x + k) !== A[k]) matchAv = false;
        if (get(g, y, x + k) !== B[k]) matchBv = false;
      }
      if (matchA) score += 40;
      if (matchB) score += 40;
      if (matchAv) score += 40;
      if (matchBv) score += 40;
    }
  }

  // Rule 4 — deviation from an even split of dark and light.
  let dark = 0;
  for (let i = 0; i < n * n; i += 1) if (g.modules[i] === 1) dark += 1;
  const ratio = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

/** Returns the finished module matrix — `true` is a dark module. */
export function encodeQr(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  const version = pickVersion(bytes.length);
  const codewords = interleave(buildCodewords(bytes, version));
  const size = 17 + version * 4;

  let best: Grid | null = null;
  let bestScore = Infinity;

  for (let mask = 0; mask < 8; mask += 1) {
    const g = makeGrid(size);
    placeFinder(g, 0, 0);
    placeFinder(g, size - 7, 0);
    placeFinder(g, 0, size - 7);
    placeAlignment(g, version);
    placeTiming(g);
    reserveFormat(g);
    placeVersion(g, version);
    placeData(g, codewords, mask);
    placeFormat(g, mask);

    const score = penalty(g);
    if (score < bestScore) { bestScore = score; best = g; }
  }

  const grid = best!;
  const out: boolean[][] = [];
  for (let y = 0; y < size; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x += 1) row.push(get(grid, x, y) === 1);
    out.push(row);
  }
  return out;
}

/* -------------------------------------------------------------- terminal */

const ESC = '\x1b';

/**
 * Renders a QR as text for a terminal.
 *
 * One character per module horizontally, two modules per character vertically
 * via the upper-half block — a terminal cell is about twice as tall as it is
 * wide, so this is the only cheap way to get square modules. Two spaces per
 * module would be square too, but doubles the width, and a version-8 code plus
 * its quiet zone is already 57 columns.
 *
 * Colours are set explicitly rather than inherited: scanners expect dark
 * modules on a light ground, and a terminal with a dark theme would otherwise
 * hand them the inverse. `colour: false` falls back to block characters, which
 * scan on a light-background terminal only.
 */
export function qrToTerminal(text: string, opts: { colour?: boolean; quiet?: number } = {}): string {
  const colour = opts.colour ?? true;
  const quiet = opts.quiet ?? 4;

  const grid = encodeQr(text);
  const size = grid.length + quiet * 2;
  const dark = (x: number, y: number): boolean => grid[y - quiet]?.[x - quiet] ?? false;

  const lines: string[] = [];
  for (let y = 0; y < size; y += 2) {
    let line = '';
    for (let x = 0; x < size; x += 1) {
      const top = dark(x, y);
      // An odd number of rows leaves the last cell's bottom half in the quiet
      // zone, which is light — the same as any module outside the grid.
      const bottom = y + 1 < size ? dark(x, y + 1) : false;
      if (colour) {
        line += `${ESC}[3${top ? 0 : 7}m${ESC}[4${bottom ? 0 : 7}m▀`;
      } else {
        line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
      }
    }
    lines.push(colour ? `${line}${ESC}[0m` : line);
  }
  return lines.join('\n');
}
