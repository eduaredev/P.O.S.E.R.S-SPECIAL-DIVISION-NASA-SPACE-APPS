import rows from '../data/dataset.json';
import meta from '../data/meta.json';

export const META = meta;
export const FUEL_ES = { Ethylene: 'Etileno', Propane: 'Propano', Butane: 'Butano', Ethane: 'Etano', Methane: 'Metano' };
export const FUELS = meta.fuels;
export const modeName = (inv) => (inv ? 'Llama inversa' : 'Llama normal');

/**
 * Variables que el usuario puede mover. `scale` convierte a lo que se muestra (fracción -> %).
 * Los topes van más allá de lo ensayado a propósito, para explorar la tendencia del modelo;
 * lo que NASA probó de verdad está en META.ranges y se marca con una franja bajo cada slider.
 * `modes` = en qué tipo de llama la variable existe de verdad (0 normal, 1 inversa).
 * Llama normal: la cámara tiene aire (O2 + N2) y el combustible sale por el quemador.
 * Llama inversa: la cámara tiene combustible + N2 y el O2 sale por el quemador.
 * Lo que no aplica a un modo vale 0 en todas sus pruebas reales.
 */
export const VARS = [
  { key: 'P', row: 'P_psia', label: 'Presión inicial', unit: 'psia', min: 1, max: 100, step: 0.1, scale: 1, dec: 1, modes: [0, 1] },
  { key: 'O2', row: 'X_O2', label: 'O2 en cámara', unit: '%', min: 0, max: 1, step: 0.005, scale: 100, dec: 1, modes: [0] },
  { key: 'CO2', row: 'X_CO2', label: 'CO2 en cámara', unit: '%', min: 0, max: 0.15, step: 0.0005, scale: 100, dec: 2, modes: [0, 1] },
  { key: 'Xfuel', row: 'X_fuel', label: 'Combustible en cámara', unit: '%', min: 0, max: 1, step: 0.005, scale: 100, dec: 1, modes: [1] },
  { key: 'o2L', row: 'O2_burner_corr_L', label: 'O2 del quemador', unit: 'L', min: 0, max: 5, step: 0.005, scale: 1, dec: 3, modes: [1] },
  { key: 'n2L', row: 'N2_burner_corr_L', label: 'N2 del quemador', unit: 'L', min: 0, max: 8, step: 0.01, scale: 1, dec: 2, modes: [0, 1] },
  { key: 'fuelL', row: 'fuel_burner_corr_L', label: 'Combustible del quemador', unit: 'L', min: 0, max: 1, step: 0.001, scale: 1, dec: 3, modes: [0] },
];
export const VAR = Object.fromEntries(VARS.map((v) => [v.key, v]));
export const varsFor = (inverse) => VARS.filter((v) => v.modes.includes(inverse ? 1 : 0));
export const fmt = (key, value) => {
  const v = VAR[key];
  return `${(value * v.scale).toFixed(v.dec)} ${v.unit}`;
};

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Filas con texto precomputado para el buscador. */
export const DATA = rows.map((r, i) => ({
  ...r,
  id: i,
  date: r.t_start.slice(0, 10),
  hay: fold(
    [r.tpid, r.session, r.source, r.t_start, r.fuel, FUEL_ES[r.fuel], r.fuel_config, r.op, modeName(r.is_inverse),
      r.ignite ? 'encendio ignicion si' : 'no encendio sin ignicion no', r.cambio].join(' '),
  ),
}));

/** Rango real de cada variable por tipo de llama (índice 0 normal, 1 inversa). */
export const MODE_RANGES = [0, 1].map((m) => Object.fromEntries(VARS.map((v) => {
  const vals = DATA.filter((r) => r.is_inverse === m).map((r) => r[v.row]);
  return [v.key, [Math.min(...vals), Math.max(...vals)]];
})));

export const SESSIONS = (() => {
  const map = new Map();
  DATA.forEach((r) => {
    if (!map.has(r.session)) map.set(r.session, []);
    map.get(r.session).push(r);
  });
  return [...map.entries()]
    .map(([session, list]) => {
      list.sort((a, b) => a.t_start.localeCompare(b.t_start));
      const first = list[0];
      return {
        session, rows: list, date: first.date, fuel: first.fuel, inverse: first.is_inverse,
        label: `${first.date}  ${FUEL_ES[first.fuel]}, ${first.is_inverse ? 'inversa' : 'normal'} (${list.length})`,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
})();

export const rowToParams = (r) => ({
  fuel: r.fuel, inverse: r.is_inverse,
  P: r.P_psia, O2: r.X_O2, CO2: r.X_CO2, Xfuel: r.X_fuel,
  o2L: r.O2_burner_corr_L, n2L: r.N2_burner_corr_L, fuelL: r.fuel_burner_corr_L,
});

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Valores típicos (mediana) de los ensayos reales de ese combustible y modo.
 * Con `near.O2` usa solo pruebas con O2 parecido, para que el resto de valores sea coherente con ese O2.
 */
export function typicalParams(fuel, inverse, near = null) {
  let pool = DATA.filter((r) => r.fuel === fuel && r.is_inverse === inverse);
  if (!pool.length) pool = DATA.filter((r) => r.is_inverse === inverse);
  if (near && near.O2 != null) {
    const sub = pool.filter((r) => Math.abs(r.X_O2 - near.O2) < 0.04);
    if (sub.length >= 5) pool = sub;
  }
  const p = { fuel, inverse };
  VARS.forEach((v) => { p[v.key] = v.modes.includes(inverse) ? median(pool.map((r) => r[v.row])) : 0; });
  return p;
}

/** Lleva cada variable al rango realmente ensayado (por combustible y llama; si no hay, por llama). */
export function clampToTested(p) {
  const combo = META.ranges[comboKey(p.fuel, p.inverse)];
  const q = { ...p };
  varsFor(p.inverse).forEach((v) => {
    const [lo, hi] = combo ? combo[v.row] : MODE_RANGES[p.inverse ? 1 : 0][v.key];
    q[v.key] = Math.min(hi, Math.max(lo, p[v.key]));
  });
  return q;
}

export const comboKey = (fuel, inverse) => `${fuel}|${inverse}`;

/** Compara el escenario con lo realmente ensayado. */
export function checkRange(p) {
  const rng = META.ranges[comboKey(p.fuel, p.inverse)];
  if (!rng) {
    return { noData: true, out: [], message: `NASA no ensayó ${FUEL_ES[p.fuel].toLowerCase()} en ${modeName(p.inverse).toLowerCase()}: el resultado es una extrapolación.` };
  }
  const out = [];
  varsFor(p.inverse).forEach((v) => {
    const [lo, hi] = rng[v.row];
    const tol = Math.max((hi - lo) * 0.08, v.key === 'P' ? 0.5 : 1e-6);
    const x = p[v.key];
    if (x < lo - tol || x > hi + tol) out.push({ key: v.key, label: v.label, value: x, lo, hi });
  });
  return { noData: false, out, range: rng };
}

/* ---- parecido con pruebas reales (detecta combinaciones que nunca se ensayaron) ---- */
const spanOf = (list, v) => {
  const vals = list.map((r) => r[v.row]);
  return Math.max(Math.max(...vals) - Math.min(...vals), (v.max - v.min) * 0.02);
};
const comboRows = (fuel, inverse) => DATA.filter((r) => r.fuel === fuel && r.is_inverse === inverse);
const dist = (a, b, spans, vars) => Math.sqrt(vars.reduce((s, v, k) => s + ((a[v.key] - b[v.key]) / spans[k]) ** 2, 0) / vars.length);
const asParams = (r) => ({ P: r.P_psia, O2: r.X_O2, CO2: r.X_CO2, Xfuel: r.X_fuel, o2L: r.O2_burner_corr_L, n2L: r.N2_burner_corr_L, fuelL: r.fuel_burner_corr_L });
const cache = new Map();
function prep(fuel, inverse) {
  const key = comboKey(fuel, inverse);
  if (cache.has(key)) return cache.get(key);
  const list = comboRows(fuel, inverse);
  if (!list.length) { cache.set(key, null); return null; }
  const vars = varsFor(inverse);
  const spans = vars.map((v) => spanOf(list, v));
  const ps = list.map(asParams);
  // umbral = percentil 95 de la distancia de cada prueba real a su vecina más cercana
  const loo = ps.map((a, i) => Math.min(...ps.map((b, j) => (i === j ? Infinity : dist(a, b, spans, vars))))).filter(Number.isFinite).sort((x, y) => x - y);
  const out = { list, spans, vars, ps, limit: loo.length ? loo[Math.floor(loo.length * 0.95)] : Infinity };
  cache.set(key, out);
  return out;
}

/** Las k pruebas reales más parecidas (mismo combustible y tipo de llama) y si el escenario es atípico. */
export function nearest(p, k = 3) {
  const c = prep(p.fuel, p.inverse);
  if (!c) return { rows: [], far: true, limit: 0 };
  const ranked = c.list.map((r, i) => ({ r, d: dist(p, c.ps[i], c.spans, c.vars) })).sort((a, b) => a.d - b.d).slice(0, k);
  return { rows: ranked, far: ranked[0].d > c.limit * 1.15, limit: c.limit };
}

export function applyFilters(list, f) {
  const toks = fold(f.q || '').split(/\s+/).filter(Boolean);
  return list.filter((r) => {
    if (f.fuel && r.fuel !== f.fuel) return false;
    if (f.mode !== '' && f.mode != null && r.is_inverse !== Number(f.mode)) return false;
    if (f.source && r.source !== f.source) return false;
    if (f.result !== '' && f.result != null && r.ignite !== Number(f.result)) return false;
    if (f.pMin != null && r.P_psia < f.pMin) return false;
    if (f.pMax != null && r.P_psia > f.pMax) return false;
    if (f.o2Min != null && r.X_O2 < f.o2Min) return false;
    if (f.o2Max != null && r.X_O2 > f.o2Max) return false;
    return toks.every((t) => r.hay.includes(t));
  });
}
export const EMPTY_FILTERS = { q: '', fuel: '', mode: '', source: '', result: '', pMin: null, pMax: null, o2Min: null, o2Max: null };

export const rate = (list) => (list.length ? list.filter((r) => r.ignite).length / list.length : 0);

export function toCSV(list) {
  const cols = ['source', 'tpid', 'session', 't_start', 'op', 'fuel', 'fuel_config', 'P_psia', 'dP_psia', 'X_O2', 'X_N2', 'X_CO2',
    'X_H2O', 'X_fuel', 'mfc_O2_L', 'mfc_N2_L', 'mfc_fuel_L', 'O2_burner_corr_L', 'N2_burner_corr_L', 'fuel_burner_corr_L',
    'ignite', 'prob_cv', 'cambio'];
  const esc = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  return [cols.join(','), ...list.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
