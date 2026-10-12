import { createEddie } from './eddie.js';
import { createGuide } from './guide.js';

const $ = (s) => document.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const hub = await fetch('data/hub.json', { cache: 'no-cache' }).then((r) => r.json());
const eddie = createGuide(hub, createEddie(hub));
const { items, events, meta } = hub;

// ---------- cards ----------
function card(it, compact = false, why = [], badge = '') {
  const pills = [
    it.cost === 0 ? '<span class="pill free">Free</span>' : `<span class="pill gray">${esc(it.costText)}</span>`,
    it.tryout ? '<span class="pill">Tryout / audition</span>' : '<span class="pill gray">No tryout</span>',
    it.application ? '<span class="pill">Application</span>' : '',
  ].join('');
  const contact = it.sponsorEmail
    ? `<a class="cta" href="mailto:${esc(it.sponsorEmail)}?subject=${encodeURIComponent('Question about ' + it.name)}">Email ${esc(it.sponsor || 'sponsor')}</a>`
    : '';
  const whyHtml = why && why.length ? `<div class="why"><b>Why Eddie picked this</b><ul>${why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';
  return `<article class="card${compact ? ' compact' : ''}">
    ${badge ? `<span class="badge">${esc(badge)}</span>` : ''}
    <span class="cat">${esc(it.category)}</span>
    <h3>${esc(it.name)}</h3>
    ${compact ? '' : `<p>${esc(it.description)}</p>`}
    <ul class="meta">
      <li><b>Who:</b> ${esc(it.gradeText)}</li>
      ${it.schedule ? `<li><b>When:</b> ${esc(it.schedule)}</li>` : ''}
      ${it.location ? `<li><b>Where:</b> ${esc(it.location)}</li>` : ''}
      ${it.sponsor ? `<li><b>Lead:</b> ${esc(it.sponsor)}</li>` : ''}
    </ul>
    <div class="pills">${pills}</div>
    ${whyHtml}
    ${contact}
  </article>`;
}

function fmtDate(d) {
  if (!d) return { m: 'TBD', day: '·' };
  const dt = new Date(d + 'T12:00:00');
  return { m: dt.toLocaleString('en-US', { month: 'short' }).toUpperCase(), day: dt.getDate() };
}
function eventCard(e) {
  const { m, day } = fmtDate(e.date);
  const time = [e.start, e.end].filter(Boolean).join(' – ');
  return `<article class="event">
    <div class="date-badge" aria-hidden="true"><div class="m">${m}</div><div class="d">${day}</div></div>
    <div>
      <h3>${esc(e.name)}</h3>
      ${e.description ? `<p>${esc(e.description)}</p>` : ''}
      <ul class="meta">
        ${e.date ? `<li><b>When:</b> ${new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${time ? ', ' + esc(time) : ''}</li>` : ''}
        ${e.location ? `<li><b>Where:</b> ${esc(e.location)}</li>` : ''}
        <li><b>Who:</b> ${esc(e.gradeText)}${e.costText ? ' · ' + esc(e.costText) : ''}</li>
      </ul>
      ${e.link ? `<a class="cta" href="${esc(e.link)}" rel="noopener">Details</a>` : e.contactEmail ? `<a class="cta" href="mailto:${esc(e.contactEmail)}">Contact ${esc(e.contact || 'organizer')}</a>` : ''}
    </div>
  </article>`;
}

// ---------- chat ----------
const log = $('#log'), chipsEl = $('#chips'), input = $('#msg');
let state = {};

function addMsg(role, html) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  wrap.innerHTML = role === 'eddie'
    ? `<img class="avatar" src="assets/eddie-the-eagle.png" alt=""><div class="stack">${html}</div>`
    : `<div class="bubble">${html}</div>`;
  log.append(wrap);
  log.scrollTop = log.scrollHeight;
  return wrap;
}
function setChips(list) {
  chipsEl.innerHTML = '';
  list.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = c;
    b.addEventListener('click', () => send(c));
    chipsEl.append(b);
  });
}
function eddieSays(r) {
  const typing = addMsg('eddie', '<div class="bubble typing" aria-label="Eddie is typing"><i></i><i></i><i></i></div>');
  const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450;
  setTimeout(() => {
    typing.remove();
    const body = [
      r.text ? `<div class="bubble">${esc(r.text)}</div>` : '',
      r.question ? `<div class="bubble q">${esc(r.question)}</div>` : '',
      ...r.items.map((i) => card(i, !r.detail, r.reasons?.[i.id], r.badges?.[i.id])),
      ...r.events.map(eventCard),
    ].join('');
    addMsg('eddie', body);
    setChips(r.chips);
  }, delay);
}
function send(text) {
  text = (text ?? input.value).trim();
  if (!text) return;
  addMsg('me', esc(text));
  input.value = '';
  const r = eddie.respond(text, state);
  state = r.state;
  eddieSays(r);
}
$('#composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
$('#reset').addEventListener('click', () => { state = {}; log.innerHTML = ''; greet(); });

function greet() {
  eddieSays({
    text: "Hey there, War Eagle! 🦅 I'm Eddie. I can help you find clubs, athletics, arts, service, and events at Woodward. What grade is the student in?",
    items: [], events: [], chips: ['PreK–2', 'Grades 3–5', 'Grades 6–8', 'Grades 9–12'],
  });
}
greet();

// ---------- browse ----------
const cats = [...new Set(items.map((i) => i.category))].sort();
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const gradeOpts = [[-2, 'PreK3'], [-1, 'PreK4'], [0, 'K'], ...Array.from({ length: 12 }, (_, i) => [i + 1, String(i + 1)])];
gradeOpts.forEach(([v, l]) => $('#f-grade').insertAdjacentHTML('beforeend', `<option value="${v}">${v > 0 ? 'Grade ' : ''}${l}</option>`));
cats.forEach((c) => $('#f-cat').insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`));
days.forEach((d) => $('#f-day').insertAdjacentHTML('beforeend', `<option>${d}</option>`));

function renderBrowse() {
  const q = $('#q').value.trim().toLowerCase();
  const g = $('#f-grade').value, c = $('#f-cat').value, d = $('#f-day').value;
  const free = $('#f-free').checked, open = $('#f-open').checked;
  const smart = q ? new Set(eddie.rank(q).map((i) => i.id)) : null;
  const list = items.filter((it) =>
    (!q || smart.has(it.id) || `${it.name} ${it.category} ${it.tags.join(' ')} ${it.description} ${it.sponsor}`.toLowerCase().includes(q)) &&
    (g === '' || (it.gradeMin <= +g && it.gradeMax >= +g)) &&
    (!c || it.category === c) && (!d || it.days.includes(d)) &&
    (!free || it.cost === 0) && (!open || (!it.tryout && !it.application)));
  $('#count').textContent = `${list.length} ${list.length === 1 ? 'opportunity' : 'opportunities'}`;
  $('#grid').innerHTML = list.length ? list.map((i) => card(i)).join('') : '<div class="empty">Nothing matches those filters yet — try loosening one, or ask Eddie!</div>';
}
['#q', '#f-grade', '#f-cat', '#f-day', '#f-free', '#f-open'].forEach((s) => $(s).addEventListener('input', renderBrowse));
renderBrowse();

// ---------- events ----------
const today = new Date().toISOString().slice(0, 10);
const upcoming = events.filter((e) => !e.date || e.date >= today).sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
$('#event-list').innerHTML = upcoming.length ? upcoming.map(eventCard).join('') : '<div class="empty">No upcoming events posted yet. Check back soon!</div>';

$('#updated').textContent = `Last updated ${new Date(meta.updated).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`;
