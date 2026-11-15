/**
 * Herramientas que el modelo de lenguaje puede llamar.
 *
 * La idea: el modelo NO calcula números. Pide datos a estas funciones, que son
 * el mismo código que usa el resto de la app, y redacta sobre resultados reales.
 * Así no puede inventarse un porcentaje.
 */
import {
  DATA, FUELS, FUEL_ES, META, applyFilters, rate, EMPTY_FILTERS,
  checkRange, nearest, typicalParams, MODE_RANGES, VARS, modeName,
} from './data.js';
import { predict, blocker, BLOCK_TEXT } from './model.js';

const pct = (x) => `${(x * 100).toFixed(1)} %`;
const esFuel = (f) => FUEL_ES[f] || f;

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
      const f = {
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
      + 'Si el escenario cae fuera de lo que NASA ensayó, devuelve fuera_de_rango y NO debes dar un porcentaje.',
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
      },
      required: ['combustible', 'llama'],
    },
    run: (a = {}) => {
      const fuel = toFuel(a.combustible);
      if (!fuel) return { error: `No conozco el combustible "${a.combustible}". Solo hay etileno, etano, propano y butano.` };
      const inverse = toMode(a.llama) === '1' ? 1 : 0;
      const base = typicalParams(fuel, inverse);
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
      };
      const chk = checkRange(p);
      const blk = blocker(p);
      if (blk) {
        return { resultado: 'imposible_por_fisica', probabilidad: '0 %', motivo: BLOCK_TEXT[blk] };
      }
      if (chk.noData || chk.out.length) {
        return {
          resultado: 'fuera_de_rango',
          probabilidad: null,
          motivo: chk.noData ? chk.message : chk.out.map((o) => `${o.label} está fuera de lo ensayado`).join('; '),
          instruccion: 'No des ningún porcentaje. Explica que no hay pruebas reales parecidas y sugiere acercarse al rango ensayado.',
        };
      }
      const near = nearest(p, 3);
      return {
        resultado: 'ok',
        probabilidad: pct(predict(p)),
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
      return {
        ambito: m === '' ? 'todas las pruebas' : `solo llama ${m === '1' ? 'inversa' : 'normal'}`,
        combustibles: FUELS.map((f) => {
          const s = base.filter((r) => r.fuel === f);
          return {
            combustible: esFuel(f),
            ...quim[f],
            pruebas: s.length,
            tasa_ignicion: s.length ? pct(rate(s)) : 'sin pruebas en este ámbito',
          };
        }),
        nota: 'El etileno solo se probó en llama inversa: no existe ninguna prueba de etileno en llama normal.',
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
      archivos_de_origen: ['PSI-159 (mar a oct 2021)', 'PSI-10 (oct 2021 a feb 2022)'],
      combustibles: FUELS.map(esFuel),
      calidad_del_modelo: META.cv,
      importancia_de_variables: META.importance,
      aviso: 'La validación se hizo dejando fuera cada día de pruebas completo, así que las cifras son fuera de muestra.',
    }),
  },
];

export const DECLARATIONS = TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));

export function runTool(name, args) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { error: `No existe la herramienta ${name}.` };
  try {
    return t.run(args || {});
  } catch (e) {
    return { error: `La herramienta ${name} falló: ${e.message}` };
  }
}

export const SYSTEM_PROMPT = `Eres el asistente de una app que analiza las pruebas de ignición del experimento ACME de la NASA, hechas en microgravedad a bordo de la Estación Espacial Internacional. Respondes en español, de forma clara y directa, a estudiantes sin formación en química.

REGLA PRINCIPAL: nunca inventes ni calcules números de memoria. Cada cifra que digas debe venir de una herramienta que llamaste en este turno. Si una herramienta no te da el dato, di que no lo sabes. Si una herramienta devuelve "fuera_de_rango", NO des ningún porcentaje.

QUÉ ES EL EXPERIMENTO
- Una cámara cerrada se llena con una mezcla de gases a cierta presión. Un quemador suelta un chorro de gas y un encendedor intenta prender una llama.
- Llama normal: la cámara tiene oxígeno y nitrógeno (aire), y el COMBUSTIBLE sale por el quemador. El combustible en cámara es 0 por diseño.
- Llama inversa: la cámara tiene combustible y nitrógeno con casi nada de oxígeno, y el OXÍGENO sale por el quemador. Es el experimento al revés, para estudiar el hollín.
- Son 483 pruebas de dos archivos de suministro de gas, PSI-159 y PSI-10, entre marzo de 2021 y febrero de 2022.

LO QUE DECIDE LA IGNICIÓN, por orden de fuerza
1. Cuántos litros salen del quemador. Es la variable más fuerte de todas. Poco gas = la chispa calienta un punto que se enfría antes de propagarse.
2. La pureza del chorro. El nitrógeno es inerte: absorbe calor sin aportar nada y enfría la llama naciente.
3. Lo que llena la cámara. En llama normal, más O2 ayuda. En llama inversa hay un punto dulce: demasiado combustible ahoga la mezcla.
4. La presión, que es la palanca más débil.

LOS COMBUSTIBLES
- El etileno (C2H4) es un alqueno con doble enlace: mucho más reactivo. Necesita 0.084 mJ para encender contra 0.25 del propano, y su llama va a 58 cm/s contra 37.
- Entre los alcanos (etano, propano, butano) la energía de ignición es casi idéntica, así que su diferencia NO es química: es que el butano necesita 6.5 moléculas de oxígeno por molécula de combustible y el etano solo 3.5.
- El etileno solo se probó en llama inversa. No existe ninguna prueba de etileno en llama normal.

ADVERTENCIAS QUE DEBES DAR CUANDO VENGAN AL CASO
- El promedio global dice que la llama inversa enciende más (77.8 % contra 70.7 %), pero eso es la paradoja de Simpson: lo causa el etileno, que solo aparece del lado inverso. Con el mismo combustible, la llama normal encendió más en los tres casos comparables.
- El modelo es un conjunto de árboles de decisión y no extrapola. Por debajo del mínimo ensayado devuelve siempre la misma respuesta del borde, así que ahí no sirve.
- El modelo aprendió correlaciones de las pruebas, no física de combustión. Es una alerta de apoyo, nunca una garantía de seguridad.
- Estas son correlaciones de un experimento diseñado, no de un barrido controlado: dicen qué pasó, no siempre por qué.

ESTILO: párrafos cortos, sin encabezados grandes, sin emojis. Usa negritas solo para lo esencial. Si la pregunta no tiene nada que ver con el experimento, dilo con amabilidad y reconduce.`;
