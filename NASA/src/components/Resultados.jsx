import { Barras, Lineas } from './Graficas.jsx'
import { NEO, DIAS, MARTE_MAX, MARTE_MIN, SOLAR, TIERRA } from '../data/ejemplo.js'

const Lista = ({ filas }) => (
  <ul className="ev">
    {filas.map(([a, b]) => (
      <li key={a}><b style={{ fontWeight: 500 }}>{a}</b><span>{b}</span></li>
    ))}
  </ul>
)

// Cada panel que puede pedir el chatbot. Para agregar uno nuevo: añade una entrada aquí y una regla en Chat.jsx.
export const PANELES = {
  neo: {
    titulo: 'Asteroides cercanos',
    sub: 'Objetos que pasan por la Tierra en los próximos 7 días',
    cuerpo: () => (
      <>
        <div className="kpis">
          <div><span className="big">36</span><small>objetos en total</small></div>
          <div><span className="big" style={{ color: 'var(--red)' }}>2</span><small>potencialmente peligrosos</small></div>
        </div>
        <Barras vals={NEO} labels={DIAS} />
      </>
    ),
  },
  mars: {
    titulo: 'Clima en Marte',
    sub: 'Temperatura máxima y mínima por sol (°C)',
    cuerpo: () => <Lineas a={MARTE_MAX} b={MARTE_MIN} />,
  },
  sun: {
    titulo: 'Actividad solar',
    sub: 'Eventos recientes registrados',
    cuerpo: () => <Lista filas={SOLAR} />,
  },
  earth: {
    titulo: 'Eventos en la Tierra',
    sub: 'Fenómenos naturales abiertos ahora',
    cuerpo: () => <Lista filas={TIERRA} />,
  },
  apod: {
    titulo: 'Imagen del día',
    sub: 'Foto astronómica diaria con su explicación',
    ancho: true,
    cuerpo: () => (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,320px) 1fr', gap: 18, alignItems: 'center' }}>
        <svg viewBox="0 0 320 180" style={{ width: '100%', borderRadius: 8, display: 'block' }} role="img" aria-label="Ilustración de un planeta con anillos">
          <rect width="320" height="180" fill="#0B1530" />
          <g fill="#fff" opacity=".8"><circle cx="30" cy="30" r="1.2" /><circle cx="80" cy="140" r="1" /><circle cx="260" cy="40" r="1.4" /><circle cx="290" cy="150" r="1" /><circle cx="140" cy="20" r="1" /></g>
          <circle cx="160" cy="92" r="46" fill="#C98B5B" />
          <ellipse cx="160" cy="92" rx="94" ry="16" fill="none" stroke="#E8D3B0" strokeWidth="5" transform="rotate(-14 160 92)" />
        </svg>
        <div>
          <p style={{ margin: '0 0 6px', fontWeight: 600 }}>Título de la imagen</p>
          <p className="sub" style={{ margin: 0 }}>Descripción de ejemplo. Aquí se conectará la API APOD de NASA.</p>
        </div>
      </div>
    ),
  },
}

export default function Resultados({ ids, foco, onQuitar }) {
  if (!ids.length)
    return (
      <main className="grid">
        <div className="empty"><b>Aún no hay datos en pantalla</b>Pídele algo al asistente, por ejemplo “asteroides cercanos”.</div>
      </main>
    )
  return (
    <main className="grid">
      {ids.map((id) => {
        const p = PANELES[id]
        return (
          <article key={id} className={'p' + (p.ancho ? ' wide' : '') + (foco === id ? ' focus' : '')}>
            <button className="x" aria-label="Quitar panel" onClick={() => onQuitar(id)}>×</button>
            <h3>{p.titulo}</h3>
            <p className="sub">{p.sub}</p>
            {p.cuerpo()}
          </article>
        )
      })}
    </main>
  )
}
