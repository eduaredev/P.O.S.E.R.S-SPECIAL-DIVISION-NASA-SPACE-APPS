import { useEffect, useRef, useState } from 'react'

// Reglas del asistente: palabra clave -> respuesta y acción.
// Más adelante esto se puede cambiar por una llamada a un backend con un modelo de lenguaje.
const REGLAS = [
  { re: /mezcla|combustible|inflamab|calcul|probabilidad|metano|propano|butano|etano|etileno/, id: 'calc', r: 'Eso se calcula en la pestaña Riesgo de incendio. Te llevo ahí para que elijas los gases.' },
  { re: /asteroid|neo\b|roca|impacto/, id: 'neo', r: 'Esta semana pasan 36 asteroides cerca de la Tierra y 2 están marcados como potencialmente peligrosos.' },
  { re: /marte|mars|rover/, id: 'mars', r: 'En Marte las máximas rondan los -11 °C y las mínimas los -79 °C.' },
  { re: /solar|llamarada|\bsol\b/, id: 'sun', r: 'Hay 4 eventos solares recientes. El más nuevo es una eyección de masa coronal de hace 3 horas.' },
  { re: /tierra|incendio|volc|hielo|iceberg/, id: 'earth', r: 'Hay 4 eventos naturales abiertos: un incendio, un volcán, una tormenta y un iceberg.' },
  { re: /foto|imagen|apod/, id: 'apod', r: 'Aquí está la imagen astronómica del día.' },
]
const SUGERENCIAS = ['Asteroides cercanos', 'Clima en Marte', 'Actividad solar', 'Eventos en la Tierra', 'Imagen del día', 'Calcular riesgo de incendio']

export default function Chat({ onPanel, onCalculadora }) {
  const [msgs, setMsgs] = useState([{ de: 'bot', t: 'Hola. Dime qué dato quieres ver y lo muestro a la derecha.' }])
  const [txt, setTxt] = useState('')
  const log = useRef(null)

  useEffect(() => { log.current?.scrollTo(0, log.current.scrollHeight) }, [msgs])

  function preguntar(t) {
    setMsgs((m) => [...m, { de: 'me', t }])
    const hit = REGLAS.find((x) => x.re.test(t.toLowerCase()))
    setTimeout(() => {
      if (!hit) {
        setMsgs((m) => [...m, { de: 'bot', t: 'Aún no encuentro eso. Prueba con asteroides, clima de Marte, actividad solar, eventos en la Tierra, imagen del día o calcular riesgo de incendio.' }])
        return
      }
      setMsgs((m) => [...m, { de: 'bot', t: hit.r }])
      hit.id === 'calc' ? onCalculadora() : onPanel(hit.id)
    }, 350)
  }

  function enviar(e) {
    e.preventDefault()
    const t = txt.trim()
    if (t) { setTxt(''); preguntar(t) }
  }

  return (
    <div className="chat" role="region" aria-label="Asistente de búsqueda">
      <h2>Asistente de búsqueda</h2>
      <div id="log" ref={log} aria-live="polite">
        {msgs.map((m, i) => <div key={i} className={'m ' + m.de}>{m.t}</div>)}
      </div>
      <div className="chips">
        {SUGERENCIAS.map((s) => <button key={s} type="button" onClick={() => preguntar(s)}>{s}</button>)}
      </div>
      <form className="send" onSubmit={enviar}>
        <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Escribe qué quieres ver…" aria-label="Mensaje" autoComplete="off" />
        <button>Enviar</button>
      </form>
    </div>
  )
}
