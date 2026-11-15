import { useEffect, useRef, useState } from 'react';
import { answer, SUGGESTIONS } from '../lib/chat.js';
import { DATA } from '../lib/data.js';

function Blocks({ blocks, onAction, onAsk }) {
  return blocks.map((b, i) => {
    switch (b.t) {
      case 'p': return <p key={i}>{b.text}</p>;
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

const HELLO = { role: 'bot', blocks: [{ t: 'p', text: 'Hola. Pregúntame por las pruebas de NASA: puedo contar, filtrar, comparar, explicar términos y estimar un escenario, también fuera de lo ensayado.' }] };

export default function Chat({ onFilters, onLoadRow, onLoadParams }) {
  const [msgs, setMsgs] = useState([HELLO]);
  const [text, setText] = useState('');
  // Último escenario estimado, para seguimientos como "¿y si subo la presión a 30?"
  const ctx = useRef({});
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  const ask = (q) => {
    const t = q.trim();
    if (!t) return;
    setText('');
    const r = answer(t, ctx.current);
    ctx.current = r.ctx;
    setMsgs((m) => [...m, { role: 'user', text: t }, { role: 'bot', blocks: r.blocks }]);
  };

  const act = (a) => {
    if (a.action === 'filters') onFilters(a.filters);
    if (a.action === 'load') onLoadRow(DATA[a.row]);
    if (a.action === 'loadParams') onLoadParams(a.params);
  };

  return (
    <aside className="panel chat" aria-label="Asistente">
      <header>
        <h2>Asistente de datos</h2>
        <p>Funciona sin internet, dentro de esta app. Los números salen de las mismas herramientas que usa el simulador; debajo de cada respuesta se ve cuál consultó.</p>
      </header>
      <div className="msgs" role="log" aria-live="polite">
        {msgs.map((m, i) => (m.role === 'user'
          ? <div key={i} className="msg user">{m.text}</div>
          : <div key={i} className="msg bot"><Blocks blocks={m.blocks} onAction={act} onAsk={ask} /></div>))}
        <div ref={end} />
      </div>
      {msgs.length < 3 && (
        <div className="suggest">{SUGGESTIONS.map((s) => <button type="button" key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}</div>
      )}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe tu pregunta" aria-label="Escribe tu pregunta" />
        <button type="submit" className="btn">Enviar</button>
      </form>
    </aside>
  );
}
