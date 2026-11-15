import { useEffect, useMemo, useState } from 'react';
import { DATA, VAR, META, comboKey, fmt, varsFor } from '../lib/data.js';
import { predict } from '../lib/model.js';

const W = 640, H = 400, ML = 58, MR = 14, MT = 12, MB = 46, NX = 26, NY = 18;
const PW = W - ML - MR, PH = H - MT - MB;

function axisRange(key, params) {
  const v = VAR[key];
  const r = META.ranges[comboKey(params.fuel, params.inverse)];
  if (!r) return [v.min, v.max];
  const [lo, hi] = r[v.row];
  const span = hi - lo;
  if (span < (v.max - v.min) * 0.02) return [v.min, v.min + (v.max - v.min) * 0.5];
  return [Math.max(v.min, lo - span * 0.12), Math.min(v.max, hi + span * 0.12)];
}

export default function Heatmap({ params, onPick }) {
  // Ejes por defecto = las variables que más mueven al modelo en cada tipo de llama.
  const defaults = (inv) => (inv ? ['o2L', 'Xfuel'] : ['fuelL', 'O2']);
  const [xKey, setX] = useState(() => defaults(params.inverse)[0]);
  const [yKey, setY] = useState(() => defaults(params.inverse)[1]);
  const [hover, setHover] = useState(null);
  useEffect(() => { const [a, b] = defaults(params.inverse); setX(a); setY(b); }, [params.inverse]);

  const [x0, x1] = axisRange(xKey, params);
  const [y0, y1] = axisRange(yKey, params);
  const sx = (v) => ML + ((v - x0) / (x1 - x0)) * PW;
  const sy = (v) => MT + PH - ((v - y0) / (y1 - y0)) * PH;

  const cells = useMemo(() => {
    const out = [];
    for (let i = 0; i < NX; i += 1) {
      for (let j = 0; j < NY; j += 1) {
        const xv = x0 + ((i + 0.5) / NX) * (x1 - x0);
        const yv = y0 + ((j + 0.5) / NY) * (y1 - y0);
        out.push({ i, j, xv, yv, p: predict({ ...params, [xKey]: xv, [yKey]: yv }) });
      }
    }
    return out;
  }, [params, xKey, yKey, x0, x1, y0, y1]);

  const real = DATA.filter((r) => r.fuel === params.fuel && r.is_inverse === params.inverse);
  const inX = (v) => v >= x0 && v <= x1;
  const cx = Math.min(x1, Math.max(x0, params[xKey]));
  const cy = Math.min(y1, Math.max(y0, params[yKey]));
  const ticks = (a, b) => Array.from({ length: 5 }, (_, k) => a + ((b - a) * k) / 4);
  const tl = (key, v) => (v * VAR[key].scale).toFixed(VAR[key].scale === 100 ? 0 : key === 'P' ? 0 : 2);
  const cw = PW / NX, ch = PH / NY;

  return (
    <section className="panel">
      <h2>Mapa de riesgo: qué pasa si cambian dos parámetros</h2>
      <p className="hint">Cada celda es la probabilidad de ignición con el resto de parámetros fijos. Los puntos son pruebas reales de NASA para este caso. Haz clic en una celda para mover tu escenario.</p>
      <div className="chart-head">
        <div className="field">
          <label htmlFor="hx">Eje horizontal</label>
          <select id="hx" value={xKey} onChange={(e) => setX(e.target.value)}>
            {varsFor(params.inverse).filter((v) => v.key !== yKey).map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="hy">Eje vertical</label>
          <select id="hy" value={yKey} onChange={(e) => setY(e.target.value)}>
            {varsFor(params.inverse).filter((v) => v.key !== xKey).map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
        </div>
      </div>

      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Mapa de probabilidad de ignición según ${VAR[xKey].label} y ${VAR[yKey].label}`}
        onMouseLeave={() => setHover(null)}>
        <g data-anchor="celdas">
          {cells.map((c) => (
            <rect key={`${c.i}-${c.j}`} x={ML + c.i * cw} y={MT + PH - (c.j + 1) * ch} width={cw + 0.4} height={ch + 0.4}
              fill={`color-mix(in oklab, var(--heat) ${Math.round(c.p * 100)}%, var(--surface))`}
              onMouseMove={() => setHover(c)} onClick={() => onPick({ [xKey]: c.xv, [yKey]: c.yv })} style={{ cursor: 'pointer' }}>
              <title>{`${VAR[xKey].label} ${fmt(xKey, c.xv)}, ${VAR[yKey].label} ${fmt(yKey, c.yv)}: ${(c.p * 100).toFixed(0)} % de ignición`}</title>
            </rect>
          ))}
        </g>
        <rect x={ML} y={MT} width={PW} height={PH} fill="none" stroke="var(--axis)" />
        {ticks(x0, x1).map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={MT + PH} y2={MT + PH + 4} stroke="var(--axis)" />
            <text x={sx(t)} y={MT + PH + 17} textAnchor="middle">{tl(xKey, t)}</text>
          </g>
        ))}
        {ticks(y0, y1).map((t) => (
          <g key={`y${t}`}>
            <line x1={ML - 4} x2={ML} y1={sy(t)} y2={sy(t)} stroke="var(--axis)" />
            <text x={ML - 8} y={sy(t) + 4} textAnchor="end">{tl(yKey, t)}</text>
          </g>
        ))}
        <text x={ML + PW / 2} y={H - 8} textAnchor="middle" className="t-ink">{VAR[xKey].label} ({VAR[xKey].unit})</text>
        <text transform={`translate(14 ${MT + PH / 2}) rotate(-90)`} textAnchor="middle" className="t-ink">{VAR[yKey].label} ({VAR[yKey].unit})</text>

        <g data-anchor="pruebas-reales">
          {real.filter((r) => inX(r[VAR[xKey].row]) && r[VAR[yKey].row] >= y0 && r[VAR[yKey].row] <= y1).map((r) => (
            <circle key={r.id} cx={sx(r[VAR[xKey].row])} cy={sy(r[VAR[yKey].row])} r="4.6"
              fill={r.ignite ? 'var(--ink)' : 'var(--surface)'} stroke={r.ignite ? 'var(--surface)' : 'var(--ink)'} strokeWidth={r.ignite ? 1.5 : 1.8}>
              <title>{`${r.tpid}: ${r.ignite ? 'encendió' : 'no encendió'}`}</title>
            </circle>
          ))}
        </g>
        <g data-anchor="tu-escenario">
          <polygon points={`${sx(cx)},${sy(cy) - 10} ${sx(cx) + 10},${sy(cy)} ${sx(cx)},${sy(cy) + 10} ${sx(cx) - 10},${sy(cy)}`}
            fill="var(--accent)" stroke="#fff" strokeWidth="2" />
        </g>
      </svg>

      <p className="readline">
        {hover
          ? `${VAR[xKey].label} ${fmt(xKey, hover.xv)}, ${VAR[yKey].label} ${fmt(yKey, hover.yv)}: ${(hover.p * 100).toFixed(0)} % de ignición`
          : 'Pasa el cursor sobre el mapa para leer cada celda.'}
      </p>
      <div className="legend">
        <span><svg width="64" height="10" style={{ verticalAlign: -1, marginRight: 6 }} aria-hidden="true"><defs><linearGradient id="hg"><stop offset="0" style={{ stopColor: 'var(--surface)' }} /><stop offset="1" style={{ stopColor: 'var(--heat)' }} /></linearGradient></defs><rect width="64" height="10" fill="url(#hg)" stroke="var(--axis)" /></svg>0 % a 100 % de ignición</span>
        <span><i className="dot yes" />encendió (real)</span>
        <span><i className="dot no" />no encendió (real)</span>
        <span><svg width="12" height="12" viewBox="0 0 12 12" style={{ verticalAlign: -2, marginRight: 6 }} aria-hidden="true"><polygon points="6,0 12,6 6,12 0,6" fill="var(--accent)" /></svg>tu escenario</span>
      </div>
    </section>
  );
}
