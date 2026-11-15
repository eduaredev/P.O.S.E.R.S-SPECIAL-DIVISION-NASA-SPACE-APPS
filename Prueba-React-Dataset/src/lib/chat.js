// Asistente local: entiende preguntas en español sobre el dataset usando reglas (sin IA generativa, sin internet).
import { DATA, META, FUEL_ES, modeName, typicalParams, checkRange, applyFilters, EMPTY_FILTERS, rate, FUELS } from './data.js';
import { predict, levelOf, blocker, BLOCK_TEXT } from './model.js';

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const num = (s) => parseFloat(String(s).replace(',', '.'));

const FUEL_RX = [
  ['Ethylene', /\b(etileno|ethylene|eteno)\b/], ['Propane', /\b(propano|propane)\b/],
  ['Butane', /\b(butano|butane)\b/], ['Ethane', /\b(etano|ethane)\b/], ['Methane', /\b(metano|methane)\b/],
];

const GLOSSARY = [
  { rx: /psia|presion/, title: 'psia', text: 'Libras por pulgada cuadrada absolutas: la unidad de presión. 14.7 psia es una atmósfera, la presión normal de la ISS.' },
  { rx: /fraccion molar|x_o2|x_fuel|x_co2|porcentaje en volumen/, title: 'Fracción molar (X_O2, X_fuel...)', text: 'La parte de la mezcla de gas que corresponde a cada componente. Para gases equivale al porcentaje en volumen: X_O2 = 0.21 es aire, 0.35 es aire enriquecido con oxígeno.' },
  { rx: /llama inversa|inv_tp|inversa/, title: 'Llama inversa (INV_TP)', text: 'Aquí el oxígeno (mezcla 85 % O2 / 15 % N2) sale por el quemador hacia una cámara llena de combustible. Es lo contrario de la llama normal, donde el combustible sale hacia una cámara con aire.' },
  { rx: /llama normal|\btp\b|test point|punto de prueba/, title: 'Llama normal (TP, test point)', text: 'Un intento de ignición: el combustible sale por el quemador hacia una cámara con oxígeno y nitrógeno, y se activa el encendedor. El operador anota si hubo llama (Yes) o no (No).' },
  { rx: /mfc|controlador de flujo|quemador/, title: 'MFC y flujo del quemador', text: 'Los MFC son controladores de flujo másico. El dataset trae la lectura cruda (mfc_*_L) y los litros reales ya corregidos por el tipo de gas (*_burner_corr_L), que es lo que usa el modelo.' },
  { rx: /gcf|correccion de gas|factor de gas|hastings/, title: 'Factor de corrección de gas (GCF)', text: 'Un controlador de flujo se calibra con un gas (nitrógeno). Para otro gas hay que multiplicar su lectura por un factor. Ejemplo: butano/N2 30/70 usa 0.542. Se aplicó el mismo cálculo que hace el Excel de NASA.' },
  { rx: /sesion|session|tpid/, title: 'TPID y sesión', text: 'El TPID identifica cada punto de prueba (ej. 21301A1). Sus primeros 5 dígitos son año y día del año: 21301 = 28 de octubre de 2021. Esa fecha es la sesión.' },
  { rx: /ignicion|ignite|encendio/, title: 'Ignición (ignite)', text: 'Es la etiqueta que se predice: 1 si el operador marcó "Yes" en esa prueba. Es un criterio humano durante la operación, no una medición automática.' },
  { rx: /\bdp\b|dp_psia|aumento de presion/, title: 'dP_psia', text: 'Presión final menos inicial. Sube cuando entra gas y cuando hay combustión, por eso no distingue por sí sola si hubo ignición. No se usa como variable del modelo.' },
  { rx: /acme|psi-10|psi-159|nasa|iss|fuente/, title: 'ACME y PSI', text: 'ACME son experimentos de combustión en la Estación Espacial Internacional. PSI-10 y PSI-159 son dos bases de NASA con la bitácora de pruebas (hoja EventData de su calculadora de cámara).' },
  { rx: /validacion|cross|prob_cv|leave/, title: 'Validación por sesión', text: 'Cada día de pruebas se predice con un modelo entrenado sin ese día. La columna prob_cv guarda esa predicción honesta, no una memorizada.' },
  { rx: /estequiometria|reaccion|co2|h2o/, title: 'Reacción de combustión', text: 'Combustible + O2 produce CO2 + agua. Por ejemplo propano: C3H8 + 5 O2 → 3 CO2 + 4 H2O. El CO2 acumulado en la cámara viene de pruebas anteriores del mismo día.' },
];

const CHANGES = [
  'Se eliminaron 7 filas MFCA (chequeos de flujo: solo fluye N2, sin combustible). Eran todo el "metano" del dataset, por eso el metano ya no aparece.',
  'Los flujos del quemador se corrigieron por tipo de gas (GCF). Coinciden exactamente con los litros que calcula el Excel de NASA.',
  'El TPID 22305D3 tenía la fecha mal escrita; su sesión pasó a 22035.',
  'Se añadió X_H2O y la hora de inicio, y se quitó X_He (siempre 0).',
  'Valores negativos mínimos por ruido del sensor se llevaron a 0.',
];

/* ------------------------------------------------------------------ parseo */
export function parseQuery(raw) {
  const s = fold(raw);
  const out = { filters: { ...EMPTY_FILTERS }, fuels: [], inverse: null, found: false };
  FUEL_RX.forEach(([f, rx]) => { if (rx.test(s)) out.fuels.push(f); });
  if (/\b(inversa|inverso|inversas|inv)\b|inv_tp/.test(s)) out.inverse = 1;
  else if (/\b(normal|normales|directa)\b|(^|\s)tp(\s|$)/.test(s)) out.inverse = 0;
  const both = /inversa|inverso/.test(s) && /\bnormal/.test(s);
  if (both) out.inverse = null;

  if (/\bno\s+(se\s+)?(encend|prend|ignit)|sin\s+ignic|fallid|no\s+hubo\s+ignic|apagad/.test(s)) out.filters.result = 0;
  else if (/\bque\s+(si\s+)?(encend|prend|ignit)|encendidos|con\s+ignic/.test(s)) out.filters.result = 1;

  if (/psi-?159/.test(s)) out.filters.source = 'PSI-159';
  else if (/psi-?10\b/.test(s)) out.filters.source = 'PSI-10';

  let m;
  if ((m = s.match(/entre\s+(\d+(?:[.,]\d+)?)\s*(?:y|a)\s+(\d+(?:[.,]\d+)?)\s*psi/))) {
    out.filters.pMin = num(m[1]); out.filters.pMax = num(m[2]);
  } else if ((m = s.match(/(?:mas de|mayor(?:es)?(?: a| que)?|>|arriba de|por encima de|superior(?:es)? a)\s*(\d+(?:[.,]\d+)?)\s*psi/))) {
    out.filters.pMin = num(m[1]);
  } else if ((m = s.match(/(?:menos de|menor(?:es)?(?: a| que)?|<|abajo de|por debajo de|inferior(?:es)? a)\s*(\d+(?:[.,]\d+)?)\s*psi/))) {
    out.filters.pMax = num(m[1]);
  } else if ((m = s.match(/(\d+(?:[.,]\d+)?)\s*psi/))) {
    out.filters.pMin = num(m[1]) - 0.7; out.filters.pMax = num(m[1]) + 0.7;
    out.pExact = num(m[1]);
  }

  const o2rx = /(?:(mas de|mayor(?:es)?(?: a| que)?|>|menos de|menor(?:es)?(?: a| que)?|<)\s*)?(\d+(?:[.,]\d+)?)\s*%\s*(?:de\s+)?(?:o2|oxigeno)|(?:o2|oxigeno)\s*(?:de|al|=|en|a)?\s*(mas de|mayor(?:es)?(?: a| que)?|>|menos de|menor(?:es)?(?: a| que)?|<)?\s*(\d+(?:[.,]\d+)?)\s*%/;
  if ((m = s.match(o2rx))) {
    const cmp = m[1] || m[3] || '';
    const v = num(m[2] || m[4]) / 100;
    out.o2 = v;
    if (/mas|mayor|>/.test(cmp)) out.filters.o2Min = v;
    else if (/menos|menor|</.test(cmp)) out.filters.o2Max = v;
    else { out.filters.o2Min = v - 0.015; out.filters.o2Max = v + 0.015; }
  }
  if (out.fuels.length === 1) out.filters.fuel = out.fuels[0];
  if (out.inverse != null) out.filters.mode = out.inverse;
  out.found = !!(out.filters.fuel || out.filters.mode !== '' || out.filters.result !== '' || out.filters.source ||
    out.filters.pMin != null || out.filters.pMax != null || out.filters.o2Min != null || out.filters.o2Max != null);
  return out;
}

function describe(f) {
  const bits = [];
  if (f.fuel) bits.push(FUEL_ES[f.fuel].toLowerCase());
  if (f.mode !== '' && f.mode != null) bits.push(modeName(Number(f.mode)).toLowerCase());
  if (f.source) bits.push(f.source);
  if (f.result !== '' && f.result != null) bits.push(f.result ? 'que encendieron' : 'que no encendieron');
  if (f.pMin != null && f.pMax != null) bits.push(`${f.pMin.toFixed(1)} a ${f.pMax.toFixed(1)} psia`);
  else if (f.pMin != null) bits.push(`más de ${f.pMin} psia`);
  else if (f.pMax != null) bits.push(`menos de ${f.pMax} psia`);
  if (f.o2Min != null && f.o2Max != null) bits.push(`O2 cerca de ${(((f.o2Min + f.o2Max) / 2) * 100).toFixed(0)}%`);
  else if (f.o2Min != null) bits.push(`O2 sobre ${(f.o2Min * 100).toFixed(0)}%`);
  else if (f.o2Max != null) bits.push(`O2 bajo ${(f.o2Max * 100).toFixed(0)}%`);
  return bits.join(', ') || 'todo el dataset';
}

const rowLine = (r) => ({
  id: r.id, tpid: r.tpid, text: `${FUEL_ES[r.fuel]}, ${modeName(r.is_inverse).toLowerCase()}, ${r.P_psia.toFixed(1)} psia, ${r.ignite ? 'encendió' : 'no encendió'}`,
});

/* ------------------------------------------------------------- respuestas */
export const SUGGESTIONS = [
  '¿Qué tasa de ignición tiene el propano en llama inversa?',
  'Muéstrame pruebas con más de 25 psia que no encendieron',
  'Compara butano y etano',
  'Predice butano en llama normal a 14.7 psia con 35% de oxígeno',
  '¿Qué es la llama inversa?',
  '¿Qué cambió en el dataset?',
  '¿Qué tan confiable es el modelo?',
];

export function answer(raw) {
  const text = raw.trim();
  const s = fold(text);
  if (!s) return { blocks: [{ t: 'p', text: 'Escribe una pregunta o prueba una de las sugerencias.' }] };
  const q = parseQuery(text);

  // 1) un TPID concreto
  const tp = s.match(/\b(\d{5}[a-z]\d*[a-z0-9_-]*)\b/);
  if (tp) {
    const r = DATA.find((d) => fold(d.tpid) === tp[1]);
    if (r) {
      return { blocks: [
        { t: 'p', text: `El punto ${r.tpid} (${r.date}) fue ${FUEL_ES[r.fuel].toLowerCase()} en ${modeName(r.is_inverse).toLowerCase()} a ${r.P_psia} psia. ${r.ignite ? 'Sí encendió' : 'No encendió'}; el modelo, sin haber visto ese día, estimó ${pct(r.prob_cv, 0)}.` },
        { t: 'actions', items: [{ label: 'Cargar en el simulador', action: 'load', row: r.id }, { label: 'Ver en la tabla', action: 'filters', filters: { ...EMPTY_FILTERS, q: r.tpid } }] },
      ] };
    }
  }

  // 2) saludo / ayuda
  if (/^(hola|buenas|hey|ayuda|help|que puedes)/.test(s)) {
    return { blocks: [{ t: 'p', text: 'Puedo contar y filtrar pruebas, comparar combustibles, explicar términos, estimar la probabilidad de ignición de un escenario y resumir qué se limpió del dataset.' }, { t: 'suggest' }] };
  }

  // 3) cambios del dataset
  if (/cambi|elimin|limpi|mfca|corrig|version|que se hizo|metano/.test(s) && !/predic|probabilidad/.test(s)) {
    const blocks = [{ t: 'p', text: 'Cambios respecto al dataset original:' }, { t: 'list', items: CHANGES }];
    if (q.fuels.includes('Methane')) blocks.unshift({ t: 'p', text: 'No hay metano porque las únicas 3 filas eran chequeos de flujo, no intentos de ignición.' });
    return { blocks };
  }

  // 4) calidad del modelo
  if (/precision|auc|confiab|que tan bueno|exactitud|acierta|validacion del modelo|funciona el modelo/.test(s)) {
    const c = META.cv;
    return { blocks: [
      { t: 'stat', big: c['PSI-159'].auc.toFixed(2), label: 'AUC en PSI-159', sub: `exactitud ${pct(c['PSI-159'].accuracy, 0)} frente a ${pct(c['PSI-159'].majority_baseline, 0)} de adivinar siempre "enciende"` },
      { t: 'p', text: `Validación ${c.method}: cada día se predice sin haberlo visto. En PSI-10 casi todo enciende (${pct(c['PSI-10'].ignite_rate, 0)}), por eso el AUC global (${c.all.auc.toFixed(2)}) se ve mejor de lo que es. Úsalo como alerta de apoyo, no como garantía.` },
    ] };
  }

  // 5) glosario
  if (/que (es|son|significa|quiere decir)|explica|definicion|como se calcula|para que sirve/.test(s)) {
    const g = GLOSSARY.find((x) => x.rx.test(s));
    if (g) return { blocks: [{ t: 'term', title: g.title, text: g.text }] };
  }

  // 6) predicción
  if (/predic|probabilidad de|riesgo|encendera|que pasa si|simula|estima/.test(s) && q.fuels.length >= 1) {
    const fuel = q.fuels[0];
    const inv = q.inverse ?? 0;
    if (fuel === 'Methane') return { blocks: [{ t: 'p', text: 'No hay pruebas reales de metano en el dataset limpio, así que no puedo estimarlo. Elige etileno, propano, butano o etano.' }] };
    const p = typicalParams(fuel, inv, !inv && q.o2 != null ? { O2: q.o2 } : null);
    const notes = [];
    if (q.pExact != null) p.P = q.pExact;
    if (q.o2 != null) {
      if (inv) notes.push('En llama inversa el O2 entra por el quemador, así que ignoré el % de O2 de la cámara.');
      else p.O2 = q.o2;
    }
    const chk = checkRange(p);
    if (!blocker(p) && (chk.noData || chk.out.length)) {
      const why = chk.noData ? chk.message : chk.out.map((o) => `${o.label} fuera de lo ensayado`).join('; ') + '.';
      return { blocks: [
        { t: 'p', text: `No doy un porcentaje para ese escenario: ${why} Sin pruebas reales parecidas el modelo no puede estimar, y una cifra sería engañosa.` },
        { t: 'actions', items: [{ label: 'Verlo en el simulador', action: 'loadParams', params: p }] },
      ] };
    }
    const prob = predict(p);
    const lv = levelOf(prob);
    if (blocker(p)) notes.push(BLOCK_TEXT[blocker(p)]);
    return { blocks: [
      { t: 'stat', big: pct(prob, 0), label: `probabilidad de ignición, riesgo ${lv.label.toLowerCase()}`, sub: `${FUEL_ES[fuel]}, ${modeName(inv).toLowerCase()}, ${p.P.toFixed(1)} psia${inv ? '' : `, O2 ${(p.O2 * 100).toFixed(0)}%`}. Resto de valores: típicos de los ensayos reales.` },
      ...notes.map((n) => ({ t: 'p', text: n })),
      { t: 'actions', items: [{ label: 'Ajustar en el simulador', action: 'loadParams', params: p }] },
    ] };
  }

  // 7) comparación
  if (/compar|versus|\bvs\b|contra|diferencia/.test(s) && (q.fuels.length >= 2 || q.fuels.length === 1 || q.inverse == null)) {
    const list = q.fuels.length >= 2 ? q.fuels : FUELS;
    const rows = list.map((f) => {
      const a = DATA.filter((r) => r.fuel === f && r.is_inverse === 0);
      const b = DATA.filter((r) => r.fuel === f && r.is_inverse === 1);
      const cell = (x) => (x.length ? `${pct(rate(x), 0)} de ${x.length}` : 'sin datos');
      return [FUEL_ES[f], cell(a), cell(b)];
    });
    return { blocks: [{ t: 'p', text: 'Tasa de ignición por combustible y tipo de llama:' }, { t: 'table', head: ['Combustible', 'Llama normal', 'Llama inversa'], rows }] };
  }

  // 8) conteos y búsquedas
  const wantsCount = /cuant|tasa|porcentaje|proporcion|promedio|how many|total/.test(s);
  const wantsList = /muestra|muestrame|lista|busca|encuentra|dame|ensena|ver |pruebas|experimentos|puntos/.test(s);
  if (q.found || wantsCount || wantsList) {
    if (/por combustible/.test(s)) {
      const rows = FUELS.map((f) => { const x = applyFilters(DATA, { ...q.filters, fuel: f }); return [FUEL_ES[f], String(x.length), x.length ? pct(rate(x), 0) : '-']; });
      return { blocks: [{ t: 'table', head: ['Combustible', 'Pruebas', 'Encendió'], rows }] };
    }
    const sub = applyFilters(DATA, q.filters);
    if (!sub.length) return { blocks: [{ t: 'p', text: `No hay pruebas con ${describe(q.filters)}. Prueba con un rango más amplio.` }] };
    const ign = sub.filter((r) => r.ignite).length;
    const byResult = q.filters.result !== '' && q.filters.result != null;   // la tasa sería 0 % o 100 % por definición
    const blocks = [byResult
      ? { t: 'stat', big: String(sub.length), label: 'pruebas encontradas', sub: describe(q.filters) }
      : { t: 'stat', big: pct(rate(sub), 0), label: 'tasa de ignición', sub: `${ign} de ${sub.length} pruebas: ${describe(q.filters)}` }];
    if (wantsList || sub.length <= 6) {
      const sample = [...sub].sort((a, b) => Math.abs(b.prob_cv - 0.5) - Math.abs(a.prob_cv - 0.5)).slice(0, 5);
      blocks.push({ t: 'rows', rows: sample.map(rowLine) });
    }
    blocks.push({ t: 'actions', items: [{ label: `Ver las ${sub.length} en la tabla`, action: 'filters', filters: q.filters }] });
    return { blocks };
  }

  // 9) texto libre como búsqueda
  const hits = DATA.filter((r) => fold(text).split(/\s+/).filter((w) => w.length > 2).every((w) => r.hay.includes(w)));
  if (hits.length && hits.length < DATA.length) {
    return { blocks: [{ t: 'p', text: `Encontré ${hits.length} pruebas que contienen "${text}".` }, { t: 'rows', rows: hits.slice(0, 5).map(rowLine) },
      { t: 'actions', items: [{ label: 'Ver en la tabla', action: 'filters', filters: { ...EMPTY_FILTERS, q: text } }] }] };
  }
  return { blocks: [{ t: 'p', text: 'No entendí esa pregunta. Puedo filtrar pruebas ("propano inversa más de 25 psia"), comparar combustibles, explicar términos o estimar un escenario.' }, { t: 'suggest' }] };
}
