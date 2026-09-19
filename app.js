import {
  DAYS, exercisesForDay, findExercise, lastEntryFor,
  propose, weekFor, phaseFor, isDeload, PAIN_STOP,
} from './engine.js';

const KEY = 'gindo.v1';
const RING = 339.292;
const SHEET_A = new Set(['press-inclinado', 'dominadas', 'done']);
const $ = (id) => document.getElementById(id);

const REST_DAYS = {
  0: 'Domingo — sauna o infrarrojos, y planificación. Ve a Historial, copia el log y pégalo en el doc.',
  2: 'Martes — movilidad 10 minutos en casa. Nada que registrar aquí.',
  3: 'Miércoles — conditioning en The Fitness Hub. Sustituye todo lo overhead y lo gimnástico.',
  4: 'Jueves — movilidad 10 minutos en casa. Nada que registrar aquí.',
  6: 'Sábado — cardio y deporte nuevo. Si ayer el peso muerto te cargó las lumbares, hoy piscina o bici, no cinta.',
};

let state = loadState();
let selectedDay = defaultDay();
let sheetCtx = null;
let ticker = null;
let wakeLock = null;

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && Array.isArray(raw.sessions)) return raw;
  } catch { /* almacenamiento corrupto o vacío */ }
  return { sessions: [], session: null, lastExport: null };
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultDay() {
  const d = new Date().getDay();
  return d === 1 || d === 5 ? d : 1;
}

function currentWeek() {
  return Math.max(1, weekFor(todayISO()));
}

function proposalsFor(day, sessionEntries) {
  const week = currentWeek();
  return exercisesForDay(day).map((ex) => {
    const p = propose(ex, lastEntryFor(state.sessions, ex.id), week);
    const stored = sessionEntries?.[ex.id];
    return { ex, p: stored?.load != null ? { ...p, load: stored.load } : p };
  });
}

/* ---------- sesión activa ---------- */

const active = () => state.session;

function slots(session) {
  const out = [];
  for (const { ex, p } of proposalsFor(session.day, session.entries)) {
    for (let i = 0; i < p.sets; i++) out.push({ ex, p, index: i });
  }
  return out;
}

const setAt = (session, exId, i) => session.entries[exId]?.sets?.[i];
const loggedCount = (session) => slots(session).filter((s) => setAt(session, s.ex.id, s.index)).length;
const firstPending = (session) => slots(session).find((s) => !setAt(session, s.ex.id, s.index)) ?? null;

function cursorSlot(session) {
  const all = slots(session);
  const c = session.cursor;
  return all.find((s) => s.ex.id === c?.exId && s.index === c?.index) ?? firstPending(session) ?? all[all.length - 1];
}

function startSession(day) {
  const first = proposalsFor(day)[0];
  state.session = {
    date: todayISO(), day, startedAt: Date.now(),
    entries: {}, cursor: { exId: first.ex.id, index: 0 },
    rest: null, finished: false,
  };
  save();
  render();
}

function commitSession(session) {
  const week = Math.max(1, weekFor(session.date));
  const entries = Object.entries(session.entries)
    .filter(([, v]) => v.sets.some(Boolean))
    .map(([exerciseId, v]) => {
      const ex = findExercise(exerciseId);
      const p = propose(ex, lastEntryFor(state.sessions, exerciseId), week);
      return {
        exerciseId,
        load: v.load ?? p.load,
        targetReps: p.reps,
        targetSets: p.sets,
        targetRir: p.rir,
        block: p.block,
        sets: v.sets.filter(Boolean),
      };
    });
  if (entries.length) state.sessions.push({ date: session.date, day: session.day, week, entries });
  state.session = null;
}

function flushStaleSession() {
  if (state.session && state.session.date !== todayISO()) {
    commitSession(state.session);
    save();
  }
}

/* ---------- descanso ---------- */

function beginRest(seconds, label) {
  active().rest = { until: Date.now() + seconds * 1000, total: seconds, label };
}

const restLeft = () => {
  const r = active()?.rest;
  return r ? Math.max(0, r.until - Date.now()) : 0;
};

function endRest() {
  if (!active()?.rest) return;
  active().rest = null;
  save();
  render();
}

function nudgeRest(deltaSeconds) {
  const r = active()?.rest;
  if (!r) return;
  r.until = Math.max(Date.now(), r.until + deltaSeconds * 1000);
  r.total = Math.max(15, r.total + deltaSeconds);
  save();
  paintRest();
}

function alarm() {
  try { navigator.vibrate?.([220, 90, 220]); } catch { /* sin motor de vibración */ }
  try {
    const ctx = new (window.AudioContext ?? window.webkitAudioContext)();
    for (const [i, freq] of [660, 880].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain).connect(ctx.destination);
      const t = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.start(t);
      osc.stop(t + 0.2);
    }
    setTimeout(() => ctx.close(), 900);
  } catch { /* audio bloqueado hasta que haya interacción */ }
}

function mmss(ms) {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function paintRest() {
  const r = active()?.rest;
  if (!r) return;
  const left = restLeft();
  $('rest-time').textContent = mmss(left);
  $('ring-fill').style.strokeDashoffset = RING * (1 - left / (r.total * 1000));
  $('rest-caption').textContent = r.label;
}

function paintClock() {
  const s = active();
  if (!s) return;
  const mins = Math.floor((Date.now() - s.startedAt) / 60000);
  $('session-clock').textContent = `${mins} min`;
}

function tick() {
  const s = active();
  if (!s || s.finished) return stopTicker();
  paintClock();
  if (!s.rest) return;
  if (restLeft() <= 0) {
    alarm();
    endRest();
    return;
  }
  paintRest();
}

function startTicker() { ticker ??= setInterval(tick, 250); }
function stopTicker() { clearInterval(ticker); ticker = null; }

async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* el navegador no lo permite */ }
}

/* ---------- piezas de UI ---------- */

function monster(exId, height) {
  const el = document.createElement('span');
  el.className = `monster ${SHEET_A.has(exId) ? 'sheet-a' : 'sheet-b'} m-${exId}`;
  el.style.setProperty('--mh', `${height}px`);
  return el;
}

function card(...children) {
  const el = document.createElement('div');
  el.className = 'card';
  el.append(...children);
  return el;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const dayLabel = (day) => DAYS[day].name.split(' — ')[0];
const dayFocus = (day) => DAYS[day].name.split(' — ')[1];

function loadText(ex, p) {
  return ex.kind === 'pullup' ? 'Peso corporal' : `${p.load} ${p.unit}`;
}

/* ---------- pantalla: portada ---------- */

function renderIdle() {
  const wrap = $('session-intro');
  wrap.innerHTML = '';
  const plan = proposalsFor(selectedDay);

  const head = el('div', 'intro');
  head.append(monster(plan[0].ex.id, 96));
  const text = el('div', 'intro-text');
  text.append(el('h2', null, `${dayLabel(selectedDay)} · ${dayFocus(selectedDay)}`));

  const totalSets = plan.reduce((n, { p }) => n + p.sets, 0);
  const minutes = Math.round(plan.reduce((n, { p }) => n + p.sets * (40 + p.rest), 0) / 60);
  text.append(el('p', 'meta', `${plan.length} ejercicios · ${totalSets} series · ~${minutes} min`));
  head.append(text);

  const list = el('ul', 'plan-list');
  for (const { ex, p } of plan) {
    const li = document.createElement('li');
    li.append(el('span', null, ex.name));
    li.append(el('span', 'dose', p.load === null ? `${p.sets}×${p.reps}` : `${p.sets}×${p.reps} · ${loadText(ex, p)}`));
    list.append(li);
  }

  wrap.append(card(head, list));
  $('start-session').textContent = `Empezar ${dayLabel(selectedDay).toLowerCase()}`;
}

function renderDaySwitch() {
  const wrap = $('day-switch');
  wrap.innerHTML = '';
  for (const day of [1, 5]) {
    const b = el('button', selectedDay === day ? 'active' : '', `${dayLabel(day)} · ${dayFocus(day).split(' + ')[0]}`);
    b.type = 'button';
    b.onclick = () => { selectedDay = day; render(); };
    wrap.append(b);
  }
}

function renderRestDay() {
  const box = $('rest-day');
  const today = new Date().getDay();
  const showing = Boolean(REST_DAYS[today]);
  box.classList.toggle('hidden', !showing);
  if (showing) box.textContent = REST_DAYS[today];
}

/* ---------- pantalla: entrenando ---------- */

function setButton(session, ex, p, index, isCursor) {
  const logged = setAt(session, ex.id, index);
  const b = el('button', 'set-btn');
  b.type = 'button';
  if (logged) b.classList.add('done');
  else if (isCursor) b.classList.add('next');
  if (logged && logged.pain > PAIN_STOP) b.classList.add('pain-high');

  if (logged) {
    b.append(el('span', 'big', logged.reps), el('span', 'meta', `RIR ${logged.rir} · dolor ${logged.pain}`));
    b.setAttribute('aria-label', `Serie ${index + 1}: ${logged.reps} reps, RIR ${logged.rir}, dolor ${logged.pain}. Tocar para editar.`);
  } else {
    b.append(el('span', null, `Serie ${index + 1}`), el('span', 'meta', `${p.reps} reps`));
  }
  b.onclick = () => openSheet(ex.id, index);
  return b;
}

function renderCurrent(session) {
  const wrap = $('current-card');
  wrap.innerHTML = '';
  const slot = cursorSlot(session);
  const { ex, p } = slot;

  const head = el('div', 'exercise-head');
  head.append(monster(ex.id, 86));
  const text = el('div', 'exercise-text');
  text.append(el('h3', null, ex.name));

  const pres = el('div', 'prescription');
  if (p.load === null) {
    const input = document.createElement('input');
    input.className = 'load-edit';
    input.type = 'number';
    input.inputMode = 'decimal';
    input.placeholder = 'kg';
    input.setAttribute('aria-label', `Carga para ${ex.name}`);
    input.onchange = () => {
      const v = parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      (session.entries[ex.id] ??= { load: null, sets: [] }).load = v;
      save();
      render();
    };
    pres.append(input);
  } else {
    pres.append(el('span', 'load', loadText(ex, p)));
  }
  pres.append(el('span', 'dose', `${p.sets}×${p.reps} · RIR ${p.rirLabel}`));
  text.append(pres);
  head.append(text);

  const note = el('p', `note ${p.tone === 'flat' ? '' : p.tone}`.trim(), p.note);

  const sets = el('div', 'sets');
  for (let i = 0; i < p.sets; i++) {
    sets.append(setButton(session, ex, p, i, i === slot.index));
  }

  wrap.append(card(head, note, sets));

  const needsLoad = p.load === null;
  const btn = $('log-set');
  btn.disabled = needsLoad;
  btn.textContent = needsLoad
    ? 'Escribe la carga para empezar'
    : setAt(session, ex.id, slot.index) ? `Editar serie ${slot.index + 1}` : `Registrar serie ${slot.index + 1}`;
}

function renderStrip(session) {
  const wrap = $('exercise-strip');
  wrap.innerHTML = '';
  const cursor = cursorSlot(session);
  for (const { ex, p } of proposalsFor(session.day, session.entries)) {
    const done = (session.entries[ex.id]?.sets ?? []).filter(Boolean).length;
    const b = el('button', '', `${done}/${p.sets}`);
    b.type = 'button';
    b.setAttribute('aria-label', `${ex.name}: ${done} de ${p.sets} series`);
    if (ex.id === cursor.ex.id) b.classList.add('current');
    else if (done >= p.sets) b.classList.add('done');
    b.onclick = () => {
      const pending = slots(session).find((s) => s.ex.id === ex.id && !setAt(session, ex.id, s.index));
      session.cursor = { exId: ex.id, index: pending?.index ?? 0 };
      save();
      render();
    };
    wrap.append(b);
  }
}

function renderActive(session) {
  const total = slots(session).length;
  const done = loggedCount(session);
  $('progress-label').textContent = `${done} de ${total} series`;
  $('progress-fill').style.width = `${(done / total) * 100}%`;
  paintClock();

  renderStrip(session);
  renderCurrent(session);

  const resting = Boolean(session.rest);
  $('rest-panel').classList.toggle('hidden', !resting);
  if (resting) paintRest();
  startTicker();
}

/* ---------- pantalla: resumen ---------- */

function renderDone(session) {
  const wrap = $('summary');
  wrap.innerHTML = '';

  const plan = proposalsFor(session.day, session.entries);
  const logged = plan.flatMap(({ ex }) => (session.entries[ex.id]?.sets ?? []).filter(Boolean).map((s) => ({ ex, s })));
  const volume = plan.reduce((n, { ex, p }) => {
    const sets = (session.entries[ex.id]?.sets ?? []).filter(Boolean);
    return n + (ex.kind === 'pullup' ? 0 : sets.reduce((k, s) => k + s.reps * (p.load ?? 0), 0));
  }, 0);

  const head = el('div', 'summary-head');
  head.append(monster('done', 96));
  head.append(el('h2', null, '¡Sesión hecha!'));
  head.append(el('p', 'hint', `${dayLabel(session.day)} · ${dayFocus(session.day)}`));
  wrap.append(head);

  const stats = el('div', 'stat-row');
  for (const [v, k] of [
    [logged.length, 'series'],
    [`${Math.round((Date.now() - session.startedAt) / 60000)}′`, 'duración'],
    [`${Math.round(volume)}`, 'kg movidos'],
    [`${Math.max(0, ...logged.map(({ s }) => s.pain))}`, 'dolor máx'],
  ]) {
    const box = el('div', 'stat');
    box.append(el('span', 'v', String(v)), el('span', 'k', k));
    stats.append(box);
  }
  wrap.append(stats);

  for (const { ex, p } of plan) {
    const sets = (session.entries[ex.id]?.sets ?? []).filter(Boolean);
    if (!sets.length) continue;
    const row = el('div', 'hist-row');
    row.append(el('span', null, ex.name));
    row.append(el('span', 'when', `${ex.kind === 'pullup' ? '' : `${p.load} ${p.unit} · `}${sets.map((s) => s.reps).join('·')}`));
    wrap.append(row);
  }
}

/* ---------- hoja de registro ---------- */

function openSheet(exId, index) {
  const session = active();
  const { ex, p } = proposalsFor(session.day, session.entries).find((x) => x.ex.id === exId);
  const existing = setAt(session, exId, index);
  const prev = (session.entries[exId]?.sets ?? []).filter(Boolean).slice(-1)[0];

  sheetCtx = {
    exId, index,
    reps: existing?.reps ?? p.reps,
    rir: existing?.rir ?? p.rir,
    pain: existing?.pain ?? prev?.pain ?? 0,
  };

  $('sheet-title').textContent = `${ex.name} · serie ${index + 1}`;
  $('sheet-sub').textContent = `Objetivo: ${p.reps} reps a RIR ${p.rirLabel}`;
  renderSheet();
  $('sheet').showModal();
}

function renderSheet() {
  $('reps-value').textContent = sheetCtx.reps;

  const rir = $('rir-chips');
  rir.innerHTML = '';
  for (let v = 0; v <= 5; v++) {
    const b = el('button', sheetCtx.rir === v ? 'sel' : '', v === 5 ? '5+' : String(v));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(sheetCtx.rir === v));
    b.setAttribute('aria-label', `RIR ${v === 5 ? '5 o más' : v}`);
    b.onclick = () => { sheetCtx.rir = v; renderSheet(); };
    rir.append(b);
  }

  const pain = $('pain-chips');
  pain.innerHTML = '';
  for (let v = 0; v <= 10; v++) {
    const b = el('button', sheetCtx.pain === v ? (v > PAIN_STOP ? 'sel high' : 'sel') : '', String(v));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(sheetCtx.pain === v));
    b.setAttribute('aria-label', `Dolor ${v} de 10`);
    b.onclick = () => { sheetCtx.pain = v; renderSheet(); };
    pain.append(b);
  }
}

function saveSet() {
  const session = active();
  const { ex, p } = proposalsFor(session.day, session.entries).find((x) => x.ex.id === sheetCtx.exId);
  const entry = session.entries[sheetCtx.exId] ??= { load: null, sets: [] };
  const wasEmpty = !entry.sets[sheetCtx.index];
  entry.load ??= p.load;
  entry.sets[sheetCtx.index] = { reps: sheetCtx.reps, rir: sheetCtx.rir, pain: sheetCtx.pain };

  $('sheet').close();

  const next = firstPending(session);
  if (next) {
    session.cursor = { exId: next.ex.id, index: next.index };
    if (wasEmpty) {
      beginRest(p.rest, next.ex.id === ex.id
        ? `Siguiente: ${ex.name}, serie ${next.index + 1}`
        : `Siguiente ejercicio: ${next.ex.name}`);
    }
  } else {
    session.finished = true;
    session.rest = null;
  }

  save();
  render();
}

/* ---------- historial ---------- */

function renderHistory() {
  const wrap = $('history');
  wrap.innerHTML = '';

  if (!state.sessions.length) {
    wrap.innerHTML = '<p class="empty">Todavía no has cerrado ninguna sesión.</p>';
    return;
  }

  for (const s of [...state.sessions].reverse()) {
    const box = card();
    box.append(el('h3', null, `${dayLabel(s.day)} ${formatDate(s.date)}`));
    const sub = el('p', 'hint', `Semana ${s.week} · fase ${phaseFor(s.week)}`);
    sub.style.margin = '0 0 8px';
    box.append(sub);

    for (const e of s.entries) {
      const ex = findExercise(e.exerciseId);
      const row = el('div', 'hist-row');
      const reps = e.sets.map((x) => x.reps).join('·');
      const maxPain = Math.max(...e.sets.map((x) => x.pain));
      row.append(el('span', null, ex.name));
      row.append(el('span', 'when', ex.kind === 'pullup'
        ? `${reps} · dolor ${maxPain}`
        : `${e.load} ${ex.unit ?? 'kg'} · ${reps} · dolor ${maxPain}`));
      box.append(row);
    }
    wrap.append(box);
  }
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${d} ${months[m - 1]} ${y}`;
}

function buildLog() {
  const pending = state.lastExport
    ? state.sessions.filter((s) => s.date > state.lastExport)
    : state.sessions;
  if (!pending.length) return null;

  const lines = [];
  for (const s of pending) {
    lines.push(`**${dayLabel(s.day)} ${formatDate(s.date)}** — semana ${s.week}, fase ${phaseFor(s.week)}`);
    lines.push('');
    lines.push('| Ejercicio | Carga | Series (reps/RIR) | Dolor máx |');
    lines.push('| --- | --- | --- | --- |');
    for (const e of s.entries) {
      const ex = findExercise(e.exerciseId);
      const sets = e.sets.map((x) => `${x.reps}/${x.rir}`).join(' · ');
      const load = ex.kind === 'pullup' ? 'peso corporal' : `${e.load} ${ex.unit ?? 'kg'}`;
      const maxPain = Math.max(...e.sets.map((x) => x.pain));
      lines.push(`| ${ex.name} | ${load} | ${sets} | ${maxPain}/10 |`);
    }
    lines.push('');
  }
  return { text: lines.join('\n'), last: pending[pending.length - 1].date, count: pending.length };
}

async function copyLog() {
  const log = buildLog();
  if (!log) {
    $('copy-hint').textContent = 'No hay sesiones nuevas desde la última vez que copiaste.';
    return;
  }
  try {
    await navigator.clipboard.writeText(log.text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = log.text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  state.lastExport = log.last;
  save();
  $('copy-hint').textContent = `${log.count} sesión(es) copiadas. Pégalas en la pestaña "Log de progreso" del doc.`;
}

function renderCopyHint() {
  const log = buildLog();
  $('copy-hint').textContent = log ? `${log.count} sesión(es) sin pasar al doc.` : 'Todo al día con el doc.';
}

/* ---------- render raíz ---------- */

function renderHeader() {
  const week = currentWeek();
  const badge = $('phase-badge');
  badge.textContent = isDeload(week) ? `S${week} · descarga` : `S${week} · fase ${phaseFor(week)}`;
  badge.classList.toggle('deload', isDeload(week));

  const done = state.sessions.length;
  $('subtitle').textContent = done
    ? `${done} sesión${done === 1 ? '' : 'es'} registrada${done === 1 ? '' : 's'}`
    : 'Sin sesiones todavía. Arranca el lunes 21 de septiembre.';
}

function render() {
  renderHeader();

  const session = active();
  const stage = !session ? 'idle' : session.finished ? 'done' : 'active';

  $('stage-idle').classList.toggle('hidden', stage !== 'idle');
  $('stage-active').classList.toggle('hidden', stage !== 'active');
  $('stage-done').classList.toggle('hidden', stage !== 'done');
  $('start-session').classList.toggle('hidden', stage !== 'idle');

  if (stage === 'idle') {
    renderDaySwitch();
    renderRestDay();
    renderIdle();
    stopTicker();
    keepAwake(false);
  } else if (stage === 'active') {
    renderActive(session);
    keepAwake(true);
  } else {
    renderDone(session);
    stopTicker();
    keepAwake(false);
  }

  renderHistory();
  renderCopyHint();
}

/* ---------- eventos ---------- */

$('start-session').onclick = () => startSession(selectedDay);

$('log-set').onclick = () => {
  const slot = cursorSlot(active());
  openSheet(slot.ex.id, slot.index);
};

$('abort-session').onclick = () => {
  if (!confirm('¿Descartar esta sesión? Se perderán las series registradas.')) return;
  state.session = null;
  save();
  render();
};

$('close-session').onclick = () => {
  commitSession(active());
  save();
  render();
};

$('resume-session').onclick = () => {
  active().finished = false;
  save();
  render();
};

$('rest-skip').onclick = endRest;
$('rest-plus').onclick = () => nudgeRest(15);
$('rest-minus').onclick = () => nudgeRest(-15);

$('reps-minus').onclick = () => { sheetCtx.reps = Math.max(0, sheetCtx.reps - 1); renderSheet(); };
$('reps-plus').onclick = () => { sheetCtx.reps += 1; renderSheet(); };
$('sheet-save').onclick = saveSet;
$('sheet-cancel').onclick = () => $('sheet').close();
$('sheet').addEventListener('close', () => { sheetCtx = null; });

$('copy-log').onclick = copyLog;

for (const tab of document.querySelectorAll('.tabs button')) {
  tab.onclick = () => {
    for (const t of document.querySelectorAll('.tabs button')) t.classList.toggle('active', t === tab);
    $('view-hoy').classList.toggle('hidden', tab.dataset.view !== 'hoy');
    $('view-historial').classList.toggle('hidden', tab.dataset.view !== 'historial');
  };
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (active() && !active().finished) keepAwake(true);
  tick();
});

flushStaleSession();
if (active()) selectedDay = active().day;
render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
