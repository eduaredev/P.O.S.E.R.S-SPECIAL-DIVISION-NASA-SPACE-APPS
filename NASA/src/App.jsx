import { useState } from 'react'
import Chat from './components/Chat.jsx'
import Resultados from './components/Resultados.jsx'
import CalculadoraIncendio from './components/CalculadoraIncendio.jsx'

export default function App() {
  const [tab, setTab] = useState(1)
  const [paneles, setPaneles] = useState([])
  const [foco, setFoco] = useState(null)

  function pedir(id) {
    setPaneles((p) => [id, ...p.filter((x) => x !== id)])
    setFoco(id)
    setTimeout(() => setFoco(null), 2400)
  }

  return (
    <>
      <header>
        <img className="mark" src="/logo1.png" alt="Logo" />
        <h1>P.O.S.E.R.S SPECIAL DIVISION</h1>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 1} onClick={() => setTab(1)}>Asistente</button>
          <button role="tab" aria-selected={tab === 2} onClick={() => setTab(2)}>Riesgo de incendio</button>
        </nav>
        <span className="sp" />
        <span className="proto">Prototipo · datos de ejemplo</span>
      </header>

      <section className="wrap" hidden={tab !== 1}>
        <Chat onPanel={pedir} onCalculadora={() => setTab(2)} />
        <Resultados ids={paneles} foco={foco} onQuitar={(id) => setPaneles((p) => p.filter((x) => x !== id))} />
      </section>

      <CalculadoraIncendio oculto={tab !== 2} />
    </>
  )
}