import { useState } from 'react';
import Controls from './Controls.jsx';
import Result from './Result.jsx';
import Heatmap from './Heatmap.jsx';
import Replay from './Replay.jsx';
import { typicalParams, clampToTested } from '../lib/data.js';

export default function Monitor({ params, setParams, onLoadRow }) {
  const [threshold, setThreshold] = useState(0.5);
  const change = (patch) => setParams((p) => ({ ...p, ...patch }));
  const combo = (fuel, inverse) => setParams((p) => ({ ...typicalParams(fuel, inverse), P: p.P }));
  const preset = (pr) => setParams((p) => ({ ...typicalParams(p.fuel, 0, { O2: pr.O2 }), P: pr.P, O2: pr.O2 }));
  return (
    <div className="grid-monitor">
      <Controls params={params} onChange={change} onCombo={combo} onPreset={preset}
        onTypical={() => setParams((p) => typicalParams(p.fuel, p.inverse))} />
      <div className="stack">
        <Result params={params} threshold={threshold} onClamp={() => setParams((p) => clampToTested(p))} />
        <Heatmap params={params} onPick={change} />
        <Replay threshold={threshold} onThreshold={setThreshold} onLoadRow={onLoadRow} />
      </div>
    </div>
  );
}
