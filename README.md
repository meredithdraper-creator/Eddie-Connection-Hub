# 🦅 Eddie's Connection Hub

An interactive guide for Woodward Academy students and families (PreK–12). **Eddie the Eagle** chats with visitors, asks a grade and an interest, and points them to clubs, athletics, arts, service, and events — all driven by **one master Google Sheet** that syncs to the site every morning.

## How it works

```
Google Sheet (master list)  ──daily GitHub Action──▶  data/hub.json  ──▶  GitHub Pages site
   (Opportunities + Events tabs)    scripts/sync.mjs        │               (Eddie chat + browse + events)
                                                            └─ committed, so every change is in git history
```

- **No server, no API keys, no monthly cost.** The site is static; Eddie runs entirely in the browser.
- **Student privacy by design.** Nothing typed to Eddie is stored or sent anywhere. Student-leader names/emails are stripped *at sync time* by default, so they never reach the public JSON.
- **Safe sync.** If the sheet is unreachable, empty, or suddenly loses >50% of its rows, the sync fails loudly and the live site keeps its last good data.

## Setup (about 10 minutes)

1. **Create a GitHub repo** and push this folder to the `main` branch.
2. **Share the Google Sheet** as *"Anyone with the link can view"* (the sync reads the sheet's CSV export). Sheet ID is already set in `site.config.json`.
3. **Turn on Pages:** Repo → Settings → Pages → *Source: GitHub Actions*.
4. **Run it:** Actions tab → *Sync sheet & deploy Eddie* → *Run workflow*. After that it runs every morning (~5 AM Eastern) and on every push.

Optional repo variables (Settings → Secrets and variables → Actions → Variables): `SHEET_ID`, `OPPORTUNITIES_GID`, `EVENTS_GID`.

## The master sheet

**Opportunities tab** (the sample you shared works as-is): `Category, Name, Description, Core Value Alignment, School, Grade Level(s), Sponsor/Coach, Sponsor/Coach Email, Student Leader Name, Student Leader Email, Meeting Location, Meeting Schedule, Key Words/Tags, Cost/Fees, Tryout/Audition Required, Application Required`

- Grade levels accept `4-6`, `9`, `PK-5`, `K-2`, `PK3-PK4`.
- Put real weekday names in *Meeting Schedule* ("Tuesdays", "Mon & Wed") so Eddie can answer "what's on Thursdays?".
- *Key Words/Tags* is the best way to help Eddie find things — add words families would actually say ("robots", "choir", "volunteer").

**Events tab (optional)** — add a second tab, then put its `gid` (the number after `gid=` in the tab's URL) in `site.config.json` → `sheet.eventsGid`:
`Event Name, Description, Date (YYYY-MM-DD), Start Time, End Time, Location, School, Grade Level(s), Category, Contact, Contact Email, Link, Cost/Fees`

Every sync prints **data warnings** in the Actions log (unreadable grades, bad dates, invalid emails, School/Grade mismatches) so the sheet owner can clean things up.

## Branding

Logos live in `assets/`. Colors are CSS variables at the top of `css/styles.css`; the maroon (`#A30030`) was sampled from the supplied logos — **replace the tokens with the exact hex/Pantone values from the Woodward brand book.** Headings use a serif stack to echo the WA monogram; swap in the brand-book fonts via `--serif` / `--sans`.

## Configuration (`site.config.json`)

| Key | What it does |
|---|---|
| `divisions` | Grade ranges for LS / MS / US (default PreK–5, 6–8, 9–12). |
| `privacy.*` | Publish student-leader names/emails or sponsor emails. Defaults: students **off**, sponsors **on**. |
| `safety.counselorNote` | Message Eddie shows if a visitor mentions self-harm or abuse (Eddie never tries to counsel). |

## Local development

```bash
npm run sync:local   # build data/hub.json from data/sample.csv
npm run dev          # serve at http://localhost:3000
npm run sync         # pull the live sheet
```

## Project layout

```
index.html              page
css/styles.css          brand tokens + styles
js/eddie.js             Eddie's conversation engine (pure functions)
js/app.js               chat UI, filters, events
scripts/sync.mjs        sheet → hub.json (zero dependencies)
data/hub.json           generated; committed by the Action
.github/workflows/      daily sync + deploy
```

## Ideas for next steps

- Upgrade Eddie to an LLM through a small serverless proxy (Cloudflare Worker) that keeps the API key off the client — keep the rules engine as fallback.
- Add a "Save my list" (localStorage) and a printable one-page summary for families.
- Spanish-language mode for families.
