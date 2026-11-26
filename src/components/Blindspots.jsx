import { useEffect, useMemo, useRef, useState } from 'react'
import { loadEdges } from '../data.js'
import { edgeColor, safetyColor } from '../colors.js'
import { PLACES } from '../places.js'
import { HIGHWAY_LABELS, buildBlindspots } from '../lib/blindspot.js'
import { createSegmentLayer } from '../lib/segmentLayer.js'
import { useNaverMap } from '../lib/useNaverMap.js'

const CENTER = [35.1375, 129.0995]
const PAGE = 30

const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`)

// 사각지대 탭: 많이 지나는데 점수 낮은 길 목록 + 지도에서 위치 보기
export default function Blindspots() {
  const elRef = useRef(null)
  const layerRef = useRef(null)
  const { maps, map, error: mapError } = useNaverMap(elRef, { center: CENTER })
  const [edges, setEdges] = useState(null)
  const [error, setError] = useState(null)
  const [shown, setShown] = useState(PAGE)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    loadEdges().then(setEdges).catch((err) => setError(err.message))
  }, [])

  const data = useMemo(() => (edges ? buildBlindspots(edges, PLACES) : null), [edges])
  const groups = data?.groups ?? []

  // 지도: 전체 안전도 + 고른 길 강조
  useEffect(() => {
    if (!maps || !map || !edges) return
    const layer = createSegmentLayer(maps, {
      features: edges.features,
      color: (f) => edgeColor(f.properties),
      weight: 2,
      opacity: 0.6,
    })
    layer.setMap(map)
    layerRef.current = layer
    return () => { layer.setMap(null); layerRef.current = null }
  }, [maps, map, edges])

  useEffect(() => {
    layerRef.current?.setSelected(selected?.features ?? null)
    if (!maps || !map || !selected) return
    const pts = selected.features.flatMap((f) => f.geometry.coordinates)
    const lats = pts.map((p) => p[1])
    const lngs = pts.map((p) => p[0])
    map.fitBounds(
      new maps.LatLngBounds(new maps.LatLng(Math.min(...lats), Math.min(...lngs)), new maps.LatLng(Math.max(...lats), Math.max(...lngs))),
      { top: 50, right: 50, bottom: 50, left: 50 },
    )
  }, [maps, map, selected])

  const shownError = mapError || error

  return (
    <div className="blind-screen">
      <div className="blind-map">
        <div className="map">
          <div ref={elRef} className="map-canvas" />
        </div>
        {!selected && edges && <p className="blind-map-hint">목록에서 길을 누르면 지도에서 보여 드려요</p>}
      </div>

      <section className="blind-list" aria-label="사각지대 목록">
        <header className="blind-head">
          <h1 className="brand">사각지대</h1>
          <p className="muted">
            많이 지나는데 점수가 낮은 길 순서 · 우선순위 = (1 − 안전도) × 통과 횟수
            {data && ` · ${groups.length.toLocaleString()}곳 (구간 ${data.segments.toLocaleString()}개)`}
          </p>
          <p className="muted">
            통과 횟수: 무작위 출발·도착 1,000쌍의 최단 경로가 지나간 횟수. 아파트 단지·캠퍼스·학교 안, 산책로·계단, 한 번도 안 지나간 길은 뺐어요
          </p>
        </header>

        {shownError && <p className="form-error" role="alert">{shownError}</p>}
        {!edges && !shownError && <p className="muted">불러오는 중…</p>}

        <ol className="blind-items">
          {groups.slice(0, shown).map((g, i) => {
            const on = selected?.key === g.key
            return (
              <li key={g.key}>
                <button className={`blind-item ${on ? 'on' : ''}`} onClick={() => setSelected(on ? null : g)} aria-pressed={on}>
                  <span className="blind-rank">{i + 1}</span>
                  <span className="score-badge small" style={{ background: safetyColor(g.score / 100) }}>{Math.round(g.score)}</span>
                  <span className="blind-text">
                    <span className="blind-name">{g.name ?? `이름 없는 ${HIGHWAY_LABELS[g.highway] ?? '길'}`}</span>
                    <span className="muted">
                      통과 {g.usage}회 · 길이 {fmtM(g.length)}{g.count > 1 ? ` · 구간 ${g.count}개` : ''}
                    </span>
                    {g.near && <span className="muted">{g.near.label}에서 {fmtM(g.near.d)}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
        {shown < groups.length && (
          <button className="chip blind-more" onClick={() => setShown((n) => n + PAGE)}>더 보기 ({groups.length - shown}곳 남음)</button>
        )}
      </section>
    </div>
  )
}
