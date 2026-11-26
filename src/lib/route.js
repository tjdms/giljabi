// 보행 그래프 + 다익스트라 (edges_scored.geojson의 u, v로 그래프 만들기)
// 브라우저·Node 둘 다에서 돌도록 DOM·Leaflet 없이 작성
import { isNoDataArea } from './areas.js'

export const WALK_M_PER_MIN = 67   // 도보 속도 (노트북과 같은 값, 약 4km/h)

// 안심 경로 고르기 설정
// 비용 length × (1 + k × risk)로 k마다 후보를 만들고, 최단 대비 우회가 maxDetour 이내인 후보 중
// 평균 안전점수(길이 가중)가 가장 높은 것을 안심 경로로 고름. k = 0은 최단 경로
// 공공데이터 미포함 구간(아파트·캠퍼스·학교)은 고를 때만 safety를 중앙값으로 바꿔 씀 (화면 평균에는 안 넣음)
export const ROUTE_OPTIONS = {
  kValues: [0, 1, 2, 4, 8],
  maxDetour: 0.25,          // +25%
  noDataMedian: 'all',      // 'all': 전체 구간 중앙값, 'public': 공공데이터 있는 구간 중앙값, null: 대체 안 함
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function buildGraph(edges, options = ROUTE_OPTIONS) {
  const nodes = new Map()   // id -> [lat, lon]
  const adj = new Map()     // id -> [{ to, f }]
  for (const f of edges.features) {
    const { u, v } = f.properties
    const c = f.geometry.coordinates
    if (!nodes.has(u)) nodes.set(u, [c[0][1], c[0][0]])
    if (!nodes.has(v)) nodes.set(v, [c.at(-1)[1], c.at(-1)[0]])
    if (!adj.has(u)) adj.set(u, [])
    adj.get(u).push({ to: v, f })
  }
  // 경로 고를 때 쓰는 safety
  const all = edges.features.map((f) => f.properties)
  const basis = options.noDataMedian === 'public' ? all.filter((p) => !isNoDataArea(p)) : all
  const noDataSafety = options.noDataMedian ? median(basis.map((p) => p.safety)) : null
  const pickSafety = (f) => (noDataSafety !== null && isNoDataArea(f.properties) ? noDataSafety : f.properties.safety)
  return { nodes, adj, pickSafety, noDataSafety }
}

// 두 위경도 사이 거리(m), 짧은 거리용 근사
export function distM([lat1, lon1], [lat2, lon2]) {
  const k = Math.PI / 180
  const x = (lon2 - lon1) * k * Math.cos(((lat1 + lat2) / 2) * k)
  const y = (lat2 - lat1) * k
  return Math.sqrt(x * x + y * y) * 6371000
}

export function nearestNode(graph, latlng) {
  let best = null
  let bestD = Infinity
  for (const [id, p] of graph.nodes) {
    const d = distM(latlng, p)
    if (d < bestD) { bestD = d; best = id }
  }
  return { id: best, dist: bestD }
}

class MinHeap {
  constructor() { this.a = [] }
  get size() { return this.a.length }
  push(item) {
    const a = this.a
    a.push(item)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p][0] <= a[i][0]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop() {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < a.length && a[l][0] < a[m][0]) m = l
        if (r < a.length && a[r][0] < a[m][0]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

// weight(f): 구간 비용 함수. 경로 구간 feature 배열, 못 가면 null
export function shortestPath(graph, from, to, weight) {
  if (from === to) return []
  const dist = new Map([[from, 0]])
  const prev = new Map()
  const heap = new MinHeap()
  heap.push([0, from])
  while (heap.size) {
    const [d, n] = heap.pop()
    if (n === to) break
    if (d > dist.get(n)) continue
    for (const { to: m, f } of graph.adj.get(n) || []) {
      const nd = d + weight(f)
      if (nd < (dist.get(m) ?? Infinity)) {
        dist.set(m, nd)
        prev.set(m, { n, f })
        heap.push([nd, m])
      }
    }
  }
  if (!prev.has(to)) return null
  const path = []
  for (let n = to; n !== from; n = prev.get(n).n) path.push(prev.get(n).f)
  return path.reverse()
}

// graph가 있으면 고를 때 쓰는 점수(pickScore)도 계산
export function summarize(path, graph) {
  const sum = (fs, val) => fs.reduce((s, f) => s + val(f) * f.properties.length, 0)
  const length = sum(path, () => 1)
  const known = path.filter((f) => !isNoDataArea(f.properties))
  const knownLength = sum(known, () => 1)
  return {
    length,
    minutes: length / WALK_M_PER_MIN,
    // 화면용 평균 안전점수: 공공데이터 미포함 구간을 뺀 길이 가중 평균 (0~100), 전부 미포함이면 null
    score: knownLength ? (sum(known, (f) => f.properties.safety) / knownLength) * 100 : null,
    noDataLength: length - knownLength,
    noDataRatio: length ? (length - knownLength) / length : 0,
    pickScore: graph && length ? (sum(path, graph.pickSafety) / length) * 100 : null,
    coords: path.flatMap((f, i) => {
      const c = f.geometry.coordinates.map(([x, y]) => [y, x])
      return i ? c.slice(1) : c
    }),
  }
}

// k마다 후보 경로를 만들고 같은 경로는 하나로 합침
export function routeCandidates(graph, from, to, kValues = ROUTE_OPTIONS.kValues) {
  const seen = new Map()
  for (const k of kValues) {
    const path = shortestPath(graph, from, to, (f) => f.properties.length * (1 + k * (1 - graph.pickSafety(f))))
    if (!path) return null
    const key = path.map((f) => `${f.properties.u}-${f.properties.v}`).join(',')
    if (seen.has(key)) seen.get(key).ks.push(k)
    else seen.set(key, { ks: [k], path, ...summarize(path, graph) })
  }
  return [...seen.values()]
}

export function compareRoutes(graph, startLatLng, endLatLng, options = ROUTE_OPTIONS) {
  const s = nearestNode(graph, startLatLng)
  const e = nearestNode(graph, endLatLng)
  const candidates = routeCandidates(graph, s.id, e.id, options.kValues)
  if (!candidates) return { error: '두 지점을 잇는 길을 찾지 못했어요', snap: [s, e] }
  const short = candidates.reduce((a, b) => (b.length < a.length ? b : a))
  const limit = short.length * (1 + options.maxDetour)
  // 우회 한도 안에서 고를 때 쓰는 평균 안전점수가 가장 높은 후보 (같으면 짧은 쪽)
  const safe = candidates
    .filter((c) => c.length <= limit)
    .reduce((a, b) => (b.pickScore > a.pickScore || (b.pickScore === a.pickScore && b.length < a.length) ? b : a))
  return { short, safe, shortPath: short.path, safePath: safe.path, candidates, snap: [s, e] }
}
