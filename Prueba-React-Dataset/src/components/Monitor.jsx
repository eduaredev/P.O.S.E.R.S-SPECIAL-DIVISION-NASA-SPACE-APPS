import Controls from './Controls.jsx';
import Result from './Result.jsx';
import Heatmap from './Heatmap.jsx';
import { typicalParams, clampToTested } from '../lib/data.js';

export default function Monitor({ params, setParams }) {
  const change = (patch) => setParams((p) => ({ ...p, ...patch }));
  const combo = (fuel, inverse) => setParams((p) => ({ ...typicalParams(fuel, inverse), P: p.P }));
  return (
    <div className="grid-monitor">
      <Controls params={params} onChange={change} onCombo={combo}
        onTypical={() => setParams((p) => typicalParams(p.fuel, p.inverse))} />
      <div className="stack">
        <Result params={params} onClamp={() => setParams((p) => clampToTested(p))} />
        <Heatmap params={params} onPick={change} />
      </div>
    </div>
  );
}
