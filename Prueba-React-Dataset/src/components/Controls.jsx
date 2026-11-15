import { FUELS, FUEL_ES, VARS, META, comboKey } from '../lib/data.js';

const PRESETS = [
  { label: 'ISS: 14.7 psia, 21 % O2', P: 14.7, O2: 0.21 },
  { label: 'Exploración: 10.2 psia, 26.5 % O2', P: 10.2, O2: 0.265 },
  { label: 'Aire enriquecido: 14.7 psia, 35 % O2', P: 14.7, O2: 0.35 },
];

function SliderField({ v, params, onChange }) {
  const value = params[v.key];
  const rng = META.ranges[comboKey(params.fuel, params.inverse)]?.[v.row];
  const pos = (x) => `${((x - v.min) / (v.max - v.min)) * 100}%`;
  return (
    <div className="field">
      <label htmlFor={`s-${v.key}`}>
        {v.label}
        <span className="val">{(value * v.scale).toFixed(v.dec)} {v.unit}</span>
      </label>
      <div className="slider">
        {rng && (
          <span className="band" style={{ left: pos(Math.max(v.min, rng[0])), width: `${Math.max(1, ((Math.min(v.max, rng[1]) - Math.max(v.min, rng[0])) / (v.max - v.min)) * 100)}%` }} />
        )}
        <input id={`s-${v.key}`} type="range" min={v.min} max={v.max} step={v.step} value={Math.min(v.max, Math.max(v.min, value))}
          onChange={(e) => onChange({ [v.key]: parseFloat(e.target.value) })} />
      </div>
    </div>
  );
}

export default function Controls({ params, onChange, onCombo, onTypical, onPreset }) {
  const inv = !!params.inverse;
  const pick = (keys) => keys.map((k) => VARS.find((v) => v.key === k));
  // Solo se muestran las variables que existen en ese tipo de llama; las demás valen 0.
  const chamber = pick(inv ? ['P', 'Xfuel', 'CO2'] : ['P', 'O2', 'CO2']);
  const burner = pick(inv ? ['o2L', 'n2L'] : ['fuelL', 'n2L']);
  return (
    <section className="panel" aria-label="Parámetros del escenario">
      <h2>Escenario</h2>
      <p className="hint">La franja azul bajo cada control marca lo que NASA realmente ensayó para este combustible y tipo de llama.</p>

      <div className="field">
        <label htmlFor="fuel">Combustible</label>
        <select id="fuel" value={params.fuel} onChange={(e) => onCombo(e.target.value, params.inverse)}>
          {FUELS.map((f) => <option key={f} value={f}>{FUEL_ES[f]}</option>)}
        </select>
      </div>
      <div className="field">
        <span className="lab">Tipo de llama</span>
        <div className="seg" role="group" aria-label="Tipo de llama">
          <button type="button" aria-pressed={!inv} onClick={() => onCombo(params.fuel, 0)}>Normal</button>
          <button type="button" aria-pressed={inv} onClick={() => onCombo(params.fuel, 1)}>Inversa</button>
        </div>
      </div>

      {!inv && (
        <div className="chips" aria-label="Escenarios rápidos">
          {PRESETS.map((p) => <button key={p.label} type="button" className="chip" onClick={() => onPreset(p)}>{p.label}</button>)}
        </div>
      )}

      <h3 className="grp">Cámara</h3>
      <p className="hint tight">
        {inv
          ? 'En llama inversa la cámara está llena de combustible con nitrógeno y casi no tiene O2: el O2 entra por el quemador.'
          : 'En llama normal la cámara solo tiene aire (O2 y nitrógeno): el combustible entra por el quemador.'}
      </p>
      {chamber.map((v) => <SliderField key={v.key} v={v} params={params} onChange={onChange} />)}

      <h3 className="grp">{inv ? 'Quemador: aquí sale el oxígeno' : 'Quemador: aquí sale el combustible'}</h3>
      <p className="hint tight">Litros estándar ya corregidos por tipo de gas, lo que sale durante la prueba.</p>
      {burner.map((v) => <SliderField key={v.key} v={v} params={params} onChange={onChange} />)}

      <button type="button" className="btn ghost small" onClick={onTypical}>Volver a valores típicos de este caso</button>
    </section>
  );
}
