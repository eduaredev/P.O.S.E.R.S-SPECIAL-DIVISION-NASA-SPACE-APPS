import { useEffect, useState } from 'react';
import Monitor from './components/Monitor.jsx';
import Explorer from './components/Explorer.jsx';
import Chat from './components/Chat.jsx';
import logo from './assets/logo.png';
import { META, EMPTY_FILTERS, typicalParams, rowToParams, DATA, SESSIONS } from './lib/data.js';

const TEAM = 'P.O.S.E.R.S SPECIAL DIVISION';

export default function App() {
  const [tab, setTab] = useState('explorer');
  const [params, setParams] = useState(() => ({ ...typicalParams('Propane', 0, { O2: 0.21 }), P: 14.7, O2: 0.21 }));
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [theme, setTheme] = useState('auto');

  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', theme);
  }, [theme]);

  const loadParams = (p) => { setParams(p); setTab('monitor'); window.scrollTo({ top: 0 }); };
  const loadRow = (r) => loadParams(rowToParams(r));
  const applyFilters = (f) => { setFilters({ ...EMPTY_FILTERS, ...f }); setTab('explorer'); };

  const c = META.cv;
  return (
    <div className="app">
      <header className="topbar">
        <img className="logo" src={logo} alt="" width="40" height="39" />
        <h1>{TEAM}</h1>
        <nav className="tabs" role="tablist" aria-label="Secciones">
          <button type="button" role="tab" className="tab" aria-selected={tab === 'explorer'} onClick={() => setTab('explorer')}>Asistente</button>
          <button type="button" role="tab" className="tab" aria-selected={tab === 'monitor'} onClick={() => setTab('monitor')}>Riesgo de incendio</button>
        </nav>
        <button type="button" className="theme" onClick={() => setTheme((t) => (t === 'auto' ? 'dark' : t === 'dark' ? 'light' : 'auto'))}>
          Tema: {theme === 'auto' ? 'del sistema' : theme === 'dark' ? 'oscuro' : 'claro'}
        </button>
      </header>

      <div className="strip">
        <p className="sub">Pruebas de combustión de NASA en la Estación Espacial Internacional. Experimento ACME, registros PSI-10 y PSI-159.</p>
        <div className="facts">
          <span><b>{DATA.length}</b>pruebas de ignición</span>
          <span><b>{SESSIONS.length}</b>días de ensayo</span>
          <span><b>{(c.all.ignite_rate * 100).toFixed(0)} %</b>encendió</span>
          <span><b>{c['PSI-159'].auc.toFixed(2)}</b>AUC del modelo en PSI-159, validado por día</span>
        </div>
      </div>

      {tab === 'monitor' ? (
        <Monitor params={params} setParams={setParams} />
      ) : (
        <div className="grid-explorer">
          <Explorer filters={filters} setFilters={setFilters} onLoadRow={loadRow} />
          <Chat onFilters={applyFilters} onLoadRow={loadRow} onLoadParams={loadParams} />
        </div>
      )}
    </div>
  );
}
