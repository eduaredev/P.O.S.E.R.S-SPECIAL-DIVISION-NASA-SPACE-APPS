import { LEVELS, levelOf, levers, predict, blocker, BLOCK_TEXT } from '../lib/model.js';
import { checkRange, nearest, META, VAR } from '../lib/data.js';

export function Shape({ shape, color, size = 14 }) {
  const h = size / 2;
  const props = { fill: color, stroke: 'var(--ink)', strokeWidth: 1 };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {shape === 'circle' && <circle cx={h} cy={h} r={h - 1} {...props} />}
      {shape === 'diamond' && <polygon points={`${h},1 ${size - 1},${h} ${h},${size - 1} 1,${h}`} {...props} />}
      {shape === 'triangle' && <polygon points={`${h},1 ${size - 1},${size - 1} 1,${size - 1}`} {...props} />}
      {shape === 'square' && <rect x="1.5" y="1.5" width={size - 3} height={size - 3} {...props} />}
    </svg>
  );
}

function Ladder({ p, threshold }) {
  const W = 600;
  const x = (v) => v * W;
  let start = 0;
  return (
    <div className="ladder">
      <svg viewBox={`0 0 ${W} 44`} role="img" aria-label={p == null ? 'Escala de riesgo sin marcador: escenario fuera de lo ensayado' : `Escala de riesgo, marcador en ${(p * 100).toFixed(0)} por ciento`}>
        {LEVELS.map((l) => {
          const x0 = start; start = Math.min(1, l.max);
          return (
            <g key={l.id}>
              <rect x={x(x0) + 1} y="14" width={x(start) - x(x0) - 2} height="10" rx="2" fill={l.color} opacity={p == null ? 0.25 : 0.55} />
              <text x={x(x0) + 4} y="40" fontSize="11.5" fill="var(--ink-2)">{l.label}</text>
            </g>
          );
        })}
        <line x1={x(threshold)} x2={x(threshold)} y1="9" y2="29" stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="3 2" />
        {p != null && (
          <>
            <polygon className="mark" points={`${x(p) - 7},1 ${x(p) + 7},1 ${x(p)},13`} fill="var(--ink)" />
            <rect className="mark" x={x(p) - 1.5} y="12" width="3" height="14" fill="var(--ink)" />
          </>
        )}
      </svg>
    </div>
  );
}

const showRange = (key, lo, hi) => {
  const v = VAR[key];
  return `${(lo * v.scale).toFixed(v.dec)} a ${(hi * v.scale).toFixed(v.dec)} ${v.unit}`;
};

export default function Result({ params, threshold, onClamp }) {
  const p = predict(params);
  const lv = levelOf(p);
  const block = blocker(params);
  const chk = checkRange(params);
  const near = nearest(params, 3);
  // Fuera de lo ensayado: sin pruebas de ese combustible/llama, o algún valor fuera del rango real.
  const extrap = !block && (chk.noData || chk.out.length > 0);

  const warns = [];
  if (chk.noData) warns.push(chk.message);
  chk.out.forEach((o) => warns.push(`${o.label}: ${(o.value * VAR[o.key].scale).toFixed(VAR[o.key].dec)} ${VAR[o.key].unit}. NASA ensayó de ${showRange(o.key, o.lo, o.hi)}.`));
  if (!chk.noData && near.far && !chk.out.length) warns.push('Esta combinación de valores no se parece a ninguna prueba real de este caso, aunque cada valor por separado esté en rango. Tómala con cautela.');

  const ls = !extrap && !block ? levers(params, p).filter((l) => l.delta < -0.005).slice(0, 4) : [];
  const alarm = !extrap && !block && p >= threshold;

  return (
    <section className="panel" aria-live="polite">
      <h2>Probabilidad de ignición</h2>
      <p className="hint">Si se activa el encendedor en estas condiciones, ¿qué tan probable es que haya llama?</p>
      <div className="readout">
        <div className={`big${extrap ? ' muted' : ''}`}>{extrap ? '—' : <>{(p * 100).toFixed(0)}<small>%</small></>}</div>
        <div>
          {extrap ? (
            <span className="badge" style={{ borderColor: 'var(--ink-3)' }}><Shape shape="diamond" color="var(--surface)" /> Fuera de lo ensayado</span>
          ) : (
            <span className="badge" style={{ borderColor: lv.color }}><Shape shape={lv.shape} color={lv.color} /> Riesgo {lv.label.toLowerCase()}</span>
          )}
          <p style={{ margin: '8px 0 0', color: 'var(--ink-2)', fontSize: 13 }}>
            {block ? 'Resultado fijado por una regla física, no por el modelo.'
              : extrap ? 'Sin pruebas reales parecidas, el modelo no puede estimar esto. No se muestra un porcentaje para no dar una cifra engañosa.'
                : <>Modelo validado dejando fuera cada día de pruebas: AUC {META.cv['PSI-159'].auc.toFixed(2)} en PSI-159. Es una alerta de apoyo, no una garantía.</>}
          </p>
        </div>
      </div>
      <Ladder p={extrap ? null : p} threshold={threshold} />
      {!extrap && <p className="hint" style={{ margin: '2px 0 0' }}>La línea punteada es tu umbral de alarma ({(threshold * 100).toFixed(0)} %).</p>}

      {extrap && (
        <div className="rule" role="status">
          <b>Qué hacer.</b> Lleva los valores al rango que NASA sí probó para obtener una estimación.{' '}
          <button type="button" className="btn small" style={{ marginLeft: 6 }} onClick={onClamp}>Llevar al rango ensayado</button>
        </div>
      )}
      {alarm && (
        <div className="alert" role="alert">
          <b>Alerta preventiva.</b> El riesgo estimado supera tu umbral. Revisa las palancas de abajo antes de continuar.
        </div>
      )}
      {block && <div className="rule" role="status"><b>Regla física.</b> {BLOCK_TEXT[block]}</div>}
      {warns.length > 0 && !block && <ul className="warns">{warns.map((w) => <li key={w}>{w}</li>)}</ul>}

      {near.rows.length > 0 && !extrap && (
        <>
          <h3 style={{ fontSize: 15, margin: '18px 0 6px' }}>Pruebas reales más parecidas</h3>
          <table className="levers">
            <tbody>
              {near.rows.map(({ r }) => (
                <tr key={r.id}>
                  <td><b>{r.tpid}</b>, {r.date}, {r.P_psia.toFixed(1)} psia{r.is_inverse ? `, comb. ${(r.X_fuel * 100).toFixed(0)} %` : `, O2 ${(r.X_O2 * 100).toFixed(0)} %`}</td>
                  <td><i className={`dot ${r.ignite ? 'yes' : 'no'}`} />{r.ignite ? 'encendió' : 'no encendió'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {ls.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, margin: '18px 0 6px' }}>Palancas de prevención</h3>
          <table className="levers">
            <tbody>
              {ls.map((l) => (
                <tr key={l.id}>
                  <td>{l.label}</td>
                  <td><span className="delta down">{(l.delta * 100).toFixed(0)} pts</span> queda en {(l.prob * 100).toFixed(0)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ margin: '8px 0 0' }}>El modelo aprendió correlaciones de las pruebas, no física de combustión. Valida cualquier cambio antes de aplicarlo.</p>
        </>
      )}
    </section>
  );
}
