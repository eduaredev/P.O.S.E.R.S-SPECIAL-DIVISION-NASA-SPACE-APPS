export function Barras({ vals, labels }) {
  const W = 340, H = 150, b = 24
  const g = (W - vals.length * b) / (vals.length + 1)
  const m = Math.max(...vals)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} role="img" aria-label="Asteroides por día">
      {vals.map((v, i) => {
        const h = (v / m) * (H - 40), x = g + i * (b + g), y = H - 22 - h
        return (
          <g key={i}>
            <rect x={x} y={y} width={b} height={h} rx="3" fill="var(--blue)" />
            <text x={x + b / 2} y={y - 5} textAnchor="middle">{v}</text>
            <text x={x + b / 2} y={H - 6} textAnchor="middle">{labels[i]}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function Lineas({ a, b }) {
  const W = 340, H = 150
  const px = (i) => 20 + (i * (W - 40)) / 6
  const py = (v) => 12 + ((0 - v) / 90) * (H - 40)
  const d = (r) => r.map((v, i) => `${i ? 'L' : 'M'}${px(i)} ${py(v)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} role="img" aria-label="Temperatura en Marte">
      <path d={d(a)} fill="none" stroke="var(--red)" strokeWidth="2.5" />
      <path d={d(b)} fill="none" stroke="var(--blue)" strokeWidth="2.5" />
      {a.map((v, i) => (
        <g key={i}>
          <circle cx={px(i)} cy={py(v)} r="3" fill="var(--red)" />
          <circle cx={px(i)} cy={py(b[i])} r="3" fill="var(--blue)" />
          <text x={px(i)} y={H - 6} textAnchor="middle">sol {i + 1}</text>
        </g>
      ))}
      <text x="22" y={py(a[0]) - 8} style={{ fill: 'var(--red)' }}>máx</text>
      <text x="22" y={py(b[0]) + 16} style={{ fill: 'var(--blue)' }}>mín</text>
    </svg>
  )
}
