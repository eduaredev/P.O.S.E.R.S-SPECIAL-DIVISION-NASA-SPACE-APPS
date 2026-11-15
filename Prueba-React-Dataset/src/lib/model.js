import modelJson from '../data/model.json';
import { predictProb } from './modelCore.js';
import { VAR, VARS, varsFor } from './data.js';

/**
 * Reglas físicas que se aplican ANTES del modelo. Sin combustible o sin oxidante no puede haber llama,
 * pero una regresión logística nunca llega a 0 % por sí sola.
 * Umbrales validados con los datos: bloquean 5 pruebas reales y ninguna encendió; lo mínimo que sí encendió
 * (combustible quemador 0.0015 L, O2 cámara 19 %, combustible cámara 5.6 %, O2 quemador 0.027 L) queda muy por encima.
 * En llama normal el combustible entra por el quemador y en la inversa está en la cámara; por eso se miran ambos.
 */
export const GUARD = { fuelL: 0.0005, Xfuel: 0.005, O2: 0.05, o2L: 0.001 };

/** Devuelve 'fuel' | 'oxidizer' si una regla física impide la ignición, o null si el modelo puede opinar. */
export function blocker(p) {
  if (p.inverse) {
    if (p.Xfuel <= GUARD.Xfuel) return 'fuel';
    if (p.o2L <= GUARD.o2L) return 'oxidizer';
  } else {
    if (p.fuelL <= GUARD.fuelL) return 'fuel';
    if (p.O2 <= GUARD.O2) return 'oxidizer';
  }
  return null;
}
export const BLOCK_TEXT = {
  fuel: 'Sin combustible no puede haber llama. Aplica la regla física: el modelo no se usó.',
  oxidizer: 'Sin oxígeno suficiente no puede haber llama. Aplica la regla física: el modelo no se usó.',
};

/**
 * Lo que no aplica al tipo de llama vale 0, como en todas las pruebas reales de ese modo
 * (en llama normal no hay combustible en cámara; en la inversa no hay O2 en cámara ni combustible en el quemador).
 * Los demás valores pasan tal cual, también fuera de lo ensayado: la app sirve para explorar la tendencia del modelo.
 */
export function toModelInput(p) {
  const m = p.inverse ? 1 : 0;
  const q = { ...p };
  VARS.forEach((v) => { if (!v.modes.includes(m)) q[v.key] = 0; });
  return q;
}

export const predict = (p) => (blocker(p) ? 0 : predictProb(modelJson, toModelInput(p)));

/** Niveles de riesgo. Cada uno lleva forma + texto, nunca solo color. */
export const LEVELS = [
  { id: 'low', label: 'Bajo', max: 0.25, color: 'var(--good)', shape: 'circle' },
  { id: 'mid', label: 'Moderado', max: 0.5, color: 'var(--warn)', shape: 'diamond' },
  { id: 'high', label: 'Alto', max: 0.75, color: 'var(--serious)', shape: 'triangle' },
  { id: 'crit', label: 'Crítico', max: 1.01, color: 'var(--crit)', shape: 'square' },
];
export const levelOf = (p) => LEVELS.find((l) => p < l.max);

/** Palancas de prevención: qué cambio de un solo parámetro baja más la probabilidad. */
export function levers(p, base) {
  const tries = [
    { id: 'P', label: 'Bajar la presión 25 %', ok: p.P > 6, apply: (q) => { q.P = Math.max(VAR.P.min, p.P * 0.75); } },
    { id: 'O2', label: 'Bajar 3 puntos el O2 de la cámara', ok: p.O2 > 0.05, apply: (q) => { q.O2 = Math.max(0, p.O2 - 0.03); } },
    { id: 'CO2', label: 'Subir 1 punto el CO2 de la cámara', ok: true, apply: (q) => { q.CO2 = Math.min(VAR.CO2.max, p.CO2 + 0.01); } },
    { id: 'Xfuel', label: 'Reducir 30 % el combustible en cámara', ok: p.Xfuel > 0.01, apply: (q) => { q.Xfuel = p.Xfuel * 0.7; } },
    { id: 'o2L', label: 'Reducir 30 % el O2 del quemador', ok: p.o2L > 0.01, apply: (q) => { q.o2L = p.o2L * 0.7; } },
    { id: 'fuelL', label: 'Reducir 30 % el combustible del quemador', ok: p.fuelL > 0.002, apply: (q) => { q.fuelL = p.fuelL * 0.7; } },
    { id: 'n2L', label: 'Subir 50 % el N2 del quemador', ok: p.n2L > 0.01, apply: (q) => { q.n2L = p.n2L * 1.5; } },
  ];
  const valid = varsFor(p.inverse).map((v) => v.key);
  return tries
    .filter((t) => t.ok && valid.includes(t.id))
    .map((t) => {
      const q = { ...p };
      t.apply(q);
      const prob = predict(q);
      return { id: t.id, label: t.label, prob, delta: prob - base };
    })
    .sort((a, b) => a.delta - b.delta);
}
