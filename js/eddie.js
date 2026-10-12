// Eddie the Eagle — the conversation engine.
// Rule-based and fully client-side: no student text ever leaves the browser,
// no API keys, no cost. Pure functions so it can be unit-tested in Node.

const GROUPS = [
  ['music', 'band', 'jazz', 'chorus', 'choir', 'orchestra', 'string', 'strings', 'sing', 'singing', 'instrument', 'concert'],
  ['art', 'arts', 'draw', 'drawing', 'paint', 'painting', 'ceramics', 'pottery', 'studio', 'portfolio', 'craft', 'origami', 'creative', 'creativity'],
  ['theater', 'theatre', 'acting', 'drama', 'stage', 'stagecraft', 'performance', 'perform'],
  ['photo', 'photography', 'camera', 'film', 'video', 'movie'],
  ['run', 'running', 'cross', 'country', 'track', 'field'],
  ['swim', 'swimming', 'dive', 'diving', 'pool'],
  ['tech', 'technology', 'coding', 'code', 'computer', 'programming', 'robotics', 'robot', 'robots', 'esports', 'gaming', 'video-games', 'stem', 'engineering', 'lego'],
  ['science', 'stem', 'research', 'olympiad', 'lab', 'math', 'experiment'],
  ['service', 'volunteer', 'volunteering', 'community', 'helping', 'charity', 'environment', 'environmental', 'recycling', 'tutoring', 'shelter', 'animal', 'animals'],
  ['leadership', 'leader', 'leaders', 'council', 'ambassador', 'mentor', 'mentors', 'mentoring'],
  ['writing', 'write', 'book', 'books', 'reading', 'literary', 'magazine', 'poetry', 'stories', 'story', 'author'],
  ['debate', 'speaking', 'model', 'politics', 'public'],
  ['cooking', 'cook', 'baking', 'bake', 'food', 'chef'],
  ['outdoor', 'outdoors', 'gardening', 'garden', 'nature', 'adventure', 'hiking', 'plants'],
  ['chess', 'board', 'games', 'game', 'strategy', 'puzzle'],
  ['fashion', 'design', 'sewing'],
  ['dance', 'dancing'],
];
const CATEGORY_CUES = [
  [/\b(sport|sports|athletic|athletics|team sport|compete|competition|varsity)\b/, 'Athletics'],
  [/\b(arts?|creative)\b/, 'Arts'],
  [/\bclubs?\b/, 'Clubs & Interests'],
  [/\bleadership\b/, 'Leadership'],
  [/\b(service|volunteer\w*)\b/, 'Service'],
  [/\b(academic|enrichment)\b/, 'Academic & Enrichment'],
];
const STOP = new Set('a an the and or of for to in on at is are am be can could would should do does i me my we our us you your it its this that these those with about what which who whom whats any some something anything looking look find want wants need needs like likes love loves enjoy enjoys interested interest into got have has just really very kind sort please show tell give help child kid kids son daughter student students grader grade school there here eddie hi hello hey also more other else another new one ones only'.split(' '));
const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

export const gradeLabel = (g) => (g === -2 ? 'PreK3' : g === -1 ? 'PreK4' : g === 0 ? 'K' : String(g));
export const gradeRangeLabel = (a, b) => (a === b ? `Grade ${gradeLabel(a)}` : `Grades ${gradeLabel(a)}–${gradeLabel(b)}`);

const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9$&' +-]/g, ' ');
const tokens = (s) => norm(s).split(/\s+/).filter(Boolean);

function stem(w) {
  return w.replace(/(ing|ers|er|es|s)$/, (m) => (w.length - m.length >= 3 ? '' : m));
}

export function parseGrade(text) {
  const t = norm(text);
  const ord = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
  let m;
  if (/\bpre-?\s?k(indergarten)?\s?3\b|\bpk\s?3\b/.test(t)) return [-2, -2];
  if (/\bpre-?\s?k(indergarten)?\s?4\b|\bpk\s?4\b/.test(t)) return [-1, -1];
  if (/\bpre-?\s?k\b|\bpre-?school\b|\bpk\b/.test(t)) return [-2, -1];
  if (/\bkindergarten|\bkinder\b/.test(t) || /\bin k\b/.test(t)) return [0, 0];
  if ((m = t.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:grade|grader|graders)\b/)) || (m = t.match(/\bgrade\s*(\d{1,2})\b/)) || (m = t.match(/\b(?:in|entering|going into|rising)\s+(\d{1,2})(?:st|nd|rd|th)?\b/))) {
    const g = parseInt(m[1], 10); if (g >= 1 && g <= 12) return [g, g];
  }
  for (const [w, g] of Object.entries(ord)) if (new RegExp(`\\b${w}\\s*(grade|grader)`).test(t)) return [g, g];
  if (/\bfreshman\b/.test(t)) return [9, 9];
  if (/\bsophomore\b/.test(t)) return [10, 10];
  if (/\bjunior\b/.test(t) && !/\bjunior (varsity|high)\b/.test(t)) return [11, 11];
  if (/\bsenior\b/.test(t) && !/\bsenior center\b/.test(t)) return [12, 12];
  if (/\blower school\b|\belementary\b/.test(t)) return 'LS';
  if (/\bmiddle school\b|\bmiddle schooler\b/.test(t)) return 'MS';
  if (/\bupper school\b|\bhigh school\b|\bhigh schooler\b/.test(t)) return 'US';
  return null;
}

export function createEddie(hub) {
  const items = hub.items;
  const events = hub.events || [];
  const divisions = hub.meta.divisions;

  // Words that appear in >40% of opportunity text carry no signal ("students", "teamwork"...).
  const df = new Map();
  const itemText = (it) => `${it.name} ${it.category} ${it.tags.join(' ')} ${it.description}`;
  items.forEach((it) => new Set(tokens(itemText(it)).map(stem)).forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  const common = (w) => (df.get(w) || 0) / Math.max(items.length, 1) > 0.4;

  const expand = (w) => {
    const out = new Set([w, stem(w)]);
    GROUPS.forEach((g) => { if (g.includes(w) || g.map(stem).includes(stem(w))) g.forEach((x) => out.add(stem(x))); });
    return out;
  };

  function matchesGrade(it, grade) {
    if (!grade) return true;
    if (typeof grade === 'string') { const d = divisions[grade]; return it.gradeMin <= d.max && it.gradeMax >= d.min; }
    return it.gradeMin <= grade[1] && it.gradeMax >= grade[0];
  }
  function eventMatchesGrade(ev, grade) { return matchesGrade(ev, grade); }

  function score(it, interest, category) {
    let s = 0;
    if (category && it.category === category) s += 6;
    const name = tokens(it.name).map(stem), tags = it.tags.flatMap(tokens).map(stem), cat = tokens(it.category).map(stem);
    const desc = new Set(tokens(it.description).map(stem));
    for (const w of interest) {
      const ex = expand(w);
      let hit = 0;
      for (const e of ex) {
        if (name.includes(e)) hit = Math.max(hit, 5);
        else if (tags.includes(e)) hit = Math.max(hit, 3);
        else if (cat.includes(e)) hit = Math.max(hit, 2);
        else if (!common(e) && desc.has(e)) hit = Math.max(hit, 1);
      }
      s += hit;
    }
    return s;
  }

  // Build up a "profile" from what the person has said so far.
  function understand(text, state) {
    const t = norm(text);
    const next = { ...state };
    const gradeWords = /\b(\d{1,2})(st|nd|rd|th)?\b|\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|freshman|sophomore|junior|senior|pre|prek|kindergarten|middle|upper|lower|high|elementary|monday|tuesday|wednesday|thursday|friday|tryout|tryouts|audition|auditions|application|applications|cost|fee|fees|free|under|below|less|than|max)\b/;
    const interest = tokens(text).filter((w) => !STOP.has(w) && w.length > 2 && !gradeWords.test(w) && !/^\$?\d/.test(w));
    // A new topic starts a fresh search: keep the grade, drop old filters.
    if (interest.length) { for (const k of ['free', 'noTryout', 'noApp', 'days', 'maxCost', 'category']) delete next[k]; }
    const g = parseGrade(text);
    if (g) next.grade = g;
    if (/\b(free|no cost|no fee|no fees|budget|cheap)\b/.test(t)) next.free = true;
    if (/\bno (tryouts?|auditions?)\b|\bwithout (a )?(tryouts?|auditions?)\b|\banyone can (join|play)\b|\bno experience\b/.test(t)) next.noTryout = true;
    if (/\bno applications?\b|\bwithout (an )?applications?\b/.test(t)) next.noApp = true;
    const days = DAY_NAMES.filter((d) => new RegExp(`\\b(${d}|${d.slice(0, 3)})s?\\b`).test(t));
    if (days.length) next.days = days.map((d) => d[0].toUpperCase() + d.slice(1));
    const m = t.match(/(?:under|below|less than|max(?:imum)?|up to)\s*\$?(\d{2,3})/);
    if (m) next.maxCost = parseInt(m[1], 10);
    for (const [re, c] of CATEGORY_CUES) if (re.test(t)) { next.category = c; break; }
    return { next, interest };
  }

  function filterItems(state, interest) {
    let list = items.filter((it) => matchesGrade(it, state.grade));
    if (state.free) list = list.filter((it) => it.cost === 0);
    if (state.maxCost != null) list = list.filter((it) => it.cost !== null && it.cost <= state.maxCost);
    if (state.noTryout) list = list.filter((it) => !it.tryout);
    if (state.noApp) list = list.filter((it) => !it.application);
    if (state.days?.length) list = list.filter((it) => it.days.some((d) => state.days.includes(d)));
    const scored = list.map((it) => ({ it, s: score(it, interest, state.category) }));
    const hasQuery = interest.length > 0 || state.category;
    const kept = hasQuery ? scored.filter((x) => x.s > 0) : scored;
    return kept.sort((a, b) => b.s - a.s || a.it.name.localeCompare(b.it.name)).map((x) => x.it);
  }

  const who = (state) => (!state.grade ? '' : typeof state.grade === 'string' ? ` for ${divisions[state.grade].label}` : ` for ${gradeRangeLabel(...state.grade)}`);
  const describeFilters = (s) => [s.free && 'free', s.noTryout && 'no tryout', s.noApp && 'no application', s.days?.length && s.days.join('/'), s.maxCost != null && `≤ $${s.maxCost}`].filter(Boolean).join(', ');

  const GRADE_CHIPS = ['PreK–2', 'Grades 3–5', 'Grades 6–8', 'Grades 9–12'];
  const chipsDefault = ['Sports', 'Arts & music', 'Service', 'Clubs', "What's coming up?"];

  const pageSize = 4;

  // Re-run the previous search after a filter is relaxed.
  function rerun(out, _text, lead) {
    const interest = out.state.interest || [];
    const results = filterItems(out.state, interest);
    out.state.last = results.map((r) => r.id); out.state.offset = 0;
    out.text = results.length ? lead : "Still nothing there — want to try a different interest?";
    out.items = results.slice(0, pageSize);
    out.chips = results.length > pageSize ? ['Show more', 'Start over'] : ['Start over'];
    return out;
  }

  function respond(text, state = {}) {
    const t = norm(text).trim();
    const out = { state: { ...state }, text: '', items: [], events: [], chips: [] };

    // --- care first ---
    if (/\b(suicid\w*|kill myself|self[- ]?harm|hurt myself|want to die|being abused|abuse[ds]? me)\b/.test(t)) {
      out.text = `I'm really glad you told someone. I'm just a guide to activities, so I'm not the right helper for this — but there are people who are. ${hub.meta.safetyNote}`;
      out.chips = ['Back to clubs & activities'];
      return out;
    }

    // --- grade-chip shortcuts ---
    const chipKey = text.trim().toLowerCase().replace(/[\u2013\u2014]/g, '-');
    const chipGrade = { 'prek-2': [-2, 2], 'grades 3-5': [3, 5], 'grades 6-8': [6, 8], 'grades 9-12': [9, 12] }[chipKey];
    if (chipGrade) {
      out.state.grade = chipGrade;
      if (!items.some((it) => matchesGrade(it, chipGrade))) {
        const lo = Math.min(...items.map((i) => i.gradeMin));
        out.text = `Got it — ${text.trim()}! I don't have activities listed for that grade yet — the current list starts at Grade ${gradeLabel(lo)}. Check back soon, or try another grade band.`;
        out.chips = ['Grades 3–5', 'Grades 6–8', 'Grades 9–12']; return out;
      }
      out.text = `Got it — ${text.trim()}! What are you into? Pick one or just tell me.`;
      out.chips = chipsDefault.slice(0, 4); return out;
    }

    if (/^(hi|hello|hey|yo|good (morning|afternoon|evening)|howdy|what'?s up)\b.{0,12}$/.test(t) && !parseGrade(text)) {
      out.text = "Hey there, War Eagle! 🦅 I help Woodward students and families find clubs, athletics, activities, and events. Tell me a grade and something you love — or tap a button!";
      out.chips = state.grade ? chipsDefault : GRADE_CHIPS;
      return out;
    }
    if (/\b(thanks|thank you|thx)\b/.test(t)) { out.text = 'Anytime! Go War Eagles! 🦅 Want me to look for anything else?'; out.chips = chipsDefault; return out; }
    if (/\b(start over|reset|clear|new search)\b/.test(t)) { out.state = {}; out.text = "Fresh start! What grade are you (or your child) in, and what sounds fun?"; out.chips = GRADE_CHIPS; return out; }
    if (/\b(who are you|what are you|are you (a )?(real|human|robot|bot|ai))\b/.test(t)) {
      out.text = "I'm Eddie, Woodward's mascot and a guide bot — not a person! I look up the school's activity list and point you to the right teacher or coach. Nothing you type here is saved or sent anywhere.";
      out.chips = chipsDefault; return out;
    }
    if (/\b(help|what can you do)\b/.test(t) && t.length < 25) {
      out.text = 'Try things like “my 3rd grader likes robots”, “free sports for middle school”, “nothing with tryouts”, or “what’s happening this month?”. I can also tell you how to join something.';
      out.chips = chipsDefault; return out;
    }

    // --- chip actions that relax or reset filters ---
    if (t === 'include paid') { out.state.free = false; out.state.maxCost = undefined; return rerun(out, text, 'Okay, including paid options too:'); }
    if (t === 'allow tryouts') { out.state.noTryout = false; return rerun(out, text, 'Okay, including ones with tryouts:'); }
    if (t === 'any day') { out.state.days = []; return rerun(out, text, 'Any day works:'); }
    if (t === 'set grade') { out.text = 'What grade is the student in?'; out.chips = GRADE_CHIPS; return out; }
    if (t === 'back to clubs & activities') { out.text = 'Sure thing. What can I help you find?'; out.chips = chipsDefault; return out; }

    // --- paging ---
    if (/^(show )?(me )?(more|next)\b/.test(t) && state.last) {
      const offset = (state.offset || 0) + pageSize;
      const ids = state.last.slice(offset, offset + pageSize);
      if (!ids.length) { out.text = "That's everything I've got for that search! Want to try something different?"; out.chips = chipsDefault; return out; }
      out.state.offset = offset;
      out.items = ids.map((id) => items.find((i) => i.id === id));
      out.text = 'Here are a few more:';
      out.chips = state.last.length > offset + pageSize ? ['Show more', 'Start over'] : ['Start over'];
      return out;
    }    // --- events ---
    if (/\b(events?|happening|calendar|coming up|upcoming|this (week|month)|fair|concert|game day)\b/.test(t) && !/\bclub\b/.test(t)) {
      const { next } = understand(text, state);
      out.state = next;
      const today = new Date().toISOString().slice(0, 10);
      let list = events.filter((e) => !e.date || e.date >= today).filter((e) => eventMatchesGrade(e, next.grade)).sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
      if (!list.length) { out.text = `I don't see upcoming events${who(next)} right now. Check back soon — I update every morning!`; out.chips = chipsDefault; return out; }
      out.text = `Here's what's coming up${who(next)}:`;
      out.events = list.slice(0, 5);
      out.chips = next.grade ? ['Sports', 'Arts & music', 'Clubs'] : GRADE_CHIPS;
      return out;
    }

    // --- how to join ---
    if (/\b(how (do|can) (i|we)|sign ?up|join|contact|who (do|should) (i|we)|email|reach)\b/.test(t) && state.last?.length) {
      const target = items.find((i) => t.includes(i.name.toLowerCase())) || items.find((i) => i.id === state.last[0]);
      out.items = [target];
      const steps = [target.tryout && 'there’s a tryout/audition', target.application && 'there’s an application'].filter(Boolean);
      out.text = `For ${target.name}, ${steps.length ? steps.join(' and ') : 'just show up — no tryout or application needed'}. ${target.sponsorEmail ? `Email ${target.sponsor} to get started:` : `Ask ${target.sponsor || 'the sponsor'} for details:`}`;
      out.chips = ['Show more', 'Start over'];
      return out;
    }

    // --- search ---
    const parsed = understand(text, state);
    const next = parsed.next;
    // A refinement like "only free" keeps the earlier interest; a new topic replaces it.
    const interest = parsed.interest.length ? parsed.interest : (state.interest || []);
    out.state = next;
    const hasQuery = interest.length > 0 || next.category || next.free || next.noTryout || next.noApp || next.days?.length || next.maxCost != null;

    if (!hasQuery && !parseGrade(text)) {
      out.text = next.grade ? "Tell me a little about what you enjoy — sports, music, building things, helping others? Or pick one:" : "Happy to help! First, what grade is the student in?";
      out.chips = next.grade ? chipsDefault : GRADE_CHIPS;
      return out;
    }
    if (!hasQuery) { // just gave a grade
      out.text = `Awesome — ${typeof next.grade === 'string' ? divisions[next.grade].label : gradeRangeLabel(...next.grade)}! What are you into?`;
      out.chips = chipsDefault; return out;
    }

    const results = filterItems(next, interest);
    out.state.last = results.map((r) => r.id); out.state.offset = 0; out.state.interest = interest;
    const filt = describeFilters(next);
    if (!results.length && next.grade && !items.some((it) => matchesGrade(it, next.grade))) {
      const lo = Math.min(...items.map((i) => i.gradeMin));
      out.text = `I don't have any activities listed${who(next)} yet — the current list starts at Grade ${gradeLabel(lo)}. Check back soon (I update every morning), or ask the school office!`;
      out.chips = ['Grades 3–5', 'Grades 6–8', 'Grades 9–12'];
      return out;
    }
    if (!results.length) {
      out.text = `Hmm, I couldn't find a match${who(next)}${filt ? ` (${filt})` : ''}. Let me widen it — want to loosen a filter?`;
      out.chips = [next.free && 'Include paid', next.noTryout && 'Allow tryouts', next.days?.length && 'Any day', 'Start over'].filter(Boolean);
      return out;
    }
    const head = results.length === 1 ? 'I found 1 great fit' : `I found ${results.length} that could be a good fit`;
    out.text = `${head}${who(next)}${filt ? ` (${filt})` : ''}:`;
    out.items = results.slice(0, pageSize);
    out.chips = [results.length > pageSize && 'Show more', !next.free && 'Only free', !next.noTryout && 'No tryout', !next.grade && 'Set grade', 'Start over'].filter(Boolean).slice(0, 4);
    return out;
  }

  // Chip clicks that mean "relax a filter" or "set grade"
  function chipToText(chip) {
    return chip;
  }

  // Synonym-aware search used by the Browse box ("reading" finds Book Club, Literary Magazine, ...)
  function rank(query) {
    const { interest } = understand(query, {});
    return interest.length ? filterItems({}, interest) : [];
  }

  return { respond, chipToText, filterItems, parseGrade, rank };
}
