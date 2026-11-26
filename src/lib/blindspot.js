// 사각지대 목록: 많이 지나다니는데 점수가 낮은 길 순서
// - 우선순위 = (1 − safety) × usage(무작위 1,000쌍 최단 경로 통과 횟수, scripts/score.py)
// - 뺌: blindspot_exclude(아파트 단지·캠퍼스·학교 안, 사유지 시설이 공공데이터에 없어서),
//       산책로·계단(EXCLUDE_HIGHWAYS), 한 번도 안 지나간 구간(usage 0)
// - 보행망은 같은 길이 양방향(u→v, v→u)으로 두 번 들어 있어서 하나로 합침
// - 같은 도로 이름끼리 묶음. 묶음의 우선순위·통과 횟수는 그 안에서 가장 큰 값 (이어진 구간을 같은 사람이 지나므로 합하지 않음)
import { distanceM } from './nav.js'

export const EXCLUDE_HIGHWAYS = new Set(['path', 'track', 'steps'])

export const HIGHWAY_LABELS = {
  trunk: '큰길', trunk_link: '큰길 연결로', primary: '큰길', primary_link: '큰길 연결로',
  secondary: '큰길', secondary_link: '큰길 연결로', tertiary: '도로', tertiary_link: '도로 연결로',
  residential: '골목', living_street: '생활도로', unclassified: '도로', service: '건물·주차장 진입로',
  footway: '보도', pedestrian: '보행자 도로', cycleway: '자전거도로',
}

export const priorityOf = (p) => (1 - p.safety) * p.usage

export function buildBlindspots(edges, places = []) {
  // 1) 구간 고르기 (양방향 합침)
  const seen = new Set()
  const segs = []
  for (const f of edges.features) {
    const p = f.properties
    if (p.blindspot_exclude || EXCLUDE_HIGHWAYS.has(p.highway) || !p.usage) continue
    const key = p.u < p.v ? `${p.u}-${p.v}` : `${p.v}-${p.u}`
    if (seen.has(key)) continue
    seen.add(key)
    segs.push({ key, f, priority: priorityOf(p) })
  }

  // 2) 같은 도로 이름끼리 묶기 (이름 없으면 구간 하나가 한 묶음)
  const groups = new Map()
  for (const s of segs) {
    const name = s.f.properties.name
    const gkey = name ? `name:${name}` : `seg:${s.key}`
    if (!groups.has(gkey)) groups.set(gkey, { key: gkey, name: name ?? null, segs: [] })
    groups.get(gkey).segs.push(s)
  }

  // 3) 묶음 요약 + 위치 설명(가장 가까운 자주 가는 곳)
  const out = [...groups.values()].map((g) => {
    const ps = g.segs.map((s) => s.f.properties)
    const length = ps.reduce((a, p) => a + p.length, 0)
    const top = g.segs.reduce((a, b) => (b.priority > a.priority ? b : a))
    const c = top.f.geometry.coordinates
    const [x, y] = c[Math.floor(c.length / 2)]
    const mid = [y, x]
    let near = null
    for (const pl of places) {
      if (!pl.latlng) continue
      const d = distanceM(mid, pl.latlng)
      if (!near || d < near.d) near = { label: pl.label, d }
    }
    return {
      key: g.key,
      name: g.name,
      features: g.segs.map((s) => s.f),
      count: g.segs.length,
      priority: top.priority,
      usage: Math.max(...ps.map((p) => p.usage)),
      length,
      score: (ps.reduce((a, p) => a + p.safety * p.length, 0) / length) * 100,   // 길이 가중 평균 점수
      highway: top.f.properties.highway,
      near,
    }
  })
  out.sort((a, b) => b.priority - a.priority)
  return { groups: out, segments: segs.length }
}
