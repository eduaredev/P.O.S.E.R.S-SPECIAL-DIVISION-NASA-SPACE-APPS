import { useEffect, useMemo, useRef, useState } from 'react'
import { FUELS, GASES, calcular } from '../lib/incendio.js'

function Slider({ label, val, max, onChange }) {
  return (
    <label className="sl">
      <span>{label}</span>
      <output>{val}</output>
      <input type="range" min="0" max={max} step="0.5" value={val} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </label>
  )
}

const f1 = (v) => v.toFixed(1) + ' %'

export default function CalculadoraIncendio({ oculto }) {
  const [sel, setSel] = useState(['metano'])
  const [amt, setAmt] = useState({ etileno: 5, metano: 5, propano: 5, butano: 5, etano: 5 })
  const [gas, setGas] = useState({ o2: 21, n2: 79, he: 0, co2: 0 })
  const dd = useRef(null)

  // Cierra la lista desplegable al hacer clic fuera.
  useEffect(() => {
    const h = (e) => { if (dd.current?.open && !dd.current.contains(e.target)) dd.current.open = false }
    document.addEventListener('click', h)
    return () => document.removeEventListener('click', h)
  }, [])

  const r = useMemo(() => calcular(sel, amt, gas), [sel, amt, gas])
  const alternar = (k) => setSel((s) => Object.keys(FUELS).filter((x) => (x === k ? !s.includes(k) : s.includes(x))))

  const segs = []
  if (r.F) segs.push({ n: 'Combustible', v: r.F, c: 'var(--red)' })
  Object.keys(GASES).forEach((k) => gas[k] > 0 && segs.push({ n: GASES[k].n, v: gas[k], c: GASES[k].c }))

  return (
    <section className="calc" hidden={oculto}>
      <div className="p">
        <h2>Mezcla de gases</h2>
        <p className="sub">Elige los combustibles y ajusta las cantidades. Lo que importa es la proporción entre ellas.</p>
        <h4>Tipo de combustible</h4>
        <details className="dd" ref={dd}>
          <summary>{sel.length ? sel.map((k) => FUELS[k].n).join(', ') : 'Selecciona combustibles'}</summary>
          <div className="opts">
            {Object.keys(FUELS).map((k) => (
              <label key={k}><input type="checkbox" checked={sel.includes(k)} onChange={() => alternar(k)} />{FUELS[k].n}</label>
            ))}
          </div>
        </details>
        {sel.length ? (
          sel.map((k) => <Slider key={k} label={FUELS[k].n + ' (moles)'} val={amt[k]} max={50} onChange={(v) => setAmt((a) => ({ ...a, [k]: v }))} />)
        ) : (
          <p className="sub" style={{ marginTop: 12 }}>Elige al menos un combustible en la lista.</p>
        )}
        <h4>Otros gases</h4>
        {Object.keys(GASES).map((k) => (
          <Slider key={k} label={GASES[k].n + ' (moles)'} val={gas[k]} max={100} onChange={(v) => setGas((g) => ({ ...g, [k]: v }))} />
        ))}
      </div>

      <div className="p res" aria-live="polite">
        <h2>Probabilidad de incendio</h2>
        <p className="sub">Si la mezcla encuentra una fuente de ignición</p>
        <div><span className="pct">{r.p} %</span><span className="lvl">{r.nivel}</span></div>
        <div className="gauge"><i style={{ width: r.p + '%' }} /></div>
        <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{r.estado}</p>
        <div className="comp">
          {segs.map((s) => <span key={s.n} title={s.n} style={{ width: (s.v / r.T) * 100 + '%', background: s.c }} />)}
        </div>
        <div className="leg">
          {segs.map((s) => <span key={s.n}><b style={{ background: s.c }} />{s.n} {((s.v / r.T) * 100).toFixed(1)} %</span>)}
        </div>
        {r.ok && (
          <dl>
            <dt>Combustible en la mezcla</dt><dd>{f1(r.yF)}</dd>
            <dt>Límite inferior</dt><dd>{f1(r.lfl)}</dd>
            <dt>Límite superior ajustado</dt><dd>{r.uflE > r.lfl ? f1(r.uflE) : 'sin rango'}</dd>
            <dt>Oxígeno en la mezcla</dt><dd>{f1(r.yO)}</dd>
          </dl>
        )}
        <p className="sub" style={{ marginTop: 14 }}>
          Estimación educativa con la regla de Le Chatelier y límites a 25 °C y 1 atm. No sustituye pruebas de laboratorio ni decisiones de seguridad reales.
        </p>
      </div>
    </section>
  )
}
