// Límites de inflamabilidad en aire (% vol, 25 °C, 1 atm) y concentración límite de oxígeno (LOC, con N2).
export const FUELS = {
  etileno: { n: 'Etileno', lfl: 2.7, ufl: 36, loc: 10 },
  metano: { n: 'Metano', lfl: 5, ufl: 15, loc: 12 },
  propano: { n: 'Propano', lfl: 2.1, ufl: 9.5, loc: 11.5 },
  butano: { n: 'Butano', lfl: 1.8, ufl: 8.4, loc: 12 },
  etano: { n: 'Etano', lfl: 3, ufl: 12.4, loc: 11 },
}

// w = eficacia como inerte relativa al nitrógeno (aproximación; el helio se trata como N2).
export const GASES = {
  o2: { n: 'Oxígeno', w: 0, c: 'var(--blue)' },
  n2: { n: 'Nitrógeno', w: 1, c: '#3F68B5' },
  he: { n: 'Helio', w: 1, c: '#8FAEE0' },
  co2: { n: 'Dióxido de carbono', w: 1.5, c: '#C3D3F0' },
}

// Estimación educativa: Le Chatelier para la mezcla de combustibles + ajuste del límite superior por oxígeno/inertes.
export function calcular(sel, amt, gas) {
  const act = sel.filter((k) => amt[k] > 0)
  const F = act.reduce((s, k) => s + amt[k], 0)
  const O = gas.o2
  const I = gas.n2 * GASES.n2.w + gas.he * GASES.he.w + gas.co2 * GASES.co2.w
  const T = F + gas.o2 + gas.n2 + gas.he + gas.co2
  let p = 0, estado, lfl = 0, uflE = 0, yF = 0

  if (!F || !O) {
    estado = !F ? 'Sin combustible no hay combustión' : 'Sin oxígeno no hay combustión'
  } else {
    let a = 0, b = 0, loc = 0
    act.forEach((k) => {
      const x = amt[k] / F
      a += x / FUELS[k].lfl
      b += x / FUELS[k].ufl
      loc += x * FUELS[k].loc
    })
    lfl = 1 / a
    const ufl = 1 / b
    yF = (F / T) * 100
    const X = O / (O + I) // fracción de O2 en el oxidante (el aire es 0.21)
    const xl = loc / 100
    if (X <= xl) {
      p = 3 * (X / xl) ** 2
      estado = 'Falta oxígeno para sostener la llama'
    } else {
      uflE = Math.min(95, lfl + ((ufl - lfl) * (X - xl)) / (0.21 - xl))
      if (yF < lfl) {
        p = 15 * (yF / lfl) ** 4
        estado = 'Mezcla pobre: hay poco combustible'
      } else if (yF > uflE) {
        p = 15 * (uflE / yF) ** 4
        estado = 'Mezcla rica: hay demasiado combustible'
      } else {
        const pico = lfl + 0.35 * (uflE - lfl)
        const t = yF <= pico ? (yF - lfl) / (pico - lfl) : (uflE - yF) / (uflE - pico)
        p = 15 + 85 * Math.sqrt(t)
        estado = 'Dentro del rango inflamable'
      }
    }
  }
  p = Math.round(p)
  const nivel = p < 10 ? 'Muy baja' : p < 35 ? 'Baja' : p < 65 ? 'Media' : p < 85 ? 'Alta' : 'Muy alta'
  return { p, nivel, estado, lfl, uflE, yF, yO: T ? (O / T) * 100 : 0, T, F, ok: !!(F && O) }
}