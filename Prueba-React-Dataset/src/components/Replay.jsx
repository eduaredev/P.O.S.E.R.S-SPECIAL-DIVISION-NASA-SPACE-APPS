import { useEffect, useMemo, useState } from 'react';
import { SESSIONS, FUEL_ES } from '../lib/data.js';
import { Shape } from './Result.jsx';

const W = 760, H = 270, ML = 46, MR = 16, MT = 14, MB = 36;
const PW = W - ML - MR, PH = H - MT - MB;

const defaultSession = () => (SESSIONS.find((s) => s.rows.length >= 14 && Math.abs(s.rows.filter((r) => r.ignite).length / s.rows.length - 0.5) < 0.12) || SESSIONS[0]).session;

function classify(r, threshold) {
  const alert = r.prob_cv >= threshold;
  if (alert && r.ignite) return { id: 'tp', text: 'Aviso correcto', shape: 'triangle', color: 'var(--good)' };
  if (alert && !r.ignite) return { id: 'fp', text: 'Falsa alarma', shape: 'diamond', color: 'var(--warn)' };
  if (!alert && r.ignite) return { id: 'fn', text: 'Ignición sin aviso', shape: 'square', color: 'var(--crit)' };
  return { id: 'tn', text: 'Sin novedad', shape: 'circle', color: 'var(--grid)' };
}

export default function Replay({ threshold, onThreshold, onLoadRow }) {
  const [sid, setSid] = useState(defaultSession);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const session = SESSIONS.find((s) => s.session === Number(sid));
  const rows = session.rows;
  const n = rows.length;

  useEffect(() => { setIdx(0); setPlaying(false); }, [sid]);
  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setIdx((i) => { if (i >= n) { setPlaying(false); return i; } return i + 1; }), 750);
    return () => clearInterval(t);
  }, [playing, n]);

  const shown = rows.slice(0, idx);
  const cls = useMemo(() => shown.map((r) => classify(r, threshold)), [shown, threshold]);
  const count = (id) => cls.filter((c) => c.id === id).length;
  const sx = (i) => ML + (n === 1 ? PW / 2 : (i / (n - 1)) * PW);
  const sy = (p) => MT + PH - p * PH;
  const last = shown[shown.length - 1];

  return (
    <section className="panel">
      <h2>Monitor en vivo: repetición de un día real de pruebas</h2>
      <p className="hint">Reproduce las pruebas de un día en orden. La línea es la probabilidad que el modelo habría dado sin haber visto ese día (columna prob_cv); el punto lleno indica que realmente encendió.</p>
      <div className="replay-top">
        <div className="field" style={{ minWidth: 260 }}>
          <label htmlFor="sess">Día de pruebas</label>
          <select id="sess" value={sid} onChange={(e) => setSid(e.target.value)}>
            {SESSIONS.map((s) => <option key={s.session} value={s.session}>{s.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ minWidth: 200 }}>
          <label htmlFor="thr">Umbral de alarma <span className="val">{(threshold * 100).toFixed(0)} %</span></label>
          <input id="thr" type="range" min="0.1" max="0.9" step="0.05" value={threshold} onChange={(e) => onThreshold(parseFloat(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
        </div>
        <button type="button" className="btn" onClick={() => { if (idx >= n) setIdx(0); setPlaying((p) => !p); }}>{playing ? 'Pausar' : idx >= n ? 'Repetir' : 'Reproducir'}</button>
        <button type="button" className="btn ghost" onClick={() => setIdx((i) => Math.min(n, i + 1))} disabled={idx >= n}>Siguiente prueba</button>
        <button type="button" className="btn ghost" onClick={() => { setIdx(0); setPlaying(false); }}>Reiniciar</button>
      </div>

      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Probabilidad de ignición estimada para las pruebas del día ${session.date}`}>
        <rect x={ML} y={sy(1)} width={PW} height={sy(threshold) - sy(1)} fill="var(--crit)" opacity="0.07" />
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={ML} x2={ML + PW} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" />
            <text x={ML - 8} y={sy(t) + 4} textAnchor="end">{(t * 100).toFixed(0)} %</text>
          </g>
        ))}
        <line x1={ML} x2={ML + PW} y1={sy(threshold)} y2={sy(threshold)} stroke="var(--ink)" strokeDasharray="5 4" />
        <text x={ML + PW} y={sy(threshold) - 6} textAnchor="end" className="t-ink">Umbral {(threshold * 100).toFixed(0)} %</text>
        {rows.map((r, i) => (i % (n > 16 ? 2 : 1) === 0) && (
          <text key={`l${r.id}`} x={sx(i)} y={H - 14} textAnchor="middle" fontSize="10.5">{r.tpid.slice(5)}</text>
        ))}
        <polyline fill="none" stroke="var(--axis)" strokeWidth="1.5" points={shown.map((r, i) => `${sx(i)},${sy(r.prob_cv)}`).join(' ')} />
        {shown.map((r, i) => (
          <circle key={r.id} cx={sx(i)} cy={sy(r.prob_cv)} r="6.5" fill={r.ignite ? 'var(--ink)' : 'var(--surface)'}
            stroke={r.ignite ? 'var(--surface)' : 'var(--ink)'} strokeWidth={r.ignite ? 2 : 2}>
            <title>{`${r.tpid}: modelo ${(r.prob_cv * 100).toFixed(0)} %, ${r.ignite ? 'encendió' : 'no encendió'}`}</title>
          </circle>
        ))}
        {last && <circle cx={sx(idx - 1)} cy={sy(last.prob_cv)} r="11" fill="none" stroke="var(--accent)" strokeWidth="2.5" />}
      </svg>
      <div className="legend">
        <span><i className="dot yes" />encendió</span>
        <span><i className="dot no" />no encendió</span>
        <span>Eje horizontal: pruebas del día en orden (sufijo del TPID)</span>
      </div>

      <div className="kpis">
        <span><b>{idx}</b>de {n} pruebas</span>
        <span><b>{count('tp')}</b>avisos correctos</span>
        <span><b>{count('fp')}</b>falsas alarmas</span>
        <span><b>{count('fn')}</b>igniciones sin aviso</span>
        {last && <button type="button" className="btn ghost small" onClick={() => onLoadRow(last)}>Cargar la prueba {last.tpid} en el simulador</button>}
      </div>

      <ul className="feed" aria-live="polite">
        {[...shown].reverse().map((r, k) => {
          const c = classify(r, threshold);
          return (
            <li key={r.id}>
              <Shape shape={c.shape} color={c.color} size={14} />
              <b>{r.tpid}</b>
              <span>{c.text}: el modelo dio {(r.prob_cv * 100).toFixed(0)} % y {r.ignite ? 'sí encendió' : 'no encendió'} ({FUEL_ES[r.fuel].toLowerCase()}, {r.P_psia.toFixed(1)} psia){k === 0 ? '' : ''}</span>
            </li>
          );
        })}
        {!shown.length && <li style={{ gridTemplateColumns: '1fr', color: 'var(--ink-2)' }}>Pulsa Reproducir para ver las pruebas llegar una a una.</li>}
      </ul>
    </section>
  );
}
