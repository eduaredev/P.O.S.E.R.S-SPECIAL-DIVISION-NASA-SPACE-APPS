import { useEffect, useRef, useState } from 'react';
import { answer, SUGGESTIONS } from '../lib/chat.js';
import { DATA } from '../lib/data.js';
import { askGemini, loadKey, saveKey, listModels, loadModel, saveModel } from '../lib/llm.js';

/** Markdown mínimo: negritas y viñetas. Suficiente para lo que devuelve el modelo. */
function Rich({ text }) {
  const bold = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**')
    ? <b key={i}>{p.slice(2, -2)}</b> : p));
  const out = [];
  let bullets = [];
  const flush = () => { if (bullets.length) { out.push(<ul key={`u${out.length}`}>{bullets.map((b, i) => <li key={i}>{bold(b)}</li>)}</ul>); bullets = []; } };
  text.split('\n').forEach((raw) => {
    const l = raw.trim();
    if (/^[-*•]\s+/.test(l)) bullets.push(l.replace(/^[-*•]\s+/, ''));
    else { flush(); if (l) out.push(<p key={`p${out.length}`}>{bold(l.replace(/^#+\s*/, ''))}</p>); }
  });
  flush();
  return out;
}

function Blocks({ blocks, onAction, onAsk }) {
  return blocks.map((b, i) => {
    switch (b.t) {
      case 'p': return <p key={i}>{b.text}</p>;
      case 'md': return <Rich key={i} text={b.text} />;
      case 'tools': return <p key={i} className="toolnote">Consultó: {b.names.join(', ')}</p>;
      case 'term': return <p key={i}><b>{b.title}.</b> {b.text}</p>;
      case 'list': return <ul key={i}>{b.items.map((x) => <li key={x}>{x}</li>)}</ul>;
      case 'stat': return <div key={i} className="stat"><b>{b.big}</b><span>{b.label}. {b.sub}</span></div>;
      case 'table': return (
        <table key={i}>
          <thead><tr>{b.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{b.rows.map((r) => <tr key={r[0]}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      );
      case 'rows': return (
        <div key={i} style={{ display: 'grid', gap: 5 }}>
          {b.rows.map((r) => <button type="button" key={r.id} className="rowlink" onClick={() => onAction({ action: 'load', row: r.id })}><b>{r.tpid}</b>{r.text}</button>)}
        </div>
      );
      case 'actions': return (
        <div key={i} className="acts">
          {b.items.map((a) => <button type="button" key={a.label} className="btn ghost small" onClick={() => onAction(a)}>{a.label}</button>)}
        </div>
      );
      case 'suggest': return (
        <div key={i} className="acts">{SUGGESTIONS.slice(0, 4).map((s) => <button type="button" key={s} className="chip" onClick={() => onAsk(s)}>{s}</button>)}</div>
      );
      default: return null;
    }
  });
}

const HELLO = { role: 'bot', blocks: [{ t: 'p', text: 'Hola. Pregúntame por las pruebas de NASA: puedo contar, filtrar, comparar, explicar términos y estimar un escenario.' }] };

export default function Chat({ onFilters, onLoadRow, onLoadParams }) {
  const [msgs, setMsgs] = useState([HELLO]);
  const [text, setText] = useState('');
  const [key, setKey] = useState(loadKey);
  const [setup, setSetup] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(loadModel);
  const [probe, setProbe] = useState('');
  const hist = useRef([]);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);

  // Los nombres de modelo de Google cambian; se preguntan en vez de codificarlos.
  useEffect(() => {
    if (key.length < 20) { setModels([]); setProbe(''); return undefined; }
    let alive = true;
    const t = setTimeout(async () => {
      setProbe('buscando…');
      try {
        const list = await listModels(key);
        if (!alive) return;
        setModels(list);
        setProbe(list.length ? '' : 'tu clave no tiene modelos de texto');
      } catch (e) {
        if (alive) { setModels([]); setProbe(e.status === 400 || e.status === 403 ? 'clave rechazada por Google' : 'no se pudo consultar la lista'); }
      }
    }, 600);
    return () => { alive = false; clearTimeout(t); };
  }, [key]);

  const ask = async (q) => {
    const t = q.trim();
    if (!t || busy) return;
    setText('');
    // Un solo asistente: usa Gemini si hay clave, y si no (o si falla) responde con reglas.
    if (!aiReady) { setMsgs((m) => [...m, { role: 'user', text: t }, { role: 'bot', ...answer(t) }]); return; }

    setMsgs((m) => [...m, { role: 'user', text: t }]);
    setBusy(true);
    const r = await askGemini(key, t, hist.current);
    setBusy(false);
    if (r.error) {
      if (r.models?.length) setModels(r.models);
      // Si la IA falla, el asistente de reglas responde igual. La app nunca se queda muda.
      setMsgs((m) => [...m, {
        role: 'bot',
        blocks: [{ t: 'p', text: `${r.error} Te respondo con el asistente de reglas:` }, ...answer(t).blocks],
      }]);
      return;
    }
    hist.current = (r.history || []).slice(-12);
    setMsgs((m) => [...m, { role: 'bot', blocks: [{ t: 'md', text: r.text }, ...(r.tools.length ? [{ t: 'tools', names: [...new Set(r.tools)] }] : [])] }]);
  };

  const act = (a) => {
    if (a.action === 'filters') onFilters(a.filters);
    if (a.action === 'load') onLoadRow(DATA[a.row]);
    if (a.action === 'loadParams') onLoadParams(a.params);
  };

  const aiReady = key.trim().length > 20;

  return (
    <aside className="panel chat" aria-label="Asistente">
      <header>
        <div className="chead">
          <h2>Asistente de datos</h2>
          <button type="button" className="btn ghost small" aria-expanded={setup}
            onClick={() => { setSetup((v) => !v); setShowKey(false); }}>
            {aiReady ? 'IA conectada' : 'Conectar IA'}
          </button>
        </div>
        <p>
          {aiReady
            ? 'Entiende preguntas libres. Los números los calcula esta app con sus propias herramientas, no el modelo.'
            : 'Responde sobre este dataset sin internet. Conecta una clave de Gemini para poder preguntarle lo que quieras.'}
        </p>
        {setup && (
          <div className="keybox">
            <label htmlFor="gkey">Tu clave de Google AI Studio</label>
            <div className="keyrow">
              <input id="gkey" type={showKey ? 'text' : 'password'} value={key} placeholder="AIza..."
                autoComplete="off" spellCheck="false"
                onChange={(e) => { setKey(e.target.value.trim()); saveKey(e.target.value.trim()); }} />
              <button type="button" className="btn ghost small" onClick={() => setShowKey((v) => !v)}>{showKey ? 'Ocultar' : 'Ver'}</button>
            </div>
            <p className="hint tight">Se guarda solo en este navegador y viaja directo a Google. Consíguela gratis en aistudio.google.com/apikey. Déjala vacía para usar solo las reglas.</p>
            {(models.length > 0 || probe) && (
              <>
                <label htmlFor="gmodel">Modelo {probe && <span className="toolnote">{probe}</span>}</label>
                <select id="gmodel" value={model} onChange={(e) => { setModel(e.target.value); saveModel(e.target.value); }} disabled={!models.length}>
                  <option value="">Elegir automáticamente{models.length ? ` (${models[0]})` : ''}</option>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </>
            )}
          </div>
        )}
      </header>
      <div className="msgs" role="log" aria-live="polite">
        {msgs.map((m, i) => (m.role === 'user'
          ? <div key={i} className="msg user">{m.text}</div>
          : <div key={i} className="msg bot"><Blocks blocks={m.blocks} onAction={act} onAsk={ask} /></div>))}
        {busy && <div className="msg bot pending">Consultando el dataset…</div>}
        <div ref={end} />
      </div>
      {msgs.length < 3 && !busy && (
        <div className="suggest">{SUGGESTIONS.map((s) => <button type="button" key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}</div>
      )}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={busy ? 'Esperando respuesta…' : 'Escribe tu pregunta'} aria-label="Escribe tu pregunta" disabled={busy} />
        <button type="submit" className="btn" disabled={busy}>Enviar</button>
      </form>
    </aside>
  );
}
