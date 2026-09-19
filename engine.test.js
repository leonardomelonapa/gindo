import test from 'node:test';
import assert from 'node:assert/strict';
import { propose, findExercise, weekFor, phaseFor, isDeload, planFor } from './engine.js';

const entry = (load, targetReps, sets, extra = {}) => ({
  exerciseId: 'x', load, targetReps, targetSets: sets.length, targetRir: 3,
  sets, block: 0, ...extra,
});
const clean = (reps, n = 4, rir = 3, pain = 2) =>
  Array.from({ length: n }, () => ({ reps, rir, pain }));

test('la semana se cuenta desde el lunes de arranque', () => {
  assert.equal(weekFor('2026-09-21'), 1);
  assert.equal(weekFor('2026-09-25'), 1);
  assert.equal(weekFor('2026-09-28'), 2);
  assert.equal(weekFor('2026-11-02'), 7);
});

test('las fases cambian en las semanas 5 y 11', () => {
  assert.deepEqual([1, 4, 5, 10, 11].map(phaseFor), [1, 1, 2, 2, 3]);
  assert.equal(isDeload(7), true);
  assert.equal(isDeload(6), false);
});

test('sin historial propone la carga de partida del plan', () => {
  const p = propose(findExercise('sentadilla'), null, 1);
  assert.equal(p.load, 65);
  assert.equal(p.reps, 6);
  assert.equal(p.sets, 4);
});

test('remo y face pulls arrancan pidiendo la carga', () => {
  assert.equal(propose(findExercise('remo-unilateral'), null, 1).needsLoad, true);
  assert.equal(propose(findExercise('sentadilla'), null, 1).needsLoad, false);
});

test('cerrar el objetivo sube una repeticion, no la carga', () => {
  const p = propose(findExercise('sentadilla'), entry(65, 6, clean(6)), 1);
  assert.equal(p.load, 65);
  assert.equal(p.reps, 7);
});

test('llegar al tope del rango sube 5 kg y reinicia repeticiones', () => {
  const p = propose(findExercise('sentadilla'), entry(65, 8, clean(8)), 1);
  assert.equal(p.load, 70);
  assert.equal(p.reps, 5);
});

test('no cerrar el objetivo mantiene carga y repeticiones', () => {
  const sets = clean(6);
  sets[3].reps = 4;
  const p = propose(findExercise('sentadilla'), entry(65, 6, sets), 1);
  assert.equal(p.load, 65);
  assert.equal(p.reps, 6);
});

test('quedarse por encima del RIR objetivo no da progresion', () => {
  const p = propose(findExercise('sentadilla'), entry(65, 6, clean(6, 4, 5)), 1);
  assert.equal(p.reps, 6);
  assert.equal(p.load, 65);
});

test('fase 1: el tren superior al tope del rango no sube carga', () => {
  const ex = findExercise('press-inclinado');
  const last = entry(15, 15, clean(15, 3), { targetRir: 3 });
  const p = propose(ex, last, 2);
  assert.equal(p.load, 15);
  assert.match(p.note, /Fase 1/);
});

test('fase 2: el mismo caso ya sube el escalon de la maquina', () => {
  const ex = findExercise('press-inclinado');
  const last = entry(15, 15, clean(15, 3), { targetRir: 3 });
  const p = propose(ex, last, 6);
  assert.equal(p.load, 17.5);
  assert.equal(p.reps, 10);
});

test('dolor sobre 3 frena la subida de carga en tren superior', () => {
  const ex = findExercise('press-inclinado');
  const last = entry(15, 15, clean(15, 3, 3, 4), { targetRir: 3 });
  const p = propose(ex, last, 6);
  assert.equal(p.load, 15);
  assert.match(p.note, /dolor/i);
});

test('dolor sobre 5 baja un 10% y bloquea la carga', () => {
  const ex = findExercise('sentadilla');
  const last = entry(65, 6, clean(6, 4, 3, 7));
  const p = propose(ex, last, 3);
  assert.equal(p.load, 55);
  assert.equal(p.block, 2);
});

test('el bloqueo solo baja con sesiones sin molestia', () => {
  const ex = findExercise('sentadilla');
  const conDolor = propose(ex, entry(60, 6, clean(6, 4, 3, 3), { block: 2 }), 3);
  assert.equal(conDolor.block, 2);
  assert.equal(conDolor.load, 60);

  const limpia = propose(ex, entry(60, 6, clean(6, 4, 3, 1), { block: 2 }), 3);
  assert.equal(limpia.block, 1);

  const segunda = propose(ex, entry(60, 6, clean(6, 4, 3, 0), { block: 1 }), 3);
  assert.equal(segunda.block, 0);
});

test('semana de descarga quita una serie y baja la carga', () => {
  const p = propose(findExercise('sentadilla'), entry(75, 8, clean(8)), 7);
  assert.equal(p.sets, 3);
  assert.equal(p.load, 65);
});

test('toda carga propuesta cae en un escalon cargable', () => {
  for (const id of ['sentadilla', 'press-inclinado', 'cruces', 'peso-muerto']) {
    const ex = findExercise(id);
    const dolor = propose(ex, entry(ex.startLoad, ex.repStart, clean(ex.repStart, 3, 3, 8)), 3);
    assert.equal(dolor.load % ex.step, 0, `${id} propone ${dolor.load}, no es multiplo de ${ex.step}`);
  }
});

test('las dominadas suben repeticiones hasta 12 y nunca lastre', () => {
  const ex = findExercise('dominadas');
  const subida = propose(ex, entry(0, 8, clean(8)), 2);
  assert.equal(subida.reps, 9);
  assert.equal(subida.load, 0);

  const tope = propose(ex, entry(0, 12, clean(12)), 8);
  assert.equal(tope.load, 0);
  assert.match(tope.note, /lastre/);
});

test('planFor devuelve los cuatro ejercicios del dia', () => {
  assert.equal(planFor([], 1, 1).length, 4);
  assert.equal(planFor([], 5, 1).length, 4);
});
