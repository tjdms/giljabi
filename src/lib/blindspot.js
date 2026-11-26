// 사각지대 목록: 점수 낮은 구간 순서
// - blindspot_exclude(아파트 단지·캠퍼스·학교 안) 구간은 뺌: 사유지 시설이 공공데이터에 없어 낮게 나온 것이라서
// - 보행망은 같은 길이 양방향(u→v, v→u)으로 두 번 들어 있어서 하나로 합침
// - 점수가 같으면 긴 구간이 위 (짧은 조각보다 고칠 가치가 큼)
import { distanceM } from './nav.js'

export function buildBlindspots(edges, places = []) {
  const seen = new Set()
  const items = []
  for (const f of edges.features) {
    const p = f.properties
    if (p.blindspot_exclude) continue
    const key = p.u < p.v ? `${p.u}-${p.v}` : `${p.v}-${p.u}`
    if (seen.has(key)) continue
    seen.add(key)
    const c = f.geometry.coordinates
    const [x, y] = c[Math.floor(c.length / 2)]
    const mid = [y, x]
    // 위치 설명용: 가장 가까운 자주 가는 곳
    let near = null
    for (const pl of places) {
      if (!pl.latlng) continue
      const d = distanceM(mid, pl.latlng)
      if (!near || d < near.d) near = { label: pl.label, d }
    }
    items.push({ key, f, mid, near })
  }
  items.sort((a, b) => a.f.properties.score - b.f.properties.score || b.f.properties.length - a.f.properties.length)
  return items
}
