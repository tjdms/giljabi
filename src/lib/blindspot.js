// 사각지대 목록 (정책 제안용): 골목·이면도로 중 위험 노출량이 큰 곳
// - 순위 = 위험 노출량 Σ (1 − safety) × usage × 길이(m) / 100, 묶음 안에서는 합함
//   usage: 무작위 출발·도착 1,000쌍 최단 경로 통과 횟수 (scripts/score.py)
// - 목록 대상: 골목·이면도로(ALLEY_HIGHWAYS)와 큰길 옆이 아닌 보도
// - 뺌: 큰길·큰길 옆 인도·횡단보도(streetlight_missing — 가로등 데이터가 없어 낮게 나옴, "가로등 미반영"),
//       아파트 단지·캠퍼스·학교 안(blindspot_exclude), 산책로·계단 등 그 밖의 길, 한 번도 안 지나간 길(usage 0)
// - 보행망은 같은 길이 양방향(u→v, v→u)으로 두 번 들어 있어서 하나로 합침
// - 이름 있는 길은 같은 이름끼리 묶음. 이름 없는 길은 먼저 구간마다 가장 가까운 이름 있는 도로를 정하고,
//   끝점이 JOIN_M 안에서 이어지면서 가까운 도로 이름도 같은 것끼리 묶어 "○○ 부근"이라고 부름
//   (이어진 것만 보면 보도·진입로가 끝없이 이어져 수 km짜리 묶음이 생김)
import { distanceM } from './nav.js'

export const ALLEY_HIGHWAYS = new Set(['residential', 'service', 'unclassified', 'living_street', 'footway'])
const JOIN_M = 30
const NEAR_NAME_MAX_M = 300   // 이보다 멀면 "○○ 부근" 대신 이름 없는 길로 둠

export const HIGHWAY_LABELS = {
  residential: '골목', living_street: '생활도로', unclassified: '이면도로', service: '건물·주차장 진입로', footway: '보도',
}

export const exposureOf = (p) => ((1 - p.safety) * p.usage * p.length) / 100

const ends = (f) => {
  const c = f.geometry.coordinates
  return [[c[0][1], c[0][0]], [c.at(-1)[1], c.at(-1)[0]]]
}
const midOf = (f) => {
  const c = f.geometry.coordinates
  const [x, y] = c[Math.floor(c.length / 2)]
  return [y, x]
}

export function isListed(p) {
  return ALLEY_HIGHWAYS.has(p.highway) && !p.streetlight_missing && !p.blindspot_exclude && p.usage > 0
}

export function buildBlindspots(edges, places = []) {
  // 1) 대상 구간 (양방향 합침)
  const seen = new Set()
  const segs = []
  let streetlightSkipped = 0
  for (const f of edges.features) {
    const p = f.properties
    const key = p.u < p.v ? `${p.u}-${p.v}` : `${p.v}-${p.u}`
    if (seen.has(key)) continue
    seen.add(key)
    if (p.streetlight_missing && p.usage > 0 && !p.blindspot_exclude) streetlightSkipped++
    if (!isListed(p)) continue
    segs.push({ key, f, exposure: exposureOf(p) })
  }

  // 2) 이름 없는 구간마다 가장 가까운 이름 있는 도로 (이름 있는 모든 구간의 꼭짓점, 큰길 포함, 격자로 찾기)
  const cell = ([lat, lng]) => [Math.floor(lat / 0.0003), Math.floor(lng / 0.00037)]   // 약 33m 칸
  const nameGrid = new Map()
  for (const f of edges.features) {
    if (!f.properties.name) continue
    for (const [x, y] of f.geometry.coordinates) {
      const k = cell([y, x]).join(',')
      if (!nameGrid.has(k)) nameGrid.set(k, [])
      nameGrid.get(k).push({ name: f.properties.name, pt: [y, x] })
    }
  }
  const R = Math.ceil(NEAR_NAME_MAX_M / 33)
  const nearestName = (pt) => {
    const [cy, cx] = cell(pt)
    let best = null
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      for (const n of nameGrid.get(`${cy + dy},${cx + dx}`) ?? []) {
        const d = distanceM(pt, n.pt)
        if (!best || d < best.d) best = { name: n.name, d }
      }
    }
    return best && best.d <= NEAR_NAME_MAX_M ? best.name : null
  }
  for (const s of segs) if (!s.f.properties.name) s.nearName = nearestName(midOf(s.f))

  // 3) 묶기: 이름 없는 구간은 끝점이 JOIN_M 안에서 이어지고 가까운 도로 이름도 같으면 한 묶음 (union-find + 격자)
  const parent = segs.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const unnamed = segs.map((s, i) => [s, i]).filter(([s]) => !s.f.properties.name)
  const grid = new Map()
  for (const [s, i] of unnamed) {
    for (const e of ends(s.f)) {
      const k = cell(e).join(',')
      if (!grid.has(k)) grid.set(k, [])
      grid.get(k).push({ i, e })
    }
  }
  for (const [s, i] of unnamed) {
    for (const e of ends(s.f)) {
      const [cy, cx] = cell(e)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        for (const o of grid.get(`${cy + dy},${cx + dx}`) ?? []) {
          if (o.i !== i && segs[o.i].nearName === s.nearName && distanceM(e, o.e) <= JOIN_M) parent[find(o.i)] = find(i)
        }
      }
    }
  }
  const groups = new Map()
  segs.forEach((s, i) => {
    const name = s.f.properties.name
    const gkey = name ? `name:${name}` : `near:${find(i)}`
    if (!groups.has(gkey)) groups.set(gkey, { key: gkey, name: name ?? null, segs: [] })
    groups.get(gkey).segs.push(s)
  })

  const nearestPlace = (pt) => {
    let near = null
    for (const pl of places) {
      if (!pl.latlng) continue
      const d = distanceM(pt, pl.latlng)
      if (!near || d < near.d) near = { label: pl.label, d }
    }
    return near
  }

  // 4) 묶음 요약
  const out = [...groups.values()].map((g) => {
    const ps = g.segs.map((s) => s.f.properties)
    const length = ps.reduce((a, p) => a + p.length, 0)
    const top = g.segs.reduce((a, b) => (b.exposure > a.exposure ? b : a))
    const mid = midOf(top.f)
    const guessed = g.name ? null : top.nearName
    return {
      key: g.key,
      name: g.name,
      label: g.name ?? (guessed ? `${guessed} 부근` : `이름 없는 ${HIGHWAY_LABELS[top.f.properties.highway] ?? '길'}`),
      guessed: !g.name,
      features: g.segs.map((s) => s.f),
      count: g.segs.length,
      exposure: g.segs.reduce((a, s) => a + s.exposure, 0),
      usageMax: Math.max(...ps.map((p) => p.usage)),
      length,
      score: (ps.reduce((a, p) => a + p.safety * p.length, 0) / length) * 100,   // 길이 가중 평균 점수
      highway: top.f.properties.highway,
      near: nearestPlace(mid),
    }
  })
  out.sort((a, b) => b.exposure - a.exposure)
  return { groups: out, segments: segs.length, streetlightSkipped }
}
