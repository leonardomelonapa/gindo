export const START_DATE = '2026-09-21';
export const DELOAD_WEEKS = [7];

export const PAIN_STOP = 5;
export const PAIN_TO_ADD_LOAD = 3;
export const PAIN_CLEAN = 1;
export const CLEAN_SESSIONS_TO_UNBLOCK = 2;

export const DAYS = {
  1: { key: 'lunes', name: 'Lunes — Sentadilla + empuje', venue: 'Workout' },
  5: { key: 'viernes', name: 'Viernes — Tracción + accesorios', venue: 'Centro rotativo' },
};

export const EXERCISES = [
  { id: 'sentadilla', name: 'Sentadilla con barra', day: 1, kind: 'lower',
    sets: 4, repStart: 6, repMin: 5, repMax: 8, step: 5, startLoad: 65, rest: 180,
    rirByPhase: [4, 3, 2], rirLabel: '4 → 2' },
  { id: 'press-inclinado', name: 'Press inclinado (Smith)', day: 1, kind: 'upper',
    sets: 3, repStart: 10, repMin: 10, repMax: 15, step: 2.5, startLoad: 15, unit: 'kg/lado', rest: 120,
    rirByPhase: [3, 3, 2], rirLabel: '3' },
  { id: 'cruces', name: 'Cruces de polea high-low', day: 1, kind: 'upper',
    sets: 3, repStart: 12, repMin: 10, repMax: 15, step: 5, startLoad: 20, unit: 'kg/lado', rest: 75,
    rirByPhase: [3, 3, 2], rirLabel: '2-3' },
  { id: 'elevaciones', name: 'Elevaciones laterales', day: 1, kind: 'upper',
    sets: 3, repStart: 12, repMin: 12, repMax: 15, step: 5, startLoad: 20, rest: 60,
    rirByPhase: [2, 2, 2], rirLabel: '2' },

  { id: 'peso-muerto', name: 'Peso muerto', day: 5, kind: 'lower',
    sets: 4, repStart: 6, repMin: 5, repMax: 8, step: 5, startLoad: 100, rest: 210,
    rirByPhase: [3, 3, 2], rirLabel: '3' },
  { id: 'remo-unilateral', name: 'Remo sentado unilateral', day: 5, kind: 'upper',
    sets: 3, repStart: 10, repMin: 10, repMax: 15, step: 5, startLoad: null, unit: 'kg/lado', rest: 90,
    rirByPhase: [3, 3, 2], rirLabel: '2-3' },
  { id: 'dominadas', name: 'Dominadas agarre neutro', day: 5, kind: 'pullup',
    sets: 4, repStart: 8, repMin: 8, repMax: 12, step: 0, startLoad: 0, rest: 150,
    rirByPhase: [3, 3, 2], rirLabel: '2-3' },
  { id: 'face-pulls', name: 'Face pulls o pájaros', day: 5, kind: 'upper',
    sets: 3, repStart: 15, repMin: 15, repMax: 15, step: 2.5, startLoad: null, rest: 60,
    rirByPhase: [2, 2, 2], rirLabel: '2' },
];

export function exercisesForDay(day) {
  return EXERCISES.filter((e) => e.day === day);
}

export function findExercise(id) {
  return EXERCISES.find((e) => e.id === id);
}

function toUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function weekFor(dateStr, startDate = START_DATE) {
  return Math.floor((toUTC(dateStr) - toUTC(startDate)) / 604800000) + 1;
}

export function phaseFor(week) {
  if (week <= 4) return 1;
  if (week <= 10) return 2;
  return 3;
}

export function isDeload(week) {
  return DELOAD_WEEKS.includes(week);
}

export function rirFor(exercise, week) {
  return exercise.rirByPhase[phaseFor(week) - 1];
}

function roundLoad(kg, step) {
  return Math.max(step, Math.floor(kg / step) * step);
}

function summarise(exercise, last) {
  const sets = last.sets.filter((s) => s.reps > 0);
  const target = last.targetReps;
  return {
    maxPain: Math.max(0, ...sets.map((s) => s.pain ?? 0)),
    hitTarget: sets.length >= last.targetSets && sets.every((s) => s.reps >= target),
    hardEnough: sets.every((s) => (s.rir ?? 99) <= last.targetRir),
  };
}

export function propose(exercise, last, week) {
  const rir = rirFor(exercise, week);
  const base = {
    exerciseId: exercise.id,
    sets: exercise.sets,
    rir,
    rirLabel: week <= 2 ? exercise.rirLabel : String(rir),
    unit: exercise.unit ?? 'kg',
    rest: exercise.rest,
  };

  if (!last) {
    return {
      ...base,
      load: exercise.startLoad,
      reps: exercise.repStart,
      block: 0,
      needsLoad: exercise.startLoad === null,
      tone: 'flat',
      note: 'Carga de partida del plan.',
    };
  }

  const { maxPain, hitTarget, hardEnough } = summarise(exercise, last);
  const hold = { ...base, load: last.load, reps: last.targetReps, block: last.block ?? 0 };

  if (maxPain > PAIN_STOP) {
    return {
      ...hold,
      load: exercise.step > 0 ? roundLoad(last.load * 0.9, exercise.step) : last.load,
      block: CLEAN_SESSIONS_TO_UNBLOCK,
      tone: 'bad',
      note: `Dolor ${maxPain}/10 la sesión pasada. Baja un 10% y no sube hasta ${CLEAN_SESSIONS_TO_UNBLOCK} sesiones sin molestia.`,
    };
  }

  if ((last.block ?? 0) > 0) {
    const block = maxPain <= PAIN_CLEAN ? last.block - 1 : last.block;
    return {
      ...hold,
      block,
      tone: block > 0 ? 'warn' : 'up',
      note: block > 0
        ? `Carga bloqueada por dolor. Faltan ${block} sesión(es) sin molestia para volver a subir.`
        : 'Bloqueo levantado: la próxima sesión ya puede subir.',
    };
  }

  if (isDeload(week)) {
    return {
      ...hold,
      sets: Math.max(2, exercise.sets - 1),
      load: exercise.step > 0 ? roundLoad(last.load * 0.9, exercise.step) : last.load,
      tone: 'warn',
      note: 'Semana de descarga: menos series y un 10% menos de carga.',
    };
  }

  if (!hitTarget || !hardEnough) {
    return { ...hold, tone: 'warn', note: 'Repite: la sesión pasada no cerraste el objetivo.' };
  }

  const upperBlockedByPhase = exercise.kind !== 'lower' && phaseFor(week) === 1;
  if (upperBlockedByPhase && last.targetReps >= exercise.repMax) {
    return { ...hold, tone: 'flat', note: 'Fase 1: el tren superior no sube carga. Mantén y acumula calidad.' };
  }

  if (last.targetReps < exercise.repMax) {
    return { ...hold, reps: last.targetReps + 1, tone: 'up', note: 'Objetivo cerrado. Sube una repetición.' };
  }

  if (exercise.kind === 'pullup') {
    return { ...hold, tone: 'flat', note: 'Ya estás en 4x12. Nada de lastre hasta 3 semanas con dolor 0-1.' };
  }

  if (exercise.kind === 'upper' && maxPain > PAIN_TO_ADD_LOAD) {
    return { ...hold, tone: 'warn', note: `Llegaste a ${exercise.repMax} pero el dolor fue ${maxPain}/10. No sube hasta que baje de ${PAIN_TO_ADD_LOAD}.` };
  }

  return {
    ...hold,
    load: last.load + exercise.step,
    reps: exercise.repMin,
    tone: 'up',
    note: `Objetivo cerrado a ${exercise.repMax} reps. Sube ${exercise.step} kg y vuelve a ${exercise.repMin}.`,
  };
}

export function lastEntryFor(sessions, exerciseId) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const entry = sessions[i].entries.find((e) => e.exerciseId === exerciseId);
    if (entry) return entry;
  }
  return null;
}

export function planFor(sessions, day, week) {
  return exercisesForDay(day).map((ex) =>
    propose(ex, lastEntryFor(sessions, ex.id), week)
  );
}
