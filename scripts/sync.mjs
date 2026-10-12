#!/usr/bin/env node
// Pulls the master Google Sheet (as CSV) and writes data/hub.json for the site.
// Usage:
//   node scripts/sync.mjs                      -> fetch live sheet(s) from site.config.json
//   node scripts/sync.mjs --local              -> build from data/sample.csv (+ sample-events.csv)
//   SHEET_ID=... node scripts/sync.mjs         -> override sheet id
// Safe by design: if the fetch fails or the sheet looks broken, hub.json is NOT overwritten.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(await fs.readFile(path.join(root, 'site.config.json'), 'utf8'));
const OUT = path.join(root, 'data', 'hub.json');
const local = process.argv.includes('--local');
const sheetId = process.env.SHEET_ID || cfg.sheet.id;
const oppGid = process.env.OPPORTUNITIES_GID ?? cfg.sheet.opportunitiesGid ?? '0';
const evGid = process.env.EVENTS_GID ?? cfg.sheet.eventsGid ?? '';

// ---------- CSV ----------
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

functi
