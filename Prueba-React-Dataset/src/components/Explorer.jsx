import { useMemo, useState } from 'react';
import { DATA, FUELS, FUEL_ES, modeName, applyFilters, EMPTY_FILTERS, toCSV, rate } from '../lib/data.js';

const COLS = [
  { k: 'date', h: 'Fecha', get: (r) => r.date },
  { k: 'tpid', h: 'Prueba', get: (r) => r.tpid },
  { k: 'fuel', h: 'Combustible', get: (r) => FUEL_ES[r.fuel] },
  { k: 'is_inverse', h: 'Llama', get: (r) => (r.is_inverse ? 'Inversa' : 'Normal') },
  { k: 'P_psia', h: 'Presión (psia)', get: (r) => r.P_psia.toFixed(1), num: true },
  { k: 'X_O2', h: 'O2 cámara', get: (r) => `${(r.X_O2 * 100).toFixed(1)} %`, num: true },
  { k: 'X_fuel', h: 'Comb. cámara', get: (r) => `${(r.X_fuel * 100).toFixed(1)} %`, num: true },
  { k: 'fuel_burner_corr_L', h: 'Comb. quemador (L)', get: (r) => r.fuel_burner_corr_L.toFixed(3), num: true },
  { k: 'ignite', h: 'Resultado', get: (r) => <><i className={`dot ${r.ignite ? 'yes' : 'no'}`} />{r.ignite ? 'Encendió' : 'No encendió'}</> },
  { k: 'prob_cv', h: 'Modelo', get: (r) => <><span className="meter"><i style={{ width: `${r.prob_cv * 100}%` }} /></span>{(r.prob_cv * 100).toFixed(0)} %</>, num: true },
];

const PAGE = 15;

export default function Explorer({ filters, setFilters, onLoadRow }) {
  const [sort, setSort] = useState({ k: 'date', dir: 1 });
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState(null);
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(0); };
  const rows = useMemo(() => {
    const list = applyFilters(DATA, filters);
    return [...list].sort((a, b) => {
      const x = a[sort.k], y = b[sort.k];
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.t_start.localeCompare(b.t_start);
    });
  }, [filters, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);
  const selected = sel != null ? DATA[sel] : null;
  const active = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  const download = () => {
    const url = URL.createObjectURL(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'busqueda_ignicion.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel">
      <h2>Buscador de pruebas</h2>
      <p className="hint">Busca por prueba, fecha, combustible o resultado (por ejemplo "21130 propano no encendió"), o filtra con los controles.</p>
      <input className="search" type="search" placeholder="Buscar en las pruebas" aria-label="Buscar en las pruebas" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
      <div className="filters">
        <select aria-label="Combustible" value={filters.fuel} onChange={(e) => set({ fuel: e.target.value })}>
          <option value="">Todos los combustibles</option>
          {FUELS.map((f) => <option key={f} value={f}>{FUEL_ES[f]}</option>)}
        </select>
        <select aria-label="Tipo de llama" value={filters.mode} onChange={(e) => set({ mode: e.target.value })}>
          <option value="">Normal e inversa</option><option value="0">Solo normal</option><option value="1">Solo inversa</option>
        </select>
        <select aria-label="Resultado" value={filters.result} onChange={(e) => set({ result: e.target.value })}>
          <option value="">Cualquier resultado</option><option value="1">Encendió</option><option value="0">No encendió</option>
        </select>
        <select aria-label="Fuente" value={filters.source} onChange={(e) => set({ source: e.target.value })}>
          <option value="">PSI-10 y PSI-159</option><option value="PSI-10">Solo PSI-10</option><option value="PSI-159">Solo PSI-159</option>
        </select>
      </div>

      <div className="pager" style={{ margin: '0 0 8px' }}>
        <span><b>{rows.length}</b> pruebas, {(rate(rows) * 100).toFixed(0)} % encendió</span>
        <span style={{ display: 'flex', gap: 8 }}>
          {active && <button type="button" className="btn ghost small" onClick={() => { setFilters(EMPTY_FILTERS); setPage(0); }}>Quitar filtros</button>}
          <button type="button" className="btn ghost small" onClick={download}>Descargar CSV</button>
        </span>
      </div>

      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.k} scope="col" aria-sort={sort.k === c.k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
                  onClick={() => { setSort((s) => ({ k: c.k, dir: s.k === c.k ? -s.dir : 1 })); setPage(0); }}>
                  {c.h}{sort.k === c.k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.id} data-sel={sel === r.id ? 1 : 0} onClick={() => setSel(r.id)} tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') setSel(r.id); }}>
                {COLS.map((c) => <td key={c.k} style={c.num ? { textAlign: 'right' } : undefined}>{c.get(r)}</td>)}
              </tr>
            ))}
            {!view.length && <tr><td colSpan={COLS.length} style={{ padding: 18, color: 'var(--ink-2)' }}>Ninguna prueba coincide. Quita algún filtro o prueba otra búsqueda.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span>Página {page + 1} de {pages}</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn ghost small" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</button>
          <button type="button" className="btn ghost small" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
        </span>
      </div>

      {selected && (
        <div className="detail">
          <h3 style={{ fontSize: 16 }}>{selected.tpid}, {selected.date}</h3>
          <dl>
            <div><dt>Fuente</dt><dd>{selected.source}</dd></div>
            <div><dt>Configuración</dt><dd>{selected.fuel_config}</dd></div>
            <div><dt>Tipo de llama</dt><dd>{modeName(selected.is_inverse)}</dd></div>
            <div><dt>Presión inicial / aumento</dt><dd>{selected.P_psia.toFixed(2)} psia / {selected.dP_psia.toFixed(2)}</dd></div>
            <div><dt>O2, N2, CO2, H2O en cámara</dt><dd>{[selected.X_O2, selected.X_N2, selected.X_CO2, selected.X_H2O].map((v) => `${(v * 100).toFixed(1)}`).join(' / ')} %</dd></div>
            <div><dt>Combustible en cámara</dt><dd>{(selected.X_fuel * 100).toFixed(2)} %</dd></div>
            <div><dt>Quemador crudo O2 / N2 / comb. (L)</dt><dd>{selected.mfc_O2_L.toFixed(3)} / {selected.mfc_N2_L.toFixed(3)} / {selected.mfc_fuel_L.toFixed(3)}</dd></div>
            <div><dt>Quemador corregido O2 / N2 / comb. (L)</dt><dd>{selected.O2_burner_corr_L.toFixed(3)} / {selected.N2_burner_corr_L.toFixed(3)} / {selected.fuel_burner_corr_L.toFixed(3)}</dd></div>
            <div><dt>Resultado real</dt><dd>{selected.ignite ? 'Encendió' : 'No encendió'}</dd></div>
            <div><dt>Predicción sin ver ese día</dt><dd>{(selected.prob_cv * 100).toFixed(0)} %</dd></div>
          </dl>
          {selected.cambio && <p className="note">Cambio aplicado a esta fila: {selected.cambio}.</p>}
          <button type="button" className="btn small" onClick={() => onLoadRow(selected)}>Cargar en el simulador</button>
        </div>
      )}
    </section>
  );
}
