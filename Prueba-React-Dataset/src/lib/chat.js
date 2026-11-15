// Asistente local: entiende preguntas en español con reglas y responde llamando a las herramientas de tools.js
// (el mismo código que usa el resto de la app). Sin IA generativa ni internet: no puede inventar números.
import { DATA, FUEL_ES, modeName, EMPTY_FILTERS, FUELS, fmt } from './data.js';
import { levelOf, levers } from './model.js';
import { runTool } from './tools.js';

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const num = (s) => parseFloat(String(s).replace(',', '.'));
const N = '(\\d+(?:[.,]\\d+)?)';

const FUEL_RX = [
  ['Ethylene', /\b(etileno|ethylene|eteno|c2h4)\b/], ['Propane', /\b(propano|propane|c3h8|gas lp)\b/],
  ['Butane', /\b(butano|butane|c4h10)\b/], ['Ethane', /\b(etano|ethane|c2h6)\b/], ['Methane', /\b(metano|methane|ch4)\b/],
];
const FUEL_WORD = '(?:combustible|etileno|eteno|propano|butano|etano)';

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
  { rx: /extrapol|fuera de lo ensayado|fuera de rango/, title: 'Extrapolación', text: 'Es pedirle al modelo un escenario que NASA nunca probó. La app igual da el porcentaje, porque sirve para ver la tendencia del modelo, pero ese número no está respaldado por pruebas reales.' },
  { rx: /regresion logistica|modelo|logistic/, title: 'Regresión logística', text: 'El modelo suma el efecto de cada variable y lo convierte en una probabilidad entre 0 y 1. Por eso la probabilidad cambia de forma continua al mover un control y sigue una tendencia fuera de lo ensayado. Los litros del quemador entran en escala logarítmica: los primeros mililitros importan más que los últimos.' },
  { rx: /acme|psi-10|psi-159|nasa|iss|fuente/, title: 'ACME y PSI', text: 'ACME son experimentos de combustión en la Estación Espacial Internacional. PSI-10 y PSI-159 son dos bases de NASA con la bitácora de pruebas (hoja EventData de su calculadora de cámara).' },
  { rx: /validacion|cross|prob_cv|leave/, title: 'Validación por sesión', text: 'Cada día de pruebas se predice con un modelo entrenado sin ese día. La columna prob_cv guarda esa predicción honesta, no una memorizada.' },
  { rx: /estequiometria|reaccion|co2|h2o/, title: 'Reacción de combustión', text: 'Combustible + O2 produce CO2 + agua. Por ejemplo propano: C3H8 + 5 O2 → 3 CO2 + 4 H2O. El CO2 acumulado en la cámara viene de pruebas anteriores del mismo día.' },
];

const CHANGES = [
  'Se agregaron las pruebas de PSI-10 de 2019 (otra calculadora de cámara de NASA): son las únicas de etileno en llama normal.',
  'Se eliminaron las filas MFCA (chequeos de flujo: solo fluye N2, sin combustible). Eran todo el "metano" del dataset, por eso el metano ya no aparece.',
  'Los flujos del quemador se corrigieron por tipo de gas (GCF). Coinciden exactamente con los litros que calcula el Excel de NASA.',
  'El TPID 22305D3 tenía la fecha mal escrita; su sesión pasó a 22035.',
  'Se añadió X_H2O y la hora de inicio, y se quitó X_He (siempre 0).',
  'Valores negativos mínimos por ruido del sensor se llevaron a 0.',
];

const LABEL = {
  is_inverse: 'Llama inversa', P_psia: 'Presión', X_CO2: 'CO2 en cámara', N2_burner_corr_L: 'N2 del quemador', fuel: 'Tipo de combustible',
  chorro_O2eq_L: 'Chorro del quemador (combustible en normal, O2 en inversa)',
  reactivo_camara: 'Reactivo en cámara (O2 en normal, combustible en inversa)',
};

/* ------------------------------------------------------------------ parseo */
export function parseQuery(raw) {
  const s = fold(raw);
  const out = { filters: { ...EMPTY_FILTERS }, fuels: [], inverse: null, found: false, set: {} };
  FUEL_RX.forEach(([f, rx]) => { if (rx.test(s)) out.fuels.push(f); });
  if (/\b(inversa|inverso|inversas|inv)\b|inv_tp/.test(s)) out.inverse = 1;
  else if (/\b(normal|normales|directa)\b|(^|\s)tp(\s|$)/.test(s)) out.inverse = 0;
  if (/inversa|inverso/.test(s) && /\bnormal/.test(s)) out.inverse = null;

  if (/\bno\s+(se\s+)?(encend|prend|ignit)|sin\s+ignic|fallid|no\s+hubo\s+ignic|apagad/.test(s)) out.filters.result = 0;
  else if (/\bque\s+(si\s+)?(encend|prend|ignit)|encendidos|con\s+ignic/.test(s)) out.filters.result = 1;

  if (/psi-?159/.test(s)) out.filters.source = 'PSI-159';
  else if (/psi-?10\b/.test(s)) out.filters.source = 'PSI-10';

  // Presión: psia, atm, bar o kPa. Una lista ("a 10, 20 y 30 psia") sirve para comparar escenarios.
  const unit = (u) => (/atm/.test(u) ? 14.7 : /bar/.test(u) ? 14.5 : /kpa/.test(u) ? 0.145 : 1);
  let m;
  if ((m = s.match(new RegExp(`entre\\s+${N}\\s*(?:y|a)\\s+${N}\\s*(psi|atm|bar|kpa)`)))) {
    out.filters.pMin = num(m[1]) * unit(m[3]); out.filters.pMax = num(m[2]) * unit(m[3]);
  } else if ((m = s.match(new RegExp(`(?:mas de|mayor(?:es)?(?: a| que)?|>|arriba de|por encima de|superior(?:es)? a)\\s*${N}\\s*(psi|atm|bar|kpa)`)))) {
    out.filters.pMin = num(m[1]) * unit(m[2]);
  } else if ((m = s.match(new RegExp(`(?:menos de|menor(?:es)?(?: a| que)?|<|abajo de|por debajo de|inferior(?:es)? a)\\s*${N}\\s*(psi|atm|bar|kpa)`)))) {
    out.filters.pMax = num(m[1]) * unit(m[2]);
  } else if ((m = s.match(new RegExp(`((?:${N}\\s*(?:,|y|o)\\s*)+${N})\\s*(psi|atm|bar|kpa)`)))) {
    const u = unit(m[m.length - 1]);
    out.pList = m[1].split(/\s*(?:,|y|o)\s*/).map(num).filter(Number.isFinite).map((v) => v * u);
  } else if ((m = s.match(new RegExp(`${N}\\s*(psi|atm|bar|kpa)`)))) {
    out.pExact = num(m[1]) * unit(m[2]);
    out.filters.pMin = out.pExact - 0.7; out.filters.pMax = out.pExact + 0.7;
  } else if ((m = s.match(new RegExp(`presion\\s+(?:a|de|en|=)\\s*${N}`)))) {
    out.pExact = num(m[1]);
  }

  const o2rx = /(?:(mas de|mayor(?:es)?(?: a| que)?|>|menos de|menor(?:es)?(?: a| que)?|<)\s*)?(\d+(?:[.,]\d+)?)\s*%\s*(?:de\s+)?(?:o2|oxigeno)|(?:o2|oxigeno)\s*(?:de|al|=|en|a)?\s*(mas de|mayor(?:es)?(?: a| que)?|>|menos de|menor(?:es)?(?: a| que)?|<)?\s*(\d+(?:[.,]\d+)?)\s*%/;
  if ((m = s.match(o2rx))) {
    const cmp = m[1] || m[3] || '';
    const v = num(m[2] || m[4]) / 100;
    out.o2 = v; out.set.O2 = v;
    if (/mas|mayor|>/.test(cmp)) out.filters.o2Min = v;
    else if (/menos|menor|</.test(cmp)) out.filters.o2Max = v;
    else { out.filters.o2Min = v - 0.015; out.filters.o2Max = v + 0.015; }
  }
  if ((m = s.match(new RegExp(`${N}\\s*%\\s*(?:de\\s+)?${FUEL_WORD}`)))) out.set.Xfuel = num(m[1]) / 100;
  if ((m = s.match(new RegExp(`${N}\\s*%\\s*(?:de\\s+)?co2|co2\\s*(?:de|al|=|en|a)?\\s*${N}\\s*%`)))) out.set.CO2 = num(m[1] || m[2]) / 100;

  // Litros del quemador: "0.05 L de combustible", "300 ml de O2", "0.5 litros de nitrógeno"
  const lrx = new RegExp(`${N}\\s*(ml|mililitros?|l|litros?)\\b\\s*(?:de\\s+)?(o2|oxigeno|n2|nitrogeno|${FUEL_WORD.slice(3, -1)})?`, 'g');
  for (const x of s.matchAll(lrx)) {
    const v = num(x[1]) / (/^m/.test(x[2]) ? 1000 : 1);
    const gas = x[3] || '';
    if (/o2|oxigeno/.test(gas)) out.set.o2L = v;
    else if (/n2|nitrogeno/.test(gas)) out.set.n2L = v;
    else if (gas) out.set.fuelL = v;
    else out.set.burnerL = v;   // sin gas: lo que sale del quemador en ese tipo de llama
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
  if (f.result !== '' && f.result != null) bits.push(Number(f.result) ? 'que encendieron' : 'que no encendieron');
  if (f.pMin != null && f.pMax != null) bits.push(`${f.pMin.toFixed(1)} a ${f.pMax.toFixed(1)} psia`);
  else if (f.pMin != null) bits.push(`más de ${f.pMin} psia`);
  else if (f.pMax != null) bits.push(`menos de ${f.pMax} psia`);
  if (f.o2Min != null && f.o2Max != null) bits.push(`O2 cerca de ${(((f.o2Min + f.o2Max) / 2) * 100).toFixed(0)}%`);
  else if (f.o2Min != null) bits.push(`O2 sobre ${(f.o2Min * 100).toFixed(0)}%`);
  else if (f.o2Max != null) bits.push(`O2 bajo ${(f.o2Max * 100).toFixed(0)}%`);
  if (f.q) bits.push(`"${f.q}"`);
  return bits.join(', ') || 'todo el dataset';
}

const rowLine = (r) => ({
  id: r.id, tpid: r.prueba ?? r.tpid,
  text: r.prueba
    ? `${r.combustible}, llama ${r.llama}, ${r.presion_psia.toFixed(1)} psia, ${r.encendio ? 'encendió' : 'no encendió'}`
    : `${FUEL_ES[r.fuel]}, ${modeName(r.is_inverse).toLowerCase()}, ${r.P_psia.toFixed(1)} psia, ${r.ignite ? 'encendió' : 'no encendió'}`,
});
const used = (...names) => ({ t: 'tools', names });

/** Describe un escenario en una línea, solo con lo que aplica a su tipo de llama. */
function scenarioLine(p) {
  const bits = [FUEL_ES[p.fuel], modeName(p.inverse).toLowerCase(), fmt('P', p.P)];
  if (p.inverse) bits.push(`comb. en cámara ${fmt('Xfuel', p.Xfuel)}`, `O2 quemador ${fmt('o2L', p.o2L)}`);
  else bits.push(`O2 en cámara ${fmt('O2', p.O2)}`, `comb. quemador ${fmt('fuelL', p.fuelL)}`);
  if (p.n2L > 0.0005) bits.push(`N2 quemador ${fmt('n2L', p.n2L)}`);
  return bits.join(', ');
}

/* ------------------------------------------------------------- respuestas */
export const SUGGESTIONS = [
  '¿Qué tasa de ignición tiene el propano en llama inversa?',
  'Muéstrame pruebas con más de 25 psia que no encendieron',
  'Predice butano en llama normal a 14.7 psia con 35% de oxígeno',
  'Compara propano normal a 10, 20 y 40 psia',
  '¿Por qué el butano enciende menos que el etano?',
  '¿Qué variable influye más?',
  '¿Qué rangos se ensayaron para etileno?',
  '¿Qué tan confiable es el modelo?',
];

/** Predicción con la herramienta, convertida en bloques. */
function predictionBlocks(r, fromPrev = false) {
  if (r.error) return [{ t: 'p', text: r.error }];
  const p = r.escenario;
  if (r.resultado === 'imposible_por_fisica') {
    return [
      { t: 'stat', big: '0%', label: 'probabilidad de ignición', sub: scenarioLine(p) },
      { t: 'p', text: r.motivo },
      { t: 'actions', items: [{ label: 'Ajustar en el simulador', action: 'loadParams', params: p }] },
    ];
  }
  const blocks = [{ t: 'stat', big: pct(r.valor, 0), label: `probabilidad de ignición, riesgo ${levelOf(r.valor).label.toLowerCase()}`, sub: `${scenarioLine(p)}. ${fromPrev ? 'Lo demás sigue igual que en tu escenario anterior.' : 'Lo que no indicaste toma valores típicos de los ensayos reales.'}` }];
  if (r.fuera_de_rango) {
    blocks.push({ t: 'p', text: 'Ojo: es una extrapolación. NASA no probó este escenario, así que el porcentaje es la tendencia del modelo, no un resultado respaldado por pruebas:' });
    blocks.push({ t: 'list', items: r.fuera_de_rango });
  } else if (r.aviso_lejania) {
    blocks.push({ t: 'p', text: 'Cada valor está dentro de lo ensayado, pero la combinación no se parece a ninguna prueba real. Tómalo con cautela.' });
  }
  if (r.pruebas_mas_parecidas?.length) {
    blocks.push({ t: 'p', text: 'Pruebas reales más parecidas:' });
    blocks.push({ t: 'rows', rows: r.pruebas_mas_parecidas.map(rowLine) });
  }
  blocks.push({ t: 'actions', items: [{ label: 'Ajustar en el simulador', action: 'loadParams', params: p }] });
  return blocks;
}

/** Arma los argumentos de predecir_ignicion a partir de lo que dijo el usuario (y del escenario anterior). */
function predictArgs(q, fuel, inverse, base) {
  const a = { combustible: fuel, llama: inverse ? 'inversa' : 'normal', base };
  if (q.pExact != null) a.presion_psia = q.pExact;
  if (q.set.O2 != null && !inverse) a.o2_camara_pct = q.set.O2 * 100;
  if (q.set.Xfuel != null && inverse) a.comb_camara_pct = q.set.Xfuel * 100;
  if (q.set.CO2 != null) a.co2_camara_pct = q.set.CO2 * 100;
  if (q.set.n2L != null) a.n2_quemador_L = q.set.n2L;
  const o2L = q.set.o2L ?? (inverse ? q.set.burnerL : undefined);
  const fuelL = q.set.fuelL ?? (!inverse ? q.set.burnerL : undefined);
  if (o2L != null && inverse) a.o2_quemador_L = o2L;
  if (fuelL != null && !inverse) a.comb_quemador_L = fuelL;
  return a;
}

function ignoredNotes(q, inverse) {
  const notes = [];
  if (inverse && q.set.O2 != null) notes.push('En llama inversa la cámara casi no tiene O2 (entra por el quemador), así que ignoré el % de O2 de la cámara.');
  if (!inverse && q.set.Xfuel != null) notes.push('En llama normal la cámara no tiene combustible (sale por el quemador), así que ignoré el % de combustible en cámara.');
  if (inverse && q.set.fuelL != null) notes.push('En llama inversa del quemador sale O2, no combustible: ignoré los litros de combustible.');
  if (!inverse && q.set.o2L != null) notes.push('En llama normal del quemador sale combustible, no O2: ignoré los litros de O2.');
  return notes.map((text) => ({ t: 'p', text }));
}

/**
 * Responde una pregunta. `ctx` guarda el último escenario para seguimientos ("¿y si subo la presión a 30?").
 * Devuelve { blocks, ctx }.
 */
export function answer(raw, ctx = {}) {
  const text = raw.trim();
  const s = fold(text).replace(/^[¿¡\s]+/, '');
  const reply = (blocks, extra = {}) => ({ blocks, ctx: { ...ctx, ...extra } });
  if (!s) return reply([{ t: 'p', text: 'Escribe una pregunta o prueba una de las sugerencias.' }]);
  const q = parseQuery(text);

  // 1) un TPID concreto
  const tp = s.match(/\b(\d{5}[a-z]\d*[a-z0-9_-]*)\b/);
  if (tp) {
    const r = DATA.find((d) => fold(d.tpid) === tp[1]);
    if (r) {
      return reply([
        { t: 'p', text: `El punto ${r.tpid} (${r.date}, ${r.source}) fue ${FUEL_ES[r.fuel].toLowerCase()} en ${modeName(r.is_inverse).toLowerCase()} a ${r.P_psia} psia. ${r.ignite ? 'Sí encendió' : 'No encendió'}; el modelo, sin haber visto ese día, estimó ${pct(r.prob_cv, 0)}.` },
        { t: 'actions', items: [{ label: 'Cargar en el simulador', action: 'load', row: r.id }, { label: 'Ver en la tabla', action: 'filters', filters: { ...EMPTY_FILTERS, q: r.tpid } }] },
      ]);
    }
  }

  // 2) saludo / ayuda
  if (/^(hola|buenas|hey|ayuda|help|que puedes|que sabes)/.test(s)) {
    return reply([{ t: 'p', text: 'Puedo contar y filtrar pruebas, comparar combustibles, explicar términos, decir qué rangos ensayó NASA, estimar la probabilidad de ignición de un escenario (también fuera de lo ensayado) y sugerir cómo bajar el riesgo. Después de una estimación puedes seguir con "¿y si subo la presión a 30?".' }, { t: 'suggest' }]);
  }

  // 3) cambios del dataset
  if (/cambi|elimin|limpi|mfca|corrig|version|que se hizo|metano/.test(s) && !/predic|probabilidad|y si/.test(s)) {
    const blocks = [{ t: 'p', text: 'Cambios respecto al dataset original:' }, { t: 'list', items: CHANGES }];
    if (q.fuels.includes('Methane')) blocks.unshift({ t: 'p', text: 'No hay metano porque las únicas filas eran chequeos de flujo, no intentos de ignición.' });
    return reply(blocks);
  }

  // 4) calidad del modelo
  if (/precision|auc|confiab|que tan bueno|exactitud|acierta|validacion del modelo|funciona el modelo|que modelo/.test(s)) {
    const r = runTool('resumen_dataset');
    const c = r.calidad_del_modelo;
    return reply([
      { t: 'stat', big: c['PSI-159'].auc.toFixed(2), label: 'AUC en PSI-159', sub: `exactitud ${pct(c['PSI-159'].accuracy, 0)} frente a ${pct(c['PSI-159'].majority_baseline, 0)} de adivinar siempre "enciende"` },
      { t: 'p', text: `${r.modelo}. Validación ${c.method}: cada día se predice sin haberlo visto. En PSI-10 casi todo enciende (${pct(c['PSI-10'].ignite_rate, 0)}), por eso el AUC global (${c.all.auc.toFixed(2)}) se ve mejor de lo que es. Úsalo como alerta de apoyo, no como garantía.` },
      used('resumen_dataset'),
    ]);
  }

  // 5) qué variable importa más
  if (/(variable|factor|parametro).*(importa|influye|pesa|decide|afecta)|mas importante|influye mas|que decide|que afecta/.test(s)) {
    const r = runTool('resumen_dataset');
    const imp = Object.entries(r.importancia_de_variables).sort((a, b) => b[1] - a[1]);
    const dir = (k) => {
      if (k === 'fuel') return 'depende del combustible';
      const e = r.efecto_de_cada_variable[k];
      return Math.abs(e) < 1e-6 ? 'sin efecto en los datos' : e > 0 ? 'sube la probabilidad' : 'baja la probabilidad';
    };
    return reply([
      { t: 'p', text: 'Peso de cada variable en el modelo (coeficientes con las variables en la misma escala):' },
      { t: 'table', head: ['Variable', 'Peso', 'Al aumentar'], rows: imp.map(([k, v]) => [LABEL[k] || k, pct(v, 0), dir(k)]) },
      { t: 'p', text: 'La llama normal y la inversa son espejo: el quemador suelta un reactivo y la cámara tiene el otro. Por eso el O2 y el combustible no tienen pesos separados, sino uno por papel. El chorro se mide en litros de O2 equivalente: 1 L de butano pide 6.5 L de O2, así que cuenta como 6.5 L.' },
      { t: 'p', text: 'Lo que hay en la cámara casi no mueve el resultado y el CO2 queda en cero: la física dice que más reactivo ayuda y el CO2 (inerte) estorba, pero en estos datos, una vez considerado el chorro, no se ve ese efecto. Se fijaron los signos para que el modelo no aprenda tendencias al revés.' },
      used('resumen_dataset'),
    ]);
  }

  // 6) rangos ensayados
  if (/rango|entre que valores|que se (probo|ensayo)|que valores (se )?(probaron|ensayaron)|limites? (de|del) (ensayo|experimento)|que probo nasa/.test(s) && q.fuels.length) {
    const fuel = q.fuels[0];
    const modes = q.inverse != null ? [q.inverse] : [0, 1];
    const blocks = [];
    modes.forEach((m) => {
      const r = runTool('rangos_ensayados', { combustible: fuel, llama: m ? 'inversa' : 'normal' });
      if (r.error) blocks.push({ t: 'p', text: r.error });
      else if (!r.existe) blocks.push({ t: 'p', text: r.mensaje });
      else {
        blocks.push({ t: 'p', text: `${r.combustible}, llama ${r.llama}:` });
        blocks.push({ t: 'table', head: ['Variable', 'Ensayado'], rows: Object.entries(r.rangos) });
      }
    });
    blocks.push({ t: 'p', text: 'Fuera de esos valores la app igual estima, pero marca el resultado como extrapolación.' });
    blocks.push(used('rangos_ensayados'));
    return reply(blocks);
  }

  // 7) glosario
  if (/que (es|son|significa|quiere decir)|explica|definicion|como se calcula|para que sirve/.test(s)) {
    const g = GLOSSARY.find((x) => x.rx.test(s));
    if (g) return reply([{ t: 'term', title: g.title, text: g.text }]);
  }

  // 8) palancas: cómo bajar el riesgo del último escenario (o del que describa)
  if (/(como|que hago para|que puedo hacer para)\s+(bajo|bajar|reduzco|reducir|evito|evitar|disminuir|disminuyo)|que no encienda|bajar el riesgo|reducir el riesgo|palanca/.test(s)) {
    const base = ctx.params;
    if (!base) return reply([{ t: 'p', text: 'Primero pídeme una estimación (por ejemplo "predice propano normal a 14.7 psia") y luego te digo qué cambio baja más el riesgo.' }]);
    const r = runTool('predecir_ignicion', { combustible: base.fuel, llama: base.inverse ? 'inversa' : 'normal', base });
    const ls = levers(r.escenario, r.valor).filter((l) => l.delta < -0.005).slice(0, 4);
    if (!ls.length) return reply([{ t: 'p', text: `Con ${scenarioLine(r.escenario)} (${pct(r.valor, 0)}), ningún cambio de un solo parámetro baja el riesgo de forma apreciable según el modelo.` }, used('predecir_ignicion')]);
    return reply([
      { t: 'p', text: `Partiendo de ${scenarioLine(r.escenario)} (${pct(r.valor, 0)}), lo que más baja la probabilidad según el modelo:` },
      { t: 'table', head: ['Cambio', 'Queda en'], rows: ls.map((l) => [l.label, `${pct(l.prob, 0)} (${(l.delta * 100).toFixed(0)} pts)`]) },
      { t: 'p', text: 'El modelo aprendió correlaciones de las pruebas, no física de combustión. Valida cualquier cambio antes de aplicarlo.' },
      used('predecir_ignicion'),
    ]);
  }

  // 9) predicción (también seguimientos sobre el último escenario)
  const followUp = !!ctx.params && /^(y\s+)?(si|que tal si|con|ahora con|y con|y a|y en)\b|^y\s|\bsub(e|o|ir|imos)\b|\bbaj(a|o|ar|amos)\b|\baument|\bdisminu|\bcambi|\bpon(go|er|emos)?\b/.test(s);
  const wantsPredict = /predic|probabilidad de|riesgo|encendera|enciende si|que pasa si|simula|estima|que tan probable/.test(s);
  const hasScenario = q.pExact != null || q.pList || Object.keys(q.set).length > 0;
  if ((wantsPredict && (q.fuels.length || ctx.params)) || (followUp && (hasScenario || q.fuels.length || q.inverse != null))
    || (q.pList && q.fuels.length && /compar/.test(s))) {
    const fuel = q.fuels[0] || ctx.params?.fuel;
    if (!fuel) return reply([{ t: 'p', text: '¿Qué combustible? Hay etileno, etano, propano y butano.' }]);
    if (fuel === 'Methane') return reply([{ t: 'p', text: 'No hay pruebas reales de metano en el dataset limpio, así que no puedo estimarlo. Elige etileno, propano, butano o etano.' }]);
    let inverse = q.inverse ?? ((q.set.Xfuel != null || q.set.o2L != null) ? 1 : null);
    if (inverse == null) inverse = ctx.params && ctx.params.fuel === fuel ? ctx.params.inverse : 0;
    const base = followUp || (ctx.params && !q.fuels.length) ? ctx.params : undefined;

    if (q.pList?.length > 1) {
      const res = q.pList.map((P) => runTool('predecir_ignicion', { ...predictArgs(q, fuel, inverse, base), presion_psia: P }));
      const last = res[res.length - 1].escenario;
      return reply([
        { t: 'p', text: `${FUEL_ES[fuel]}, ${modeName(inverse).toLowerCase()}, cambiando solo la presión:` },
        { t: 'table', head: ['Presión', 'Probabilidad', ''], rows: res.map((r) => [fmt('P', r.escenario.P), r.resultado === 'imposible_por_fisica' ? '0% (regla física)' : pct(r.valor, 0), r.fuera_de_rango ? 'extrapolación' : 'dentro de lo ensayado']) },
        ...ignoredNotes(q, inverse),
        { t: 'actions', items: res.map((r) => ({ label: `Cargar ${fmt('P', r.escenario.P)}`, action: 'loadParams', params: r.escenario })) },
        used('predecir_ignicion'),
      ], { params: last });
    }

    const r = runTool('predecir_ignicion', predictArgs(q, fuel, inverse, base));
    const fromPrev = !!base && base.fuel === fuel && base.inverse === inverse;
    const blocks = [...predictionBlocks(r, fromPrev), ...ignoredNotes(q, inverse), used('predecir_ignicion')];
    return reply(blocks, r.escenario ? { params: r.escenario } : {});
  }

  // 10) normal contra inversa
  if (/(normal|inversa).*(contra|vs|versus|o la|que la|compar)|cual enciende mas|que llama enciende mas|simpson/.test(s) && q.fuels.length === 0) {
    const r = runTool('comparar_combustibles');
    const sp = r.paradoja;
    const blocks = [
      { t: 'p', text: `En promedio global, la llama normal encendió ${pct(sp.global.normal)} y la inversa ${pct(sp.global.inversa)}.` },
      { t: 'table', head: ['Combustible', 'Normal', 'Inversa'], rows: sp.por_combustible.map((x) => [x.combustible, pct(x.normal, 0), pct(x.inversa, 0)]) },
    ];
    blocks.push({ t: 'p', text: sp.hay_paradoja
      ? `Ojo, paradoja de Simpson: con el mismo combustible gana la llama ${sp.global.gana === 'normal' ? 'inversa' : 'normal'} en la mayoría de los casos, al revés que el promedio. Pasa porque cada tipo de llama tiene una mezcla distinta de combustibles.`
      : 'Comparando con el mismo combustible el resultado varía según el gas, así que conviene mirar la tabla y no solo el promedio.' });
    blocks.push(used('comparar_combustibles'));
    return reply(blocks);
  }

  // 11) comparación de combustibles (y por qué)
  if (/compar|versus|\bvs\b|contra|diferencia|por que .*(enciende|prende)|cual enciende/.test(s)) {
    const m = q.inverse == null ? '' : q.inverse ? 'inversa' : 'normal';
    const r = runTool('comparar_combustibles', { llama: m });
    const want = q.fuels.filter((f) => f !== 'Methane');
    const list = r.combustibles.filter((c) => !want.length || want.some((f) => FUEL_ES[f] === c.combustible));
    const blocks = [
      { t: 'p', text: `Tasa de ignición por combustible (${r.ambito}):` },
      { t: 'table', head: ['Combustible', 'Normal', 'Inversa', 'O2 por molécula', 'Energía mín. (mJ)'], rows: list.map((c) => [c.combustible, c.normal, c.inversa, String(c.o2_por_molecula), String(c.energia_min_ignicion_mJ)]) },
    ];
    if (/por que|diferencia|explica/.test(s)) {
      blocks.push({ t: 'p', text: 'El etileno (C2H4) tiene un doble enlace y es mucho más reactivo: necesita unas tres veces menos energía para encender. Entre etano, propano y butano la energía de ignición es casi igual; la diferencia está en cuánto oxígeno necesita cada molécula (3.5, 5 y 6.5): cuanto más O2 pide, más difícil es que la mezcla llegue a encender.' });
    }
    if (r.nota) blocks.push({ t: 'p', text: r.nota });
    blocks.push(used('comparar_combustibles'));
    return reply(blocks);
  }

  // 12) resumen del dataset
  if (/resumen|de donde (salen|vienen)|origen de los datos|periodo|que fechas|cuantas pruebas hay( en total)?$|cuantas pruebas tiene/.test(s) && !q.found) {
    const r = runTool('resumen_dataset');
    return reply([
      { t: 'stat', big: String(r.pruebas_totales), label: 'pruebas de ignición', sub: `${r.tasa_ignicion_global} encendió; ${r.llama_normal} en llama normal y ${r.llama_inversa} en inversa` },
      { t: 'list', items: r.archivos_de_origen },
      { t: 'p', text: `Combustibles: ${r.combustibles.join(', ')}. ${r.aviso}` },
      used('resumen_dataset'),
    ]);
  }

  // 13) conteos y búsquedas
  const wantsCount = /cuant|tasa|porcentaje|proporcion|promedio|how many|total/.test(s);
  const wantsList = /muestra|muestrame|lista|busca|encuentra|dame|ensena|ver |pruebas|experimentos|puntos/.test(s);
  if (q.found || wantsCount || wantsList) {
    if (/por combustible/.test(s)) {
      const rows = FUELS.map((f) => {
        const r = runTool('buscar_pruebas', { filtros: { ...q.filters, fuel: f } });
        return [FUEL_ES[f], String(r.pruebas_encontradas), r.pruebas_encontradas ? r.tasa_ignicion : '-'];
      });
      return reply([{ t: 'table', head: ['Combustible', 'Pruebas', 'Encendió'], rows }, used('buscar_pruebas')]);
    }
    const r = runTool('buscar_pruebas', { filtros: q.filters });
    if (!r.pruebas_encontradas) return reply([{ t: 'p', text: `No hay pruebas con ${describe(q.filters)}. Prueba con un rango más amplio.` }, used('buscar_pruebas')]);
    const byResult = q.filters.result !== '' && q.filters.result != null;   // la tasa sería 0 % o 100 % por definición
    const blocks = [byResult
      ? { t: 'stat', big: String(r.pruebas_encontradas), label: 'pruebas encontradas', sub: describe(q.filters) }
      : { t: 'stat', big: r.tasa_ignicion.replace(' ', ''), label: 'tasa de ignición', sub: `${r.encendieron} de ${r.pruebas_encontradas} pruebas: ${describe(q.filters)}` }];
    if (wantsList || r.pruebas_encontradas <= 6) blocks.push({ t: 'rows', rows: r.ejemplos.slice(0, 5).map(rowLine) });
    blocks.push({ t: 'actions', items: [{ label: `Ver las ${r.pruebas_encontradas} en la tabla`, action: 'filters', filters: q.filters }] });
    blocks.push(used('buscar_pruebas'));
    return reply(blocks);
  }

  // 14) texto libre como búsqueda
  const r = runTool('buscar_pruebas', { texto: text });
  if (r.pruebas_encontradas && r.pruebas_encontradas < DATA.length) {
    return reply([{ t: 'p', text: `Encontré ${r.pruebas_encontradas} pruebas que contienen "${text}".` }, { t: 'rows', rows: r.ejemplos.slice(0, 5).map(rowLine) },
      { t: 'actions', items: [{ label: 'Ver en la tabla', action: 'filters', filters: { ...EMPTY_FILTERS, q: text } }] }, used('buscar_pruebas')]);
  }
  return reply([{ t: 'p', text: 'No entendí esa pregunta. Puedo filtrar pruebas ("propano inversa más de 25 psia"), comparar combustibles, explicar términos, decir qué rangos ensayó NASA o estimar un escenario ("predice etano normal a 20 psia con 0.05 L de combustible").' }, { t: 'suggest' }]);
}

