#!/usr/bin/env node
// Builds the "Upcoming events" list in data/hub.json from:
//   1. woodward.edu calendar pages (the main calendar, the athletics calendar, and any others in events.pages)
//   2. a careful scan of other woodward.edu pages that contain a calendar listing (events.crawl)
//   3. public iCal feeds listed in site.config.json (events.icalFeeds), e.g. the full Athletics schedule
//   4. an optional private iCal feed in the EVENTS_FEED_URL secret
// Each source is independent. If one is down, its last good events are kept. Never fails the build.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(await fs.readFile(path.join(root, 'site.config.json'), 'utf8'));
const ev = cfg.events || {};
const HUB = path.join(root, 'data', 'hub.json');
const CACHE = path.join(root, 'data', 'feed-cache.json');
const LOOKAHEAD = ev.lookaheadDays ?? 180;
const MAX_EVENTS = ev.maxEvents ?? 300;
const EXCLUDE = (ev.excludeKeywords ?? ['confidential', 'private', 'do not publish']).map((s) => s.toLowerCase());
const PAGE_URL = ev.calendarPage || 'https://www.woodward.edu/calendar';
const UA = { 'User-Agent': 'EddieConnectionHub/1.0 (school calendar sync)' };

let hub;
try { hub = JSON.parse(await fs.readFile(HUB, 'utf8')); }
catch { console.log('data/hub.json not found: run scripts/sync.mjs first.'); process.exit(0); }

// ---------- shared helpers ----------
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const today = iso(new Date());
const horizon = addDays(today, LOOKAHEAD);
const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthNum = (s) => MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().slice(0, 3))) + 1;
const pad = (n) => String(n).padStart(2, '0');
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '–').replace(/&#8212;|&mdash;/g, '—').replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

// ---------- classification & grades ----------
const SCHOOL = /\b(closed|no classes|break|holiday|dismiss(es|al)?|late start|semester|commencement|orientation|work ?day|professional development|last day|classes (begin|resume)|students return|day off|labor day|memorial day|mlk|president'?s day|good friday|yom kippur|eid)\b/i;
const ATHLETICS = /\b(vs\.?|varsity|jv|junior varsity|scrimmage|tryouts?|invitational|tournament|playoffs?|regionals?|football|basketball|soccer|volleyball|baseball|softball|lacrosse|tennis|golf|swim(ming)?|diving|track|cross country|wrestling|cheer(leading)?|frisbee|riflery|clay target|esports|athletic(s)?|intramurals?|senior night)\b/i;
const ARTS = /\b(concert|recital|showcase|musical|theat(er|re)|drama|play|orchestra|choir|chorus|band|jazz|dance|ballet|art show|art exhibit|exhibit(ion)?|gallery|film festival|screening|performance|talent show|improv|open mic|arts?)\b/i;
const ORGS = /\b(club|society|council|honor society|alliance|affinity|ambassadors?|student government|model un|debate|robotics|fair|service day|volunteer|fundraiser|pta|booster|parent association)\b/i;
const category = (t) => (SCHOOL.test(t) ? 'School Dates' : ARTS.test(t) ? 'Arts' : ATHLETICS.test(t) ? 'Athletics' : ORGS.test(t) ? 'Organizations' : 'Other');

function inferGrades(text) {   // Woodward divisions: Primary PreK-3, Lower 4-6, Middle 7-8, Upper 9-12
  const ranges = [];
  const nums = [...text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\s+grade\b/gi)].map((m) => +m[1]).filter((n) => n >= 1 && n <= 12);
  if (nums.length) ranges.push([Math.min(...nums), Math.max(...nums)]);
  if (/\b(pre-?k|primary school|kindergarten)\b/i.test(text)) ranges.push([-2, 3]);
  if (/\blower school\b/i.test(text)) ranges.push([4, 6]);
  if (/\bmiddle school\b/i.test(text) || /\bMS\b/.test(text)) ranges.push([7, 8]);
  if (/\bupper school\b|\bvarsity\b|\bjv\b|\bjunior varsity\b/i.test(text) || /\bUS\b/.test(text)) ranges.push([9, 12]);
  if (!ranges.length) return [-2, 12];
  return [Math.min(...ranges.map((r) => r[0])), Math.max(...ranges.map((r) => r[1]))];
}
const gl = (g) => (g === -2 ? 'PreK3' : g === -1 ? 'PreK4' : g === 0 ? 'K' : String(g));
const gradeText = (a, b) => (a === -2 && b === 12 ? 'All grades' : a === b ? `Grade ${gl(a)}` : `Grades ${gl(a)}–${gl(b)}`);
const divisionsFor = (min, max) => Object.entries(cfg.divisions).filter(([, d]) => min <= d.max && max >= d.min).map(([k]) => k);

function makeEvent(source, { name, description = '', date, dateEnd = '', start = '', end = '', location = '', cat, link }) {
  const hint = `${name} ${description}`;
  const [gradeMin, gradeMax] = inferGrades(hint);
  return {
    id: `${slug(name)}-${date}-${slug(start)}`, name, description, date, dateEnd: dateEnd && dateEnd > date ? dateEnd : '',
    start, end, location, schools: divisionsFor(gradeMin, gradeMax), gradeMin, gradeMax, gradeText: gradeText(gradeMin, gradeMax),
    category: cat || category(hint), contact: '', contactEmail: '', link: link || ev.pageUrl || PAGE_URL, costText: '', source,
  };
}
const withinWindow = (e) => (e.dateEnd || e.date) >= today && e.date <= horizon;

// ---------- SOURCE: woodward.edu calendar pages ----------
function pageToLines(html) {
  const t = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|ul|ol|h[1-6]|tr|td|th|a|span|time|section|article|strong|b)>/gi, (m) => (/strong|b>/i.test(m) ? ' ' : '\n'))
    .replace(/<[^>]+>/g, ' ');
  return decode(t).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function eventsFromPage(html, opts = {}) {
  const lines = pageToLines(html);
  const out = []; const seen = new Set();
  let year = new Date().getUTCFullYear();
  const WD = '(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day';
  // key-dates panel: "Monday, November 23 - Friday, November 27 – Thanksgiving Break – School Closed"
  const keyRe = new RegExp(`^${WD},\\s+([A-Za-z]+)\\s+(\\d{1,2})(?:\\s*[-–]\\s*(?:${WD},\\s+)?([A-Za-z]+)\\s+(\\d{1,2}))?\\s+[–—]\\s+(.+)$`);
  // upcoming-events list: title line followed by a "Tue Nov 10" line
  const listRe = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Z][a-z]{2})\s+(\d{1,2})$/;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^20\d\d$/.test(l)) { year = +l; continue; }
    const k = l.match(keyRe);
    if (k) {
      const sm = monthNum(k[1]), sd = +k[2]; if (!sm) continue;
      const em = k[3] ? monthNum(k[3]) : sm, ed = k[4] ? +k[4] : sd;
      const date = `${year}-${pad(sm)}-${pad(sd)}`;
      const dateEnd = `${em < sm ? year + 1 : year}-${pad(em)}-${pad(ed)}`;
      const name = k[5].trim();
      const key = `${name}|${date}`; if (seen.has(key)) continue; seen.add(key);
      out.push(makeEvent('woodward.edu', { name, date, dateEnd, cat: opts.cat || category(name), link: opts.link }));
      continue;
    }
    const d = l.match(listRe);
    if (d && i > 0) {
      const title = lines[i - 1];
      if (!title || title.length < 4 || title.length > 140 || listRe.test(title) || /^(load more|search|clear|update calendar|calendar options|selected|all)$/i.test(title)) continue;
      const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(d[1]), m = monthNum(d[2]), dayNum = +d[3];
      const y0 = new Date().getUTCFullYear(); let date = '';
      for (const y of [y0, y0 + 1]) if (new Date(Date.UTC(y, m - 1, dayNum, 12)).getUTCDay() === wd && `${y}-${pad(m)}-${pad(dayNum)}` >= addDays(today, -7)) { date = `${y}-${pad(m)}-${pad(dayNum)}`; break; }
      if (!date) continue;
      const key = `${title}|${date}`; if (seen.has(key)) continue; seen.add(key);
      out.push(makeEvent('woodward.edu', { name: title, date, cat: opts.cat || category(title), link: opts.link }));
    }
  }
  // The list shows each day of a break separately; drop those when the key-dates panel already has the range.
  const norm = (n) => n.toLowerCase().replace(/[–—-]/g, ' ').replace(/\s+/g, ' ').trim();
  const ranges = out.filter((e) => e.dateEnd);
  return out.filter((e) => e.dateEnd || !ranges.some((r) => norm(r.name) === norm(e.name) && e.date >= r.date && e.date <= r.dateEnd));
}// ---------- SOURCE: iCal feeds ----------
const unfold = (t) => t.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
const unesc = (s = '') => decode(s.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
function parseICS(text) {
  const out = []; let cur = null;
  for (const line of unfold(text).split('\n')) {
    if (line === 'BEGIN:VEVENT') { cur = { EXDATE: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    const prop = { value: line.slice(i + 1), params: Object.fromEntries(params.map((p) => p.split('='))) };
    if (name.toUpperCase() === 'EXDATE') cur.EXDATE.push(...prop.value.split(',').map((v) => ({ value: v, params: prop.params })));
    else cur[name.toUpperCase()] = prop;
  }
  return out;
}
const NY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const t12 = (h, m) => `${((+h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${+h < 12 ? 'AM' : 'PM'}`;
function parseDT(p) {
  if (!p) return null;
  const m = p.value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, Y, Mo, D, h, mi, s, z] = m;
  if (h === undefined) return { date: `${Y}-${Mo}-${D}`, time: '', allDay: true };
  if (z) {
    const parts = Object.fromEntries(NY.formatToParts(new Date(Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +(s || 0)))).map((x) => [x.type, x.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: t12(parts.hour, parts.minute) };
  }
  return { date: `${Y}-${Mo}-${D}`, time: t12(h, mi) };
}
const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const dow = (s) => new Date(s + 'T12:00:00Z').getUTCDay();
function expand(start, rrule, exdates) {
  if (!rrule) return [start.date];
  const r = Object.fromEntries(rrule.split(';').map((p) => p.split('=')));
  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(r.FREQ)) return [start.date];
  const interval = +(r.INTERVAL || 1), count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}` : '9999-12-31';
  const byday = r.BYDAY ? r.BYDAY.split(',').map((d) => DOW.indexOf(d.slice(-2))) : null;
  const ex = new Set(exdates); const out = []; let n = 0, cur = start.date, step = 0;
  while (cur <= until && cur <= horizon && n < count && step < 4000) {
    let hit = false;
    if (r.FREQ === 'DAILY') hit = step % interval === 0;
    else if (r.FREQ === 'WEEKLY') {
      const weeks = Math.floor((new Date(cur + 'T12:00:00Z') - new Date(start.date + 'T12:00:00Z')) / 604800000);
      hit = (byday ? byday.includes(dow(cur)) : dow(cur) === dow(start.date)) && weeks % interval === 0;
    } else hit = cur.slice(8) === start.date.slice(8) && ((+cur.slice(5, 7) - +start.date.slice(5, 7) + 12 * (+cur.slice(0, 4) - +start.date.slice(0, 4))) % interval === 0);
    if (hit) { n++; if (!ex.has(cur) && cur >= today) out.push(cur); }
    cur = addDays(cur, 1); step++;
  }
  return out;
}
function eventsFromICS(body, feed) {
  const out = [];
  for (const e of parseICS(body)) {
    const start = parseDT(e.DTSTART); if (!start) continue;
    const name = unesc(e.SUMMARY?.value); if (!name) continue;
    const cls = (e.CLASS?.value || '').toUpperCase();
    const description = unesc(e.DESCRIPTION?.value).slice(0, 300), location = unesc(e.LOCATION?.value);
    const hay = `${name} ${description} ${location}`.toLowerCase();
    if (cls === 'PRIVATE' || cls === 'CONFIDENTIAL' || EXCLUDE.some((k) => hay.includes(k))) continue;
    const endP = parseDT(e.DTEND);
    const ex = e.EXDATE.map((x) => (parseDT(x) || {}).date).filter(Boolean);
    let dateEnd = '';
    if (!e.RRULE && endP?.allDay && endP.date > addDays(start.date, 1)) dateEnd = addDays(endP.date, -1);   // all-day DTEND is exclusive
    for (const date of expand(start, e.RRULE?.value, ex)) {
      out.push(makeEvent(feed.source, { name, description, date, dateEnd: dateEnd && date === start.date ? dateEnd : '', start: start.time, end: endP && !endP.allDay && (endP.date === date || !e.RRULE) ? endP.time : '', location, cat: feed.category || undefined, link: feed.pageUrl }));
    }
  }
  return out;
}// ---------- run every source independently ----------
let cache = {};
try { cache = JSON.parse(await fs.readFile(CACHE, 'utf8')); } catch {}
const sources = [{ key: 'page:main', label: 'woodward.edu calendar page', kind: 'page', url: PAGE_URL }];
for (const pg of ev.pages || []) { const u = typeof pg === 'string' ? pg : pg.url; if (u) sources.push({ key: `page:${u}`, label: `page ${u.replace(/^https?:\/\/[^/]+/, '')}`, kind: 'page', url: u, cat: pg.category, link: u }); }
if (ev.crawl?.enabled) sources.push({ key: 'crawl', label: 'woodward.edu site scan', kind: 'crawl' });
for (const f of ev.icalFeeds || []) if (f.url && !/PASTE/i.test(f.url)) sources.push({ key: `ical:${f.name || f.url}`, label: f.name || 'calendar feed', kind: 'ical', url: f.url, category: f.category, pageUrl: f.pageUrl, source: 'woodward.edu' });
if ((process.env.EVENTS_FEED_URL || '').trim()) sources.push({ key: 'ical:secret', label: 'private calendar feed', kind: 'ical', url: process.env.EVENTS_FEED_URL.trim(), source: 'calendar-feed' });

// Scan other pages of the site for Finalsite calendar listings (polite: capped, a few at a time).
const get = (u) => fetch(u.replace(/^webcal:/i, 'https:'), { redirect: 'follow', headers: UA, signal: AbortSignal.timeout(20000) });
async function crawl() {
  const c = ev.crawl, base = new URL(c.sitemap || PAGE_URL);
  const known = new Set([PAGE_URL, ...(ev.pages || []).map((x) => (typeof x === 'string' ? x : x.url))]);
  const res = await get(base.href); if (!res.ok) throw new Error(`sitemap HTTP ${res.status}`);
  const html = await res.text();
  const inc = c.include || [];
  const urls = [...new Set([...html.matchAll(/href=["']([^"'#?]+)["']/gi)].map((m) => { try { return new URL(m[1], base).href.replace(/\/$/, ''); } catch { return ''; } }))]
    .filter((u) => u && new URL(u).host === base.host && !known.has(u) && !/\.(pdf|jpe?g|png|gif|svg|zip|docx?|xlsx?|pptx?|mp4|ics)$/i.test(u))
    .filter((u) => !inc.length || inc.some((p) => new URL(u).pathname.startsWith(p)))
    .slice(0, c.maxPages ?? 200);
  const found = []; let scanned = 0, withCalendar = 0, i = 0;
  const MARK = /Load More Events|fsCalendar|calendar-manager|Calendar RSS Feeds|cf_calendar/i;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (i < urls.length) {
      const u = urls[i++];
      try {
        const r = await get(u); if (!r.ok) continue;
        const h = await r.text(); scanned++;
        if (!MARK.test(h)) continue;
        const list = eventsFromPage(h, { link: u, cat: /\/athletics/.test(u) ? 'Athletics' : undefined });
        if (list.length) { withCalendar++; found.push(...list); }
      } catch { /* skip this page */ }
      await new Promise((r) => setTimeout(r, 150));
    }
  }));
  console.log(`  site scan: ${scanned} of ${urls.length} pages read, ${withCalendar} had calendar listings.`);
  return found;
}

const imported = []; let failures = 0;
for (const s of sources) {
  try {
    let list;
    if (s.kind === 'crawl') list = await crawl();
    else {
      const res = await get(s.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      if (s.kind === 'page') list = eventsFromPage(body, { cat: s.cat, link: s.link });
      else { if (!/BEGIN:VCALENDAR/.test(body)) throw new Error('response was not an iCal feed'); list = eventsFromICS(body, s); }
    }
    list = list.filter(withinWindow).filter((e) => !EXCLUDE.some((k) => `${e.name} ${e.description}`.toLowerCase().includes(k)));
    cache[s.key] = list;
    imported.push(...list);
    console.log(`${s.label}: ${list.length} upcoming events kept (next ${LOOKAHEAD} days).`);
  } catch (e) {
    failures++;
    const reuse = (cache[s.key] || []).filter(withinWindow);
    imported.push(...reuse);
    console.log(`::warning::Could not read ${s.label} (${e.message}). Kept ${reuse.length} previous events.`);
  }
}

const MANAGED = new Set(['woodward.edu', 'calendar-feed']);
const keep = (hub.events || []).filter((e) => !MANAGED.has(e.source));   // events typed into the Google Sheet
const nk = (x) => `${x.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${x.date}`;
const best = new Map();
for (const x of [...keep, ...imported]) { const k = nk(x); const cur = best.get(k); if (!cur || (!cur.start && x.start)) best.set(k, x); }
const events = [...best.values()]
  .sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || (a.start || '').localeCompare(b.start || ''))
  .slice(0, MAX_EVENTS);

await fs.writeFile(CACHE, JSON.stringify(cache) + '\n');
hub.events = events;
hub.meta = { ...hub.meta, eventCount: events.length, eventsSyncedAt: new Date().toISOString(), eventsFromFeed: true };
await fs.writeFile(HUB, JSON.stringify(hub, null, 2) + '\n');
const by = events.reduce((a, x) => ((a[x.category || 'Other'] = (a[x.category || 'Other'] || 0) + 1), a), {});
console.log(`Wrote ${events.length} events to data/hub.json`, by, failures ? `(${failures} source(s) failed)` : '');
