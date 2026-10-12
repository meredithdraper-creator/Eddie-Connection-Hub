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

function toObjects(csv) {
  const [head, ...rest] = parseCSV(csv);
  const keys = head.map((h) => h.trim().toLowerCase());
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

// ---------- helpers ----------
const pick = (o, ...names) => {
  for (const n of names) if (o[n.toLowerCase()] !== undefined && o[n.toLowerCase()] !== '') return o[n.toLowerCase()];
  return '';
};
const yes = (v) => /^(y|yes|true|1|required)$/i.test((v || '').trim());
const list = (v) => (v || '').split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function gradeToken(t, low = false) {
  t = t.trim().toLowerCase().replace(/(st|nd|rd|th)$/, '');
  if (/^(pk|prek|pre-k)3$/.test(t)) return -2;
  if (/^(pk|prek|pre-k)$/.test(t)) return low ? -2 : -1;
  if (/^(pk|prek|pre-k)4$/.test(t)) return -1;
  if (t === 'k' || t === 'kg' || t === 'kindergarten') return 0;
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n >= 0 && n <= 12 ? n : null;
}
function parseGrades(v) {
  const parts = (v || '').split(/\s*[-–—to]+\s*(?=[a-z0-9])/i).filter(Boolean);
  const a = gradeToken(parts[0] ?? '', true);
  const b = parts.length > 1 ? gradeToken(parts[parts.length - 1]) : a;
  if (a === null || b === null) return null;
  return [Math.min(a, b), Math.max(a, b)];
}
const gradeLabel = (g) => (g === -2 ? 'PreK3' : g === -1 ? 'PreK4' : g === 0 ? 'K' : String(g));
const gradeText = (min, max) => (min === max ? `Grade ${gradeLabel(min)}` : `Grades ${gradeLabel(min)}–${gradeLabel(max)}`);

const SCHOOL_ALIAS = { 'LOWER SCHOOL': 'LS', 'MIDDLE SCHOOL': 'MS', 'UPPER SCHOOL': 'US', LS: 'LS', MS: 'MS', US: 'US' };
const parseSchools = (v) => [...new Set(list(v).map((s) => SCHOOL_ALIAS[s.toUpperCase()] || s.toUpperCase()))];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const parseDays = (v) => DAYS.filter((d) => new RegExp('\\b' + d.slice(0, 3) + '[a-z]*\\b', 'i').test(v || '')).map((d) => d[0].toUpperCase() + d.slice(1));
function parseCost(v) {
  const s = (v || '').trim();
  if (!s || /^(free|none|n\/a|\$?0(\.0+)?)$/i.test(s)) return { cost: 0, costText: 'Free' };
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return { cost: Number.isFinite(n) ? n : null, costText: s };
}
function cleanEmail(v, warn, ctx) {
  const raw = (v || '').trim().toLowerCase();
  if (!raw) return '';
  const fixed = raw.replace(/\.{2,}/g, '.');
  if (fixed !== raw) emailFixes.push(raw);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fixed)) { warn(`${ctx}: invalid email "${raw}"`); return ''; }
  return fixed;
}
const divisionsFor = (min, max) =>
  Object.entries(cfg.divisions).filter(([, d]) => min <= d.max && max >= d.min).map(([k]) => k);

// ---------- normalizers ----------
const emailFixes = [];
function normalizeOpportunities(rows, warnings) {
  const seen = new Map();
  const items = [];
  rows.forEach((r, i) => {
    const name = pick(r, 'Name');
    const line = `Row ${i + 2}`;
    if (!name) return;
    const warn = (m) => warnings.push(`${line} (${name}): ${m.replace(/^[^:]+: /, '')}`);
    const grades = parseGrades(pick(r, 'Grade Level(s)', 'Grade Levels', 'Grades'));
    if (!grades) warn('grade level missing or unreadable; defaulting to PreK–12');
    const [gradeMin, gradeMax] = grades || [-2, 12];
    const schools = parseSchools(pick(r, 'School', 'Division'));
    const implied = divisionsFor(gradeMin, gradeMax);
    if (schools.length && !schools.some((s) => implied.includes(s)))
      warn(`School "${schools.join(', ')}" doesn't match grades ${gradeText(gradeMin, gradeMax)} — Eddie matches on grade level`);
    let id = slug(name); const n = (seen.get(id) || 0) + 1; seen.set(id, n); if (n > 1) id += `-${n}`;
    const { cost, costText } = parseCost(pick(r, 'Cost/Fees', 'Cost', 'Fees'));
    const sched = pick(r, 'Meeting Schedule', 'Schedule');
    const item = {
      id,
      category: pick(r, 'Category') || 'Other',
      name,
      description: pick(r, 'Description'),
      values: list(pick(r, 'Core Value Alignment', 'Core Values')),
      schools: schools.length ? schools : implied,
      gradeMin, gradeMax, gradeText: gradeText(gradeMin, gradeMax),
      sponsor: pick(r, 'Sponsor/Coach', 'Sponsor', 'Coach'),
      location: pick(r, 'Meeting Location', 'Location'),
      schedule: sched,
      days: parseDays(sched),
      tags: list(pick(r, 'Key Words/Tags', 'Tags', 'Keywords')).map((t) => t.toLowerCase()),
      cost, costText,
      tryout: yes(pick(r, 'Tryout/Audition Required', 'Tryout')),
      application: yes(pick(r, 'Application Required', 'Application')),
    };
    const se = cleanEmail(pick(r, 'Sponsor/Coach Email', 'Sponsor Email'), (m) => warnings.push(`${line} (${name}): ${m.replace(/^[^:]+: /, '')}`), line);
    if (cfg.privacy.publishSponsorEmails && se) item.sponsorEmail = se;
    const sl = pick(r, 'Student Leader Name');
    const sle = cleanEmail(pick(r, 'Student Leader Email'), () => {}, line);
    if (cfg.privacy.publishStudentLeaderNames && sl) item.studentLeader = sl;
    if (cfg.privacy.publishStudentLeaderEmails && sle) item.studentLeaderEmail = sle;
    items.push(item);
  });
  return items;
}

function normalizeEvents(rows, warnings) {
  return rows.filter((r) => pick(r, 'Event Name', 'Name')).map((r, i) => {
    const name = pick(r, 'Event Name', 'Name');
    const grades = parseGrades(pick(r, 'Grade Level(s)', 'Grade Levels')) || [-2, 12];
    const date = pick(r, 'Date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) warnings.push(`Events row ${i + 2} (${name}): date "${date}" should be YYYY-MM-DD`);
    const implied = divisionsFor(grades[0], grades[1]);
    const schools = parseSchools(pick(r, 'School'));
    return {
      id: slug(name) + '-' + (date || i), name,
      description: pick(r, 'Description'), date,
      start: pick(r, 'Start Time'), end: pick(r, 'End Time'),
      location: pick(r, 'Location'), schools: schools.length ? schools : implied,
      gradeMin: grades[0], gradeMax: grades[1], gradeText: gradeText(grades[0], grades[1]),
      category: pick(r, 'Category'), contact: pick(r, 'Contact'),
      contactEmail: cfg.privacy.publishSponsorEmails ? cleanEmail(pick(r, 'Contact Email'), () => {}, '') : '',
      link: /^https?:\/\//.test(pick(r, 'Link')) ? pick(r, 'Link') : '',
      costText: parseCost(pick(r, 'Cost/Fees', 'Cost')).costText,
    };
  });
}

// ---------- fetch ----------
async function getCSV(gid, localFile) {
  if (local) return fs.readFile(path.join(root, 'data', localFile), 'utf8');
  const override = gid === oppGid ? cfg.sheet.opportunitiesCsvUrl : cfg.sheet.eventsCsvUrl;
  const url = override || `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { redirect: 'follow' });
  const body = await res.text();
  if (!res.ok || /^\s*<(!doctype|html)/i.test(body))
    throw new Error(`Could not read the sheet (HTTP ${res.status}). Make sure sharing is "Anyone with the link can view".`);
  return body;
}

// ---------- main ----------
try {
  const warnings = [];
  const items = normalizeOpportunities(toObjects(await getCSV(oppGid, 'sample.csv')), warnings);
  let events = [];
  if (local || evGid !== '') events = normalizeEvents(toObjects(await getCSV(evGid, 'sample-events.csv')), warnings);

  let prev = null;
  try { prev = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch {}
  if (emailFixes.length) warnings.unshift(`${emailFixes.length} email address(es) contained doubled dots (e.g. "${emailFixes[0]}") and were auto-corrected. Worth fixing at the source in the sheet.`);
  if (items.length === 0) throw new Error('Sheet returned 0 opportunities — refusing to overwrite existing data.');
  if (!local && prev?.items?.length > 10 && items.length < prev.items.length * 0.5)
    throw new Error(`Sheet shrank from ${prev.items.length} to ${items.length} rows — refusing to overwrite. Check the sheet, or delete data/hub.json to force.`);

  const same = prev && JSON.stringify(prev.items) === JSON.stringify(items) && JSON.stringify(prev.events) === JSON.stringify(events);
  if (same) { console.log(`No changes (${items.length} opportunities, ${events.length} events).`); }
  else {
    const hub = {
      meta: { updated: new Date().toISOString(), opportunityCount: items.length, eventCount: events.length, divisions: cfg.divisions, safetyNote: cfg.safety.counselorNote },
      items, events, warnings,
    };
    await fs.writeFile(OUT, JSON.stringify(hub, null, 2) + '\n');
    console.log(`Wrote data/hub.json: ${items.length} opportunities, ${events.length} events.`);
  }
  if (warnings.length) { console.log(`\n${warnings.length} data warning(s) for the sheet owner:`); warnings.forEach((w) => console.log('  - ' + w)); }
} catch (e) {
  console.error('SYNC FAILED:', e.message);
  process.exit(1);
}
