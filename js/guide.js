// Eddie's guided discovery.
// Wraps the base engine (eddie.js). When a search returns lots of matches, or a visitor says
// "I'm not sure", Eddie asks 1–3 smart follow-up questions (chosen from the data itself so each
// question actually narrows things down), then recommends his top picks with reasons.
// Still 100% client-side: nothing a student types leaves the browser.

const NOT_SURE = 'Not sure — help me choose';
const SHOW_ALL = 'Just show me everything';
const NO_PREF = 'No preference';
const REACT = ['Love it!', 'Great choice!', 'Ooh, nice pick!', 'Awesome!', 'Good to know!', 'Got it!'];
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const lc = (s) => (s || '').toLowerCase();
const norm = (s) => lc(s).replace(/[^a-z0-9$ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const cap = (s) => (s.toUpperCase() === 'STEM' ? 'STEM' : s.replace(/\b\w/g, (c) => c.toUpperCase()));

const TYPES = [
  ['🎨 Making & performing', 'making and performing', (i) => i.category === 'Arts'],
  ['🏅 Competing & moving', 'competing and staying active', (i) => i.category === 'Athletics'],
  ['🤝 Helping & leading', 'helping and leading', (i) => i.category === 'Service' || i.category === 'Leadership'],
  ['🔬 Exploring & learning', 'exploring and learning', (i) => i.category === 'Academic & Enrichment' || i.category === 'Clubs & Interests'],
];
const H = (p) => (p <= 0 || p >= 1 ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p));
const REFINE = /^(only free|no tryout|include paid|allow tryouts|any day|set grade|show more|show more events)$/;

export function createGuide(hub, eddie) {
  const items = hub.items;
  const byId = new Map(items.map((i) => [i.id, i]));
  const GENERIC_TAGS = new Set(['service', 'teamwork', 'leadership', 'creativity', 'technology']);

  // ---- tests are rebuilt from simple data so flow state stays plain/serializable ----
  function test(kind, value) {
    if (kind === 'type') return TYPES[value][2];
    if (kind === 'exp') return value === 'new' ? (i) => !i.tryout : (i) => i.tryout;
    if (kind === 'day') return (i) => i.days.includes(value);
    if (kind === 'cost') return (i) => i.cost !== null && i.cost <= 25;
    return (i) => i.tags.includes(value); // topic
  }

  function buildQuestions(cands, g) {
    const qs = [];
    qs.push({ id: 'type', prompt: 'What sounds most like you?', bonus: 0.35, opts: TYPES.map((t, v) => ({ label: t[0], kind: 'type', value: v, reason: `A great fit for ${t[1]}` })) });
    qs.push({ id: 'topic', prompt: 'Which of these sounds the most fun?', bonus: 0.25, opts: topTags(cands, g).map((t) => ({ label: `✨ ${cap(t)}`, kind: 'topic', value: t, reason: `Focuses on ${t}` })) });
    qs.push({ id: 'exp', prompt: 'Are you new to this, or ready for a challenge?', bonus: 0.15, opts: [
      { label: '🌱 New to it — beginners welcome', kind: 'exp', value: 'new', reason: 'No tryout needed, so beginners are welcome' },
      { label: '🚀 Ready for a challenge', kind: 'exp', value: 'challenge', reason: 'A step up: it has a tryout or audition' }] });
    const dayCount = {};
    cands.forEach((i) => i.days.forEach((d) => { dayCount[d] = (dayCount[d] || 0) + 1; }));
    qs.push({ id: 'day', prompt: 'Which day works best for you?', bonus: 0.1, opts: Object.entries(dayCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => ({ label: `📅 ${d}s`, kind: 'day', value: d, reason: `Meets on ${d}s` })) });
    qs.push({ id: 'cost', prompt: 'Is cost a factor?', bonus: 0, opts: [{ label: '💸 Free or low-cost (about $25 or less)', kind: 'cost', value: 'low', reason: 'Free or low-cost' }] });
    return qs;
  }
  function topTags(cands, g) {
    const skip = new Set((g.interest || []).map((t) => lc(t)));
    const n = {};
    cands.forEach((i) => i.tags.forEach((t) => { if (!GENERIC_TAGS.has(t) && !skip.has(t) && t.length > 2) n[t] = (n[t] || 0) + 1; }));
    return Object.entries(n).filter(([, c]) => c < cands.length).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
  }
  function chooseQuestion(g) {
    const cands = g.cand.map((id) => byId.get(id));
    let best = null;
    for (const q of buildQuestions(cands, g)) {
      if (g.asked.includes(q.id)) continue;
      const opts = q.opts.map((o) => ({ ...o, hit: cands.filter(test(o.kind, o.value)) }))
        .map((o) => ({ ...o, m: o.hit.length })).filter((o) => o.m > 0 && o.m < cands.length && (q.id !== 'topic' || o.m >= 2));
      if (!opts.length) continue;
      // reward questions whose options split the list evenly AND don't all describe the same few activities
      const covered = new Set(opts.flatMap((o) => o.hit.map((i) => i.id))).size;
      const overlap = covered / opts.reduce((n, o) => n + o.m, 0);
      const score = opts.reduce((s, o) => s + H(o.m / cands.length), 0) * overlap + q.bonus;
      if (!best || score > best.score) best = { ...q, opts, score };
    }
    return best;
  }

  // ---- replies ----
  const blank = (state) => ({ state: { ...state }, text: '', items: [], events: [], chips: [] });
  const who = (state) => {
    const g = state.grade;
    if (!g) return '';
    if (typeof g === 'string') return ` for ${hub.meta.divisions[g].label}`;
    const lab = (x) => (x === -2 ? 'PreK3' : x === -1 ? 'PreK4' : x === 0 ? 'K' : String(x));
    return g[0] === g[1] ? ` for Grade ${lab(g[0])}` : ` for Grades ${lab(g[0])}–${lab(g[1])}`;
  };  function ask(out, g, lead) {
    const q = chooseQuestion(g);
    if (!q || g.cand.length <= 3 || g.asked.length >= g.total) return recommend(out, g, lead);
    g.pending = { id: q.id, opts: q.opts.map(({ label, kind, value, reason }) => ({ label, kind, value, reason })) };
    out.state.g = g;
    out.text = lead || '';
    out.question = `${g.asked.length === 0 ? 'Quick question' : 'One more'}: ${q.prompt}`;
    out.chips = [...q.opts.map((o) => o.label), NO_PREF, SHOW_ALL].slice(0, 6);
    return out;
  }

  function reasonsFor(it, g) {
    const r = [];
    const hits = (g.interest || []).filter((t) => { const s = t.replace(/(ing|s)$/, ''); return s.length > 2 && lc(`${it.name} ${it.tags.join(' ')} ${it.category}`).includes(s); });
    if (hits.length) r.push(`Matches your interest in ${[...new Set(hits)].slice(0, 2).join(' and ')}`);
    g.answers.forEach((a) => r.push(a.reason));
    if (it.cost === 0) r.push('Free'); else if (it.costText) r.push(`Cost: ${it.costText}`);
    if (!g.answers.some((a) => a.kind === 'exp')) r.push(it.tryout ? 'Has a tryout or audition' : 'No tryout needed');
    r.push(`Open to ${it.gradeText}`);
    return [...new Set(r)].slice(0, 4);
  }

  function recommend(out, g, lead, plain) {
    const pool = g.cand.filter((id) => !g.shown.includes(id));
    const top = pool.slice(0, 3).map((id) => byId.get(id));
    g.pending = null; g.shown.push(...top.map((i) => i.id));
    out.state.g = g; out.state.last = g.cand; out.state.offset = 0;
    if (!top.length) {
      out.text = "That's every match I have for those answers! Want to start fresh and try something different?";
      out.chips = ['Start over', 'What’s coming up?'];
      return out;
    }
    out.text = plain ? lead : `${lead ? lead + ' ' : ''}${g.answers.length ? 'Based on what you told me, here' : 'Here'} ${top.length === 1 ? 'is my top pick' : `are my top ${top.length} picks`}:`;
    out.items = top; out.detail = true; out.reasons = {}; out.badges = {};
    top.forEach((it, n) => { out.reasons[it.id] = reasonsFor(it, g); out.badges[it.id] = g.shown.length <= 3 && n === 0 ? '⭐ Top pick' : ''; });
    out.chips = [`Tell me more about ${top[0].name}`, g.cand.length > g.shown.length ? 'Show different options' : null, 'Start over'].filter(Boolean);
    return out;
  }

  function startFlow(out, { cand, interest }, lead) {
    const g = { cand, all: cand, interest: interest || [], asked: [], answers: [], shown: [], total: 2, pending: null };
    return ask(out, g, lead);
  }

  function answer(state, text) {
    const g = { ...state.g };
    const t = norm(text);
    const out = blank(state);
    if (t === norm(SHOW_ALL)) {
      const all = g.all.map((id) => byId.get(id));
      out.state.g = null; out.state.last = g.all; out.state.offset = 0;
      out.text = `Here are the top matches (${all.length} in total):`;
      out.items = all.slice(0, 4); out.chips = all.length > 4 ? ['Show more', 'Start over'] : ['Start over'];
      return out;
    }
    const opt = g.pending.opts.find((o) => norm(o.label) === t || (t.length > 3 && (norm(o.label).includes(t) || t.includes(norm(o.label).replace(/^\W+/, '')))));
    const skip = t === norm(NO_PREF);
    if (!opt && !skip) return null; // not an answer: treat as a new question
    g.asked = [...g.asked, g.pending.id];
    let lead = skip ? 'No problem!' : rand(REACT);
    if (opt) {
      const narrowed = g.cand.filter((id) => test(opt.kind, opt.value)(byId.get(id)));
      if (narrowed.length) { g.cand = narrowed; g.answers = [...g.answers, { kind: opt.kind, reason: opt.reason }]; }
      else lead = "Hmm, nothing matched that exactly, so I'll keep my options open.";
    }
    return ask(out, g, lead);
  }

  function detail(state, text) {
    const it = items.find((i) => norm(text).includes(norm(i.name)));
    if (!it) return null;
    const steps = [it.tryout && 'there’s a tryout or audition', it.application && 'there’s an application'].filter(Boolean);
    const out = blank(state);
    out.text = `Here’s everything I know about ${it.name}. ${steps.length ? `To join, ${steps.join(' and ')}.` : 'To join, just show up — no tryout or application needed.'} ${it.sponsorEmail ? `Email ${it.sponsor} to get started.` : it.sponsor ? `Ask ${it.sponsor} for details.` : ''}`;
    out.items = [it]; out.detail = true;
    out.chips = ['Show different options', 'Start over'];
    return out;
  }

  function surprise(state) {
    const pool = eddie.filterItems({ grade: state.grade }, []);
    const out = blank(state);
    if (!pool.length) { out.text = 'I don’t have anything listed for that grade yet — check back soon!'; out.chips = ['Start over']; return out; }
    const it = rand(pool);
    out.text = '🎲 Eddie’s surprise pick:';
    out.items = [it]; out.detail = true;
    out.reasons = { [it.id]: [`Open to ${it.gradeText}`, it.cost === 0 ? 'Free' : `Cost: ${it.costText}`, it.tryout ? 'Has a tryout or audition' : 'No tryout needed'] };
    out.badges = { [it.id]: '🎲 Surprise!' };
    out.chips = ['Surprise me again', NOT_SURE, 'Start over'];
    return out;
  }

  function respond(text, state = {}) {
    const t = norm(text);

    // 1) awaiting a grade before starting a guided search
    if (state.g?.awaitGrade) {
      const r = eddie.respond(text, { ...state, g: undefined });
      if (r.state.grade) {
        const cand = eddie.filterItems({ grade: r.state.grade }, []).map((i) => i.id);
        const out = blank(r.state);
        if (!cand.length) return { ...r, state: { ...r.state, g: null } };
        return startFlow(out, { cand, interest: [] }, `Got it${who(r.state)}! Let’s find your fit.`);
      }
      return { ...r, state: { ...r.state, g: state.g } };
    }

    // 2) answering a follow-up question
    if (state.g?.pending) {
      const r = answer(state, text);
      if (r) return r;
      state = { ...state, g: null }; // they asked something new; drop the flow
    }

    // 3) special requests
    if (/\b(surprise me|random|pick for me)\b/.test(t) || t === 'surprise me again') return surprise(state);
    if (t.startsWith('tell me more about') || (state.g && /\b(tell me more|more about)\b/.test(t))) { const d = detail(state, text); if (d) return d; }
    if (t === 'show different options' && state.g?.cand) {
      const out = blank(state); const g = { ...state.g };
      if (g.cand.some((id) => !g.shown.includes(id))) return recommend(out, g, 'Here are a few more that fit:', true);
      const rest = g.all.filter((id) => !g.shown.includes(id));
      if (!rest.length) { out.text = 'That’s everything I have for this search! Want to try something new?'; out.chips = ['Start over', 'What’s coming up?']; return out; }
      return recommend(out, { ...g, cand: rest, answers: [] }, 'That’s everything matching your answers, so here are a few other ideas you might like:', true);
    }
    if ((t === norm(NOT_SURE) || (/\b(not sure|dont know|don t know|no idea|help me (find|choose|pick|decide)|what should (i|we|my)|recommend something|suggest something)\b/.test(t) && t.length < 45))) {
      const out = blank(state);
      if (!state.grade) { out.state.g = { awaitGrade: true }; out.text = 'Happy to help you find your fit! First, what grade is the student in?'; out.chips = ['PreK–2', 'Grades 3–5', 'Grades 6–8', 'Grades 9–12']; return out; }
      const cand = eddie.filterItems({ grade: state.grade }, []).map((i) => i.id);
      if (!cand.length) return eddie.respond(text, state);
      return startFlow(out, { cand, interest: [] }, `No worries${who(state)}! Let me ask a couple of quick questions.`);
    }

    // 4) normal engine
    const r = eddie.respond(text, { ...state, g: undefined });
    const many = (r.state.last || []).length;
    if (r.items.length && many >= 6 && !REFINE.test(t) && !/^(show )?(me )?(more|next)\b/.test(t)) {
      const n = many;
      return startFlow(blank(r.state), { cand: r.state.last, interest: r.state.interest }, `Ooh, I found ${n} that could be a great fit${who(r.state)}! Let me ask a quick question or two so I can pick the best ones for you.`);
    }
    if (r.chips.includes('Arts & music') && !r.chips.includes(NOT_SURE)) r.chips = [...r.chips.slice(0, 4), NOT_SURE];
    return r;
  }

  return { respond, rank: eddie.rank, filterItems: eddie.filterItems };
}
