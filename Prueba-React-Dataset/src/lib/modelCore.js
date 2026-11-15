// Motor del modelo (regresión logística exportada por python/train_export.py). Funciones puras, sin React.
export const FEATURES = [
  'is_inverse', 'f_ethylene', 'f_propane', 'f_butane', 'f_ethane', 'P_psia',
  'X_CO2', 'reactivo_camara', 'chorro_O2eq_L', 'N2_burner_corr_L',
];
export const FUELS = ['Ethylene', 'Propane', 'Butane', 'Ethane'];

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/**
 * Puntaje crudo (log-odds): mismas transformaciones que en el entrenamiento.
 * Litros del quemador -> log1p(L / escala), luego se estandariza y se multiplica por su coeficiente.
 */
export function rawScore(model, x) {
  let s = model.intercept;
  for (let j = 0; j < x.length; j += 1) {
    const ls = model.log_scale[j];
    const v = ls ? Math.log1p(Math.max(0, x[j]) / ls) : x[j];
    s += model.coef[j] * ((v - model.mean[j]) / model.scale[j]);
  }
  return s;
}

/**
 * p = { fuel, inverse(0|1), P, O2, CO2, Xfuel, o2L, n2L, fuelL } -> vector en el orden de FEATURES.
 * Normal e inversa son espejo, así que O2 y combustible entran como reactivos equivalentes:
 * - reactivo_camara: O2 de la cámara en llama normal, combustible de la cámara en la inversa.
 * - chorro_O2eq_L: lo que suelta el quemador en litros de O2 equivalente (O2 en la inversa;
 *   en la normal, litros de combustible por las moléculas de O2 que pide cada una).
 */
export function buildVector(model, p) {
  const inv = p.inverse ? 1 : 0;
  return [
    inv,
    p.fuel === 'Ethylene' ? 1 : 0,
    p.fuel === 'Propane' ? 1 : 0,
    p.fuel === 'Butane' ? 1 : 0,
    p.fuel === 'Ethane' ? 1 : 0,
    p.P, p.CO2,
    inv ? p.Xfuel : p.O2,
    inv ? p.o2L : p.fuelL * model.o2_per_fuel[p.fuel],
    p.n2L,
  ];
}

export function predictProb(model, p) {
  return sigmoid(rawScore(model, buildVector(model, p)));
}
