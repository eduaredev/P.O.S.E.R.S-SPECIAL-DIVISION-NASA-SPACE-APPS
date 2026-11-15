/**
 * Cliente de Google Gemini con llamada a herramientas.
 *
 * La clave NUNCA se guarda en el código ni se sube a ningún lado: vive solo en
 * el navegador de quien la escribe (localStorage) y viaja directo a Google.
 */
import { DECLARATIONS, runTool, SYSTEM_PROMPT } from './tools.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const KEY_STORE = 'flame-monitor-gemini-key';
const MODEL_STORE = 'flame-monitor-gemini-model';
const MAX_ROUNDS = 6;

const get = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const put = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* modo privado */ } };

export const loadKey = () => get(KEY_STORE);
export const saveKey = (k) => put(KEY_STORE, k);
export const loadModel = () => get(MODEL_STORE);
export const saveModel = (m) => put(MODEL_STORE, m);

/** Modelos que no sirven para conversar con herramientas. */
const UNUSABLE = /embedding|aqa|imagen|veo|image-gen|tts|audio|live|vision/i;

/**
 * Puntúa cada modelo para elegir el mejor automáticamente.
 * Los nombres de Google cambian con el tiempo, así que no se codifican: se piden.
 */
function score(name) {
  const n = name.toLowerCase();
  let s = 0;
  if (n.includes('flash')) s += 100;      // rápido y con cuota gratuita amplia
  else if (n.includes('pro')) s += 60;
  if (n.includes('lite')) s -= 40;        // más barato pero peor usando herramientas
  if (/preview|exp/.test(n)) s -= 15;     // puede desaparecer sin aviso
  // La versión puede venir como "3" o como "2.5": el minor es opcional.
  const v = n.match(/gemini-(\d+)(?:\.(\d+))?/);
  if (v) s += Number(v[1]) * 20 + Number(v[2] || 0);
  return s;
}

/** Pregunta a Google qué modelos admite esta clave. Devuelve los usables, mejor primero. */
export async function listModels(key, signal) {
  const res = await fetch(`${BASE}?key=${encodeURIComponent(key)}&pageSize=200`, { signal });
  if (!res.ok) {
    const e = new Error((await res.text().catch(() => '')).slice(0, 300) || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  const data = await res.json();
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => !UNUSABLE.test(n))
    .sort((a, b) => score(b) - score(a));
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** Saca el mensaje legible del JSON de error de Google. */
const detail = (txt) => {
  try { return JSON.parse(txt)?.error?.message || ''; } catch { return ''; }
};

/**
 * Una llamada, con reintentos. Los 429 y los 5xx de Gemini suelen ser pasajeros
 * ("el modelo está saturado"), así que rendirse al primer intento era un error.
 */
async function post(model, key, body, signal, tries = 3) {
  for (let i = 0; ; i += 1) {
    const res = await fetch(`${BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) return res.json();

    const txt = await res.text().catch(() => '');
    if ((res.status === 429 || res.status >= 500) && i < tries - 1) {
      await sleep(800 * 2 ** i);
      continue;
    }
    const err = new Error(detail(txt) || txt.slice(0, 300) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
}

/**
 * Elige modelo: el que el usuario fijó, o el mejor que Google diga que admite la clave.
 * Si uno responde 404 se vuelve a consultar la lista, por si el nombre quedó viejo.
 */
let working = null;
let cache = null;

async function candidates(key, signal) {
  const chosen = loadModel();
  if (chosen) return [chosen];
  if (!cache) cache = await listModels(key, signal);
  if (!cache.length) throw new Error('Tu clave no tiene ningún modelo de texto disponible.');
  return working ? [working, ...cache.filter((m) => m !== working)] : cache;
}

async function send(key, body, signal) {
  const list = (await candidates(key, signal)).slice(0, 6);
  let last;
  for (const m of list) {
    try {
      const out = await post(m, key, body, signal);
      working = m;
      return out;
    } catch (e) {
      last = e;
      // 404: ese nombre no existe para esta clave. 5xx: ese modelo está saturado.
      // En los dos casos vale la pena probar con otro. Lo demás es un error real.
      if (e.status === 404) cache = null;
      else if (e.status < 500) throw e;
    }
  }
  throw last;
}

/** Qué modelo se está usando, para mostrarlo en la interfaz. */
export const currentModel = () => loadModel() || working || '';

const friendly = (e) => {
  if (e.name === 'AbortError') return 'Consulta cancelada.';
  const m = String(e.message || '');
  if (e.status === 400 && /API key not valid|API_KEY_INVALID/i.test(m)) return 'La clave no es válida. Revísala en Google AI Studio.';
  if (e.status === 403) return 'Google rechazó la clave. Comprueba que la API de Gemini esté habilitada para ella.';
  if (e.status === 429) return `Te pasaste del límite gratuito de Google por ahora. Espera un minuto y reintenta. Google dijo: ${m}`;
  if (e.status >= 500) return `Los modelos de Google están saturados ahora mismo. Lo reintenté varias veces y probé con otros modelos de tu cuenta, y todos respondieron igual, así que no es tu clave ni la app: espera unos minutos. Google dijo: ${m}`;
  if (/Failed to fetch|NetworkError/i.test(m)) return 'No hubo conexión con Google. Revisa tu internet.';
  return `Error al consultar Gemini: ${m}`;
};

/**
 * Hace la pregunta y devuelve { text, tools } o { error }.
 * `history` son turnos previos en formato Gemini.
 */
export async function askGemini(key, question, history = [], signal) {
  const contents = [...history, { role: 'user', parts: [{ text: question }] }];
  const used = [];
  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const data = await send(key, {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        tools: [{ functionDeclarations: DECLARATIONS }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1400 },
      }, signal);

      const cand = data?.candidates?.[0];
      const parts = cand?.content?.parts || [];
      const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);

      if (!calls.length) {
        const text = parts.map((p) => p.text).filter(Boolean).join('\n').trim();
        if (!text) {
          const why = cand?.finishReason;
          return { error: why === 'SAFETY' ? 'Google bloqueó la respuesta por sus filtros de contenido.' : 'Gemini devolvió una respuesta vacía. Reintenta.' };
        }
        return { text, tools: used, history: [...contents, { role: 'model', parts: [{ text }] }] };
      }

      contents.push({ role: 'model', parts: calls.map((fc) => ({ functionCall: fc })) });
      contents.push({
        role: 'user',
        parts: calls.map((fc) => {
          used.push(fc.name);
          return { functionResponse: { name: fc.name, response: { resultado: runTool(fc.name, fc.args) } } };
        }),
      });
    }
    return { error: 'La consulta dio demasiadas vueltas sin llegar a una respuesta. Reformula la pregunta.' };
  } catch (e) {
    if (e.status === 404) {
      // El nombre del modelo quedó viejo: di cuáles existen de verdad en esta cuenta.
      const ok = await listModels(key).catch(() => []);
      return {
        error: ok.length
          ? `Ese modelo no existe para tu clave. Elige uno en la lista de arriba; el mejor disponible parece ${ok[0]}.`
          : 'Tu clave no tiene ningún modelo de texto disponible. Revísala en Google AI Studio.',
        models: ok,
      };
    }
    return { error: friendly(e) };
  }
}
