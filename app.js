import {
  DAYS, exercisesForDay, findExercise, lastEntryFor,
  propose, weekFor, phaseFor, isDeload, PAIN_STOP,
} from './engine.js';

const KEY = 'gindo.v1';
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

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && Array.isArray(raw.sessions)) return raw;
  } catch { /* almacenamiento corrupto o vacío */ }
  return { sessions: [], draft: null, lastExport: null };
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
  return d === 1 || d === 5 ? d : null;
}

function currentWeek() {
  return Math.max(1, weekFor(todayISO()));
}

function proposalsFor(day) {
  const week = currentWeek();
  return exercisesForDay(day).map((ex) => ({
    ex,
    p: propose(ex, lastEntryFor(state.sessions, ex.id), week),
  }));
}

function draftFor(day) {
  if (!state.draft || state.draft.day !== day || state.draft.date !== todayISO()) return null;
  return state.draft;
}

function ensureDraft(day) {
  if (!draftFor(day)) state.draft = { date: todayISO(), day, entries: {} };
  return state.draft;
}

function commitDraft(draft) {
  const week = Math.max(1, weekFor(draft.date));
  const entries = Object.entries(draft.entries)
    .filter(([, v]) => v.sets.some((s) => s))
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
  if (entries.length) {
    state.sessions.push({ date: draft.date, day: draft.day, week, entries });
  }
  state.draft = null;
}

function flushStaleDraft() {
  if (state.draft && state.draft.date !== todayISO()) {
    commitDraft(state.draft);
    save();
  }
}

function noteClass(note) {
  if (/Dolor \d+\/10|bloqueada/i.test(note)) return 'note bad';
  if (/Fase 1|descarga|Repite|no sube|lastre/i.test(note)) return 'note warn';
  if (/Sube|Objetivo cerrado|levantado/i.test(note)) return 'note up';
  return 'note';
}

function renderHeader() {
  const week = currentWeek();
  const badge = $('phase-badge');
  badge.textContent = isDeload(week) ? `Semana ${week} · descarga` : `Semana ${week} · fase ${phaseFor(week)}`;
  badge.classList.toggle('deload', isDeload(week));

  const done = state.sessions.length;
  $('subtitle').textContent = done
    ? `${done} sesión${done === 1 ? '' : 'es'} registrada${done === 1 ? '' : 's'}`
    : 'Sin sesiones todavía. Arranca el lunes 21 de septiembre.';
}

function renderDaySwitch() {
  const wrap = $('day-switch');
  wrap.innerHTML = '';
  for (const day of [1, 5]) {
    const b = document.createElement('button');
    b.textContent = day === 1 ? 'Lunes · empuje' : 'Viernes · tracción';
    b.className = selectedDay === day ? 'active' : '';
    b.onclick = () => { selectedDay = day; render(); };
    wrap.append(b);
  }
}

function renderRestDay() {
  const box = $('rest-day');
  const today = new Date().getDay();
  const showing = selectedDay !== today && REST_DAYS[today];
  box.classList.toggle('hidden', !showing);
  if (showing) box.innerHTML = `<p class="hint" style="margin:0">${REST_DAYS[today]}</p>`;
}

function setButton(exId, index, target, logged) {
  const b = document.createElement('button');
  b.className = 'set-btn' + (logged ? ' done' : '');
  if (logged && logged.pain > PAIN_STOP) b.classList.add('pain-high');
  b.innerHTML = logged
    ? `<span class="big">${logged.reps}</span><span class="meta">RIR ${logged.rir} · dolor ${logged.pain}</span>`
    : `<span>Serie ${index + 1}</span><span class="meta">${target} reps</span>`;
  b.onclick = () => openSheet(exId, index);
  return b;
}

function renderExercises() {
  const wrap = $('exercises');
  wrap.innerHTML = '';
  const draft = draftFor(selectedDay);

  for (const { ex, p } of proposalsFor(selectedDay)) {
    const entry = draft?.entries[ex.id];
    const load = entry?.load ?? p.load;

    const card = document.createElement('div');
    card.className = 'card';

    const head = document.createElement('h3');
    head.textContent = ex.name;
    card.append(head);

    const pres = document.createElement('div');
    pres.className = 'prescription';
    if (load === null) {
      const input = document.createElement('input');
      input.className = 'load-edit';
      input.type = 'number';
      input.inputMode = 'decimal';
      input.placeholder = 'kg';
      input.onchange = () => {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v)) return;
        ensureDraft(selectedDay);
        const e = state.draft.entries[ex.id] ??= { load: null, sets: [] };
        e.load = v;
        save();
        render();
      };
      pres.append(input);
      const t = document.createElement('span');
      t.className = 'rest';
      t.textContent = `— ${p.sets}×${p.reps} · RIR ${p.rirLabel}`;
      pres.append(t);
    } else {
      const big = document.createElement('span');
      big.className = 'load';
      big.textContent = ex.kind === 'pullup' ? 'Peso corporal' : `${load} ${p.unit}`;
      const rest = document.createElement('span');
      rest.className = 'rest';
      rest.textContent = `${p.sets}×${p.reps} · RIR ${p.rirLabel}`;
      pres.append(big, rest);
    }
    card.append(pres);

    const note = document.createElement('p');
    note.className = noteClass(p.note);
    note.textContent = p.note;
    card.append(note);

    if (load !== null) {
      const sets = document.createElement('div');
      sets.className = 'sets';
      for (let i = 0; i < p.sets; i++) {
        sets.append(setButton(ex.id, i, p.reps, entry?.sets[i]));
      }
      card.append(sets);
    }

    wrap.append(card);
  }

  const any = draft && Object.values(draft.entries).some((e) => e.sets.some(Boolean));
  $('close-session').classList.toggle('hidden', !any);
}

function openSheet(exId, index) {
  const { ex, p } = proposalsFor(selectedDay).find((x) => x.ex.id === exId);
  const draft = draftFor(selectedDay);
  const existing = draft?.entries[exId]?.sets[index];
  const prev = draft?.entries[exId]?.sets.filter(Boolean).slice(-1)[0];

  sheetCtx = {
    exId, index,
    reps: existing?.reps ?? p.reps,
    rir: existing?.rir ?? p.rir,
    pain: existing?.pain ?? prev?.pain ?? 0,
  };

  $('sheet-title').textContent = `${ex.name} · serie ${index + 1}`;
  $('sheet-sub').textContent = `Objetivo: ${p.reps} reps a RIR ${p.rirLabel}`;
  renderSheet();
  $('sheet').classList.remove('hidden');
}

function renderSheet() {
  $('reps-value').textContent = sheetCtx.reps;

  const rir = $('rir-chips');
  rir.innerHTML = '';
  for (let v = 0; v <= 5; v++) {
    const b = document.createElement('button');
    b.textContent = v === 5 ? '5+' : v;
    b.className = sheetCtx.rir === v ? 'sel' : '';
    b.onclick = () => { sheetCtx.rir = v; renderSheet(); };
    rir.append(b);
  }

  const pain = $('pain-chips');
  pain.innerHTML = '';
  for (let v = 0; v <= 10; v++) {
    const b = document.createElement('button');
    b.textContent = v;
    b.className = sheetCtx.pain === v ? (v > PAIN_STOP ? 'sel high' : 'sel') : '';
    b.onclick = () => { sheetCtx.pain = v; renderSheet(); };
    pain.append(b);
  }
}

function saveSet() {
  const draft = ensureDraft(selectedDay);
  const entry = draft.entries[sheetCtx.exId] ??= { load: null, sets: [] };
  if (entry.load === null) {
    const { p } = proposalsFor(selectedDay).find((x) => x.ex.id === sheetCtx.exId);
    entry.load = p.load;
  }
  entry.sets[sheetCtx.index] = { reps: sheetCtx.reps, rir: sheetCtx.rir, pain: sheetCtx.pain };
  save();
  closeSheet();
  render();
}

function closeSheet() {
  sheetCtx = null;
  $('sheet').classList.add('hidden');
}

function renderHistory() {
  const wrap = $('history');
  wrap.innerHTML = '';

  if (!state.sessions.length) {
    wrap.innerHTML = '<p class="empty">Todavía no has cerrado ninguna sesión.</p>';
    return;
  }

  for (const s of [...state.sessions].reverse()) {
    const card = document.createElement('div');
    card.className = 'card';
    const h = document.createElement('h3');
    h.textContent = `${DAYS[s.day].name.split(' — ')[0]} ${formatDate(s.date)}`;
    const sub = document.createElement('p');
    sub.className = 'hint';
    sub.style.margin = '0 0 8px';
    sub.textContent = `Semana ${s.week} · fase ${phaseFor(s.week)}`;
    card.append(h, sub);

    for (const e of s.entries) {
      const ex = findExercise(e.exerciseId);
      const row = document.createElement('div');
      row.className = 'hist-row';
      const left = document.createElement('span');
      left.textContent = ex.name;
      const right = document.createElement('span');
      right.className = 'when';
      const reps = e.sets.map((x) => x.reps).join('·');
      const maxPain = Math.max(...e.sets.map((x) => x.pain));
      right.textContent = ex.kind === 'pullup'
        ? `${reps} · dolor ${maxPain}`
        : `${e.load} ${ex.unit ?? 'kg'} · ${reps} · dolor ${maxPain}`;
      row.append(left, right);
      card.append(row);
    }
    wrap.append(card);
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
    lines.push(`**${DAYS[s.day].name.split(' — ')[0]} ${formatDate(s.date)}** — semana ${s.week}, fase ${phaseFor(s.week)}`);
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
  $('copy-hint').textContent = log
    ? `${log.count} sesión(es) sin pasar al doc.`
    : 'Todo al día con el doc.';
}

function render() {
  renderHeader();
  renderDaySwitch();
  renderRestDay();
  renderExercises();
  renderHistory();
  renderCopyHint();
}

$('reps-minus').onclick = () => { sheetCtx.reps = Math.max(0, sheetCtx.reps - 1); renderSheet(); };
$('reps-plus').onclick = () => { sheetCtx.reps += 1; renderSheet(); };
$('sheet-save').onclick = saveSet;
$('sheet-cancel').onclick = closeSheet;
$('copy-log').onclick = copyLog;

$('close-session').onclick = () => {
  const draft = draftFor(selectedDay);
  if (!draft) return;
  commitDraft(draft);
  save();
  render();
};

for (const tab of document.querySelectorAll('.tabs button')) {
  tab.onclick = () => {
    for (const t of document.querySelectorAll('.tabs button')) t.classList.toggle('active', t === tab);
    $('view-hoy').classList.toggle('hidden', tab.dataset.view !== 'hoy');
    $('view-historial').classList.toggle('hidden', tab.dataset.view !== 'historial');
  };
}

flushStaleDraft();
if (selectedDay === null) selectedDay = 1;
render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
