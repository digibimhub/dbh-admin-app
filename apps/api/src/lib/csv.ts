/**
 * Minimal RFC 4180 reader. A dependency for this would be a supply-chain
 * surface on a route that already accepts operator-supplied text.
 */

export interface CsvTable {
  header: string[];
  /** Row values plus the 1-based source line, for error reporting. */
  rows: Array<{ line: number; values: string[] }>;
}

export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^﻿/, '');
  const records: Array<{ line: number; values: string[] }> = [];

  let field = '';
  let values: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordStart = 1;
  let sawAny = false;

  const endField = () => { values.push(field); field = ''; };
  const endRecord = () => {
    endField();
    if (!(values.length === 1 && values[0]!.trim() === '')) {
      records.push({ line: recordStart, values });
    }
    values = [];
    recordStart = line;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    sawAny = true;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '') { inQuotes = true; continue; }
    if (ch === ',') { endField(); continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { line += 1; endRecord(); recordStart = line; continue; }
    field += ch;
  }

  if (sawAny && (field !== '' || values.length)) endRecord();

  const first = records.shift();
  return {
    header: (first?.values ?? []).map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_')),
    rows: records,
  };
}

/** Maps a parsed row onto its header, so column order does not matter. */
export function toObject(header: string[], values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  header.forEach((key, i) => {
    if (key) out[key] = (values[i] ?? '').trim();
  });
  return out;
}
