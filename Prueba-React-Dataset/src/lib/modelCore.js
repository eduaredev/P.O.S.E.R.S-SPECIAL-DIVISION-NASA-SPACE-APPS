// Motor del modelo (gradient boosting exportado desde scikit-learn). Funciones puras, sin React.
export const FEATURES = [
  'is_inverse', 'f_ethylene', 'f_propane', 'f_butane', 'f_ethane', 'P_psia',
  'X_O2', 'X_CO2', 'X_fuel', 'O2_burner_corr_L', 'N2_burner_corr_L', 'fuel_burner_corr_L',
];
export const FUELS = ['Ethylene', 'Propane', 'Butane', 'Ethane'];

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** Puntaje crudo (log-odds). sklearn compara en float32: se replica con Math.fround. */
export function rawScore(model, x) {
  let s = model.init;
  for (const t of model.trees) {
    let n = 0;
    while (t.f[n] !== -2) {
      n = Math.fround(x[t.f[n]]) <= t.t[n] ? t.l[n] : t.r[n];
    }
    s += model.lr * t.v[n];
  }
  return s;
}

/** p = { fuel, inverse(0|1), P, O2, CO2, Xfuel, o2L, n2L, fuelL } -> vector en el orden de FEATURES */
export function buildVector(p) {
  return [
    p.inverse ? 1 : 0,
    p.fuel === 'Ethylene' ? 1 : 0,
    p.fuel === 'Propane' ? 1 : 0,
    p.fuel === 'Butane' ? 1 : 0,
    p.fuel === 'Ethane' ? 1 : 0,
    p.P, p.O2, p.CO2, p.Xfuel, p.o2L, p.n2L, p.fuelL,
  ];
}

export function predictProb(model, p) {
  return sigmoid(rawScore(model, buildVector(p)));
}
