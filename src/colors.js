import { isNoDataArea } from './lib/areas.js'

// 안전도 그라데이션: 주황(위험) → 노랑 → 파랑(안전). 적록색약 고려해 초록·빨강 안 씀
const STOPS = [
  [0, [255, 138, 61]],   // #FF8A3D
  [0.5, [255, 213, 74]], // #FFD54A
  [1, [79, 163, 255]],   // #4FA3FF
]

export const GRADIENT_CSS = `linear-gradient(to right, ${STOPS.map(([t, c]) => `rgb(${c}) ${t * 100}%`).join(', ')})`

export function safetyColor(safety) {
  const s = Math.min(1, Math.max(0, safety))
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i]
    if (s <= t1) {
      const [t0, c0] = STOPS[i - 1]
      const k = (s - t0) / (t1 - t0)
      const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * k))
      return `rgb(${c.join(',')})`
    }
  }
  return `rgb(${STOPS.at(-1)[1].join(',')})`
}

// 공공데이터 미포함 구역(아파트·캠퍼스·학교) 구간 색
export const NO_DATA_COLOR = '#7A8194'

export const edgeColor = (props) => (isNoDataArea(props) ? NO_DATA_COLOR : safetyColor(props.safety))
