/**
 * Herramientas del asistente (src/lib/chat.js).
 *
 * El asistente no calcula números por su cuenta: entiende la pregunta, llama a estas
 * funciones, que son el mismo código que usa el resto de la app, y redacta sobre
 * resultados reales. Así no puede inventarse un porcentaje. Todo corre en el navegador.
 */
import {
  DATA, FUELS, FUEL_ES, META, applyFilters, rate, EMPTY_FILTERS,
  checkRange, nearest, typicalParams, MODE_RANGES, VARS, fmt,
} from './data.js';
import { predict, blocker, BLOCK_TEXT } from './model.js';

const pct = (x) => `${(x * 100).toFixed(1)} %`;
const esFuel = (f) => FUEL_ES[f] || f;
const tasa = (list) => (list.length ? `${pct(rate(list))} de ${list.length}` : 'sin pruebas');

/**
 * ¿El promedio global de normal vs inversa apunta al revés que la comparación con el mismo combustible?
 * (paradoja de Simpson). Se calcula con los datos actuales, para que siga siendo cierto al reentrenar.
 */
export function simpson() {
  const n = DATA.filter((r) => !r.is_inverse), i = DATA.filter((r) => r.is_inverse);
  const global = rate(n) > rate(i) ? 'normal' : 'inversa';
  const pares = FUELS.map((f) => [f, n.filter((r) => r.fuel === f), i.filter((r) => r.fuel === f)])
    .filter(([, a, b]) => a.length && b.length)
    .map(([f, a, b]) => ({ combustible: esFuel(f), normal: rate(a), inversa: rate(b), gana: rate(a) > rate(b) ? 'normal' : 'inversa' }));
  const contra = pares.filter((x) => x.gana !== global);
  return {
    global: { normal: rate(n), inversa: rate(i), gana: global },
    por_combustible: pares,
    hay_paradoja: pares.length > 0 && contra.length > pares.length / 2,
  };
}

/** Traduce el nombre en español que use el modelo al código interno del dataset. */
const toFuel = (s) => {
  if (!s) return '';
  const k = String(s).toLowerCase();
  return FUELS.find((f) => f.toLowerCase() === k || esFuel(f).toLowerCase() === k) || '';
};
const toMode = (s) => {
  if (s === undefined || s === null || s === '') return '';
  const k = String(s).toLowerCase();
  if (k === 'inversa' || k === 'inverse' || k === '1' || k === 'true') return '1';
  if (k === 'normal' || k === '0' || k === 'false') return '0';
  return '';
};

const rowOut = (r) => ({
  id: r.id,
  prueba: r.tpid,
  fecha: r.date,
  combustible: esFuel(r.fuel),
  llama: r.is_inverse ? 'inversa' : 'normal',
  presion_psia: +r.P_psia.toFixed(2),
  o2_camara_pct: +(r.X_O2 * 100).toFixed(2),
  comb_camara_pct: +(r.X_fuel * 100).toFixed(2),
  o2_quemador_L: +r.O2_burner_corr_L.toFixed(4),
  comb_quemador_L: +r.fuel_burner_corr_L.toFixed(4),
  n2_quemador_L: +r.N2_burner_corr_L.toFixed(4),
  encendio: !!r.ignite,
});

export const TOOLS = [
  {
    name: 'buscar_pruebas',
    description:
      'Busca pruebas reales en el dataset de NASA y devuelve cuántas hay, qué porcentaje encendió y algunos ejemplos. '
      + 'Úsala siempre que necesites un conteo o una tasa de ignición. Todos los filtros son opcionales; sin filtros devuelve el total.',
    parameters: {
      type: 'OBJECT',
      properties: {
        combustible: { type: 'STRING', description: 'etileno, etano, propano o butano' },
        llama: { type: 'STRING', description: 'normal o inversa' },
        resultado: { type: 'STRING', description: 'encendio o no_encendio' },
        presion_min: { type: 'NUMBER', description: 'presión mínima en psia' },
        presion_max: { type: 'NUMBER', description: 'presión máxima en psia' },
        o2_min_pct: { type: 'NUMBER', description: 'O2 mínimo de cámara en por ciento, ej. 21' },
        o2_max_pct: { type: 'NUMBER', description: 'O2 máximo de cámara en por ciento' },
        texto: { type: 'STRING', description: 'búsqueda libre, por ejemplo un identificador de prueba como 21349' },
      },
    },
    run: (a = {}) => {
      // Si pidieron un combustible que no existe, no se puede ignorar el filtro:
      // devolvería el dataset entero como si fuera de ese gas.
      if (a.combustible && !toFuel(a.combustible)) {
        return { error: `No hay pruebas de "${a.combustible}" en este dataset. Solo existen etileno, etano, propano y butano.` };
      }
      if (a.llama && !toMode(a.llama)) {
        return { error: `"${a.llama}" no es un tipo de llama. Solo hay normal e inversa.` };
      }
      // `filtros` = filtros ya interpretados por el asistente, en el formato del buscador.
      const f = a.filtros ? { ...EMPTY_FILTERS, ...a.filtros } : {
        ...EMPTY_FILTERS,
        q: a.texto || '',
        fuel: toFuel(a.combustible),
        mode: toMode(a.llama),
        result: a.resultado ? (String(a.resultado).startsWith('no') ? '0' : '1') : '',
        pMin: a.presion_min ?? null,
        pMax: a.presion_max ?? null,
        o2Min: a.o2_min_pct != null ? a.o2_min_pct / 100 : null,
        o2Max: a.o2_max_pct != null ? a.o2_max_pct / 100 : null,
      };
      const list = applyFilters(DATA, f);
      return {
        filtros: f,
        pruebas_encontradas: list.length,
        tasa_ignicion: list.length ? pct(rate(list)) : 'sin pruebas',
        encendieron: list.filter((r) => r.ignite).length,
        ejemplos: list.slice(0, 8).map(rowOut),
        nota: list.length === 0 ? 'Ninguna prueba cumple esos filtros. Dilo claramente, no inventes.' : undefined,
      };
    },
  },
  {
    name: 'predecir_ignicion',
    description:
      'Corre el modelo entrenado sobre un escenario y devuelve la probabilidad de ignición. '
      + 'En llama normal la cámara tiene O2 y el combustible sale por el quemador. '
      + 'En llama inversa la cámara tiene combustible y el O2 sale por el quemador. '
      + 'Si el escenario cae fuera de lo que NASA ensayó, igual da la probabilidad pero la marca como extrapolación.',
    parameters: {
      type: 'OBJECT',
      properties: {
        combustible: { type: 'STRING', description: 'etileno, etano, propano o butano' },
        llama: { type: 'STRING', description: 'normal o inversa' },
        presion_psia: { type: 'NUMBER' },
        o2_camara_pct: { type: 'NUMBER', description: 'solo llama normal' },
        comb_camara_pct: { type: 'NUMBER', description: 'solo llama inversa' },
        comb_quemador_L: { type: 'NUMBER', description: 'solo llama normal' },
        o2_quemador_L: { type: 'NUMBER', description: 'solo llama inversa' },
        n2_quemador_L: { type: 'NUMBER' },
        co2_camara_pct: { type: 'NUMBER' },
        base: { type: 'OBJECT', description: 'escenario de partida (seguimientos tipo "¿y si subo la presión?"); si falta, valores típicos de los ensayos' },
      },
      required: ['combustible', 'llama'],
    },
    run: (a = {}) => {
      const fuel = toFuel(a.combustible);
      if (!fuel) return { error: `No conozco el combustible "${a.combustible}". Solo hay etileno, etano, propano y butano.` };
      const inverse = toMode(a.llama) === '1' ? 1 : 0;
      const same = a.base && a.base.fuel === fuel && a.base.inverse === inverse;
      const base = same ? a.base : typicalParams(fuel, inverse, !inverse && a.o2_camara_pct != null ? { O2: a.o2_camara_pct / 100 } : null);
      const p = {
        ...base,
        fuel,
        inverse,
        P: a.presion_psia ?? base.P,
        O2: a.o2_camara_pct != null ? a.o2_camara_pct / 100 : base.O2,
        Xfuel: a.comb_camara_pct != null ? a.comb_camara_pct / 100 : base.Xfuel,
        fuelL: a.comb_quemador_L ?? base.fuelL,
        o2L: a.o2_quemador_L ?? base.o2L,
        n2L: a.n2_quemador_L ?? base.n2L,
        CO2: a.co2_camara_pct != null ? a.co2_camara_pct / 100 : base.CO2,
      };
      const chk = checkRange(p);
      const blk = blocker(p);
      if (blk) {
        return { resultado: 'imposible_por_fisica', probabilidad: '0 %', valor: 0, motivo: BLOCK_TEXT[blk], escenario: p };
      }
      const extrap = chk.noData || chk.out.length > 0;
      const near = nearest(p, 3);
      const prob = predict(p);
      return {
        resultado: extrap ? 'extrapolacion' : 'ok',
        probabilidad: pct(prob),
        valor: prob,
        escenario: p,
        fuera_de_rango: extrap
          ? (chk.noData ? [chk.message] : chk.out.map((o) => `${o.label}: ${fmt(o.key, o.value)}, NASA ensayó de ${fmt(o.key, o.lo)} a ${fmt(o.key, o.hi)}`))
          : undefined,
        valores_usados: {
          combustible: esFuel(fuel),
          llama: inverse ? 'inversa' : 'normal',
          presion_psia: +p.P.toFixed(2),
          o2_camara_pct: +(p.O2 * 100).toFixed(2),
          comb_camara_pct: +(p.Xfuel * 100).toFixed(2),
          comb_quemador_L: +p.fuelL.toFixed(4),
          o2_quemador_L: +p.o2L.toFixed(4),
          n2_quemador_L: +p.n2L.toFixed(4),
        },
        aviso_lejania: near.far ? 'Esta combinación no se parece a ninguna prueba real; menciónalo.' : undefined,
        pruebas_mas_parecidas: near.rows.map(({ r }) => rowOut(r)),
      };
    },
  },
  {
    name: 'comparar_combustibles',
    description:
      'Devuelve, para cada combustible, cuántas pruebas hay, qué porcentaje encendió y cuánto oxígeno necesita por molécula. '
      + 'Úsala para cualquier pregunta sobre por qué un combustible enciende más que otro.',
    parameters: {
      type: 'OBJECT',
      properties: { llama: { type: 'STRING', description: 'normal o inversa; omitir para ver todo junto' } },
    },
    run: (a = {}) => {
      const m = toMode(a.llama);
      const base = m === '' ? DATA : DATA.filter((r) => String(r.is_inverse) === m);
      // O2 estequiométrico por molécula de combustible y constantes de laboratorio (aire, 1 atm).
      const quim = {
        Ethylene: { formula: 'C2H4', o2_por_molecula: 3.0, energia_min_ignicion_mJ: 0.084, velocidad_llama_cm_s: 58 },
        Ethane: { formula: 'C2H6', o2_por_molecula: 3.5, energia_min_ignicion_mJ: 0.23, velocidad_llama_cm_s: 45 },
        Propane: { formula: 'C3H8', o2_por_molecula: 5.0, energia_min_ignicion_mJ: 0.25, velocidad_llama_cm_s: 37 },
        Butane: { formula: 'C4H10', o2_por_molecula: 6.5, energia_min_ignicion_mJ: 0.25, velocidad_llama_cm_s: 36 },
      };
      const sin = FUELS.flatMap((f) => [0, 1].filter((i) => !DATA.some((r) => r.fuel === f && r.is_inverse === i))
        .map((i) => `${esFuel(f)} en llama ${i ? 'inversa' : 'normal'}`));
      return {
        ambito: m === '' ? 'todas las pruebas' : `solo llama ${m === '1' ? 'inversa' : 'normal'}`,
        combustibles: FUELS.map((f) => {
          const s = base.filter((r) => r.fuel === f);
          return {
            combustible: esFuel(f),
            ...quim[f],
            pruebas: s.length,
            normal: tasa(s.filter((r) => !r.is_inverse)),
            inversa: tasa(s.filter((r) => r.is_inverse)),
            tasa_ignicion: s.length ? pct(rate(s)) : 'sin pruebas en este ámbito',
          };
        }),
        paradoja: simpson(),
        nota: sin.length ? `No hay pruebas de: ${sin.join(', ')}.` : undefined,
      };
    },
  },
  {
    name: 'rangos_ensayados',
    description:
      'Dice entre qué valores ensayó NASA cada variable para un combustible y tipo de llama. '
      + 'Úsala antes de afirmar que algo es posible o imposible.',
    parameters: {
      type: 'OBJECT',
      properties: {
        combustible: { type: 'STRING' },
        llama: { type: 'STRING', description: 'normal o inversa' },
      },
      required: ['combustible', 'llama'],
    },
    run: (a = {}) => {
      const fuel = toFuel(a.combustible);
      if (!fuel) return { error: `No conozco "${a.combustible}". Solo hay etileno, etano, propano y butano.` };
      const inverse = toMode(a.llama) === '1' ? 1 : 0;
      const r = META.ranges[`${fuel}|${inverse}`];
      if (!r) {
        return {
          existe: false,
          mensaje: `No hay ninguna prueba de ${esFuel(fuel)} en llama ${inverse ? 'inversa' : 'normal'}. El modelo no puede estimar esa combinación.`,
        };
      }
      const g = MODE_RANGES[inverse];
      return {
        existe: true,
        combustible: esFuel(fuel),
        llama: inverse ? 'inversa' : 'normal',
        rangos: Object.fromEntries(VARS.filter((v) => v.modes.includes(inverse)).map((v) => [
          v.label,
          `${(r[v.row][0] * v.scale).toFixed(v.dec)} a ${(r[v.row][1] * v.scale).toFixed(v.dec)} ${v.unit}`,
        ])),
        rango_global_del_modo: Object.fromEntries(VARS.filter((v) => v.modes.includes(inverse)).map((v) => [
          v.label, `${(g[v.key][0] * v.scale).toFixed(v.dec)} a ${(g[v.key][1] * v.scale).toFixed(v.dec)} ${v.unit}`,
        ])),
      };
    },
  },
  {
    name: 'resumen_dataset',
    description: 'Datos generales: cuántas pruebas hay, de dónde salen, qué periodo cubren y qué tan bueno es el modelo.',
    parameters: { type: 'OBJECT', properties: {} },
    run: () => ({
      pruebas_totales: DATA.length,
      tasa_ignicion_global: pct(rate(DATA)),
      llama_normal: DATA.filter((r) => !r.is_inverse).length,
      llama_inversa: DATA.filter((r) => r.is_inverse).length,
      archivos_de_origen: Object.entries(META.periods).flatMap(([src, tramos]) => tramos.map(([a, b, n]) => `${src}: ${n} pruebas del ${a} al ${b}`)),
      combustibles: FUELS.map(esFuel),
      modelo: META.model,
      calidad_del_modelo: META.cv,
      importancia_de_variables: META.importance,
      efecto_de_cada_variable: META.effects,
      aviso: 'La validación se hizo dejando fuera cada día de pruebas completo, así que las cifras son fuera de muestra.',
    }),
  },
];

export function runTool(name, args) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { error: `No existe la herramienta ${name}.` };
  try {
    return t.run(args || {});
  } catch (e) {
    return { error: `La herramienta ${name} falló: ${e.message}` };
  }
}
