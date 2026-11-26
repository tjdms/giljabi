import { useEffect, useMemo, useRef, useState } from 'react'
import { loadEdges } from '../data.js'
import { edgeColor, safetyColor } from '../colors.js'
import { PLACES } from '../places.js'
import { HIGHWAY_LABELS, buildBlindspots } from '../lib/blindspot.js'
import { createSegmentLayer } from '../lib/segmentLayer.js'
import { useNaverMap } from '../lib/useNaverMap.js'
import { fitBoundsAll } from '../lib/naver.js'

const CENTER = [35.1375, 129.0995]
const PAGE = 30

const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`)

// ?pick=순위 로 그 장소를 골라서 열기, &capture=1 이면 목록 없이 지도 전체 + 요약 (정책 제안 슬라이드 캡처용)
const params = new URLSearchParams(window.location.search)
const PICK = Number(params.get('pick')) || null
const CAPTURE = params.get('capture') === '1'

// 사각지대 탭: 골목·이면도로 중 위험 노출량이 큰 곳 목록 + 지도에서 위치 보기
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

  useEffect(() => {
    if (PICK && groups[PICK - 1]) setSelected(groups[PICK - 1])
  }, [groups])

  // 지도: 전체 안전도 + 고른 곳 강조
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
    const pad = CAPTURE ? { top: 140, right: 60, bottom: 200, left: 60 } : { top: 50, right: 50, bottom: 50, left: 50 }
    fitBoundsAll(maps, map, [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)], pad)
  }, [maps, map, selected])

  const shownError = mapError || error
  const rank = selected ? groups.indexOf(selected) + 1 : null
  const stats = (g) => `위험 노출량 ${Math.round(g.exposure)} · 길이 ${fmtM(g.length)} · 평균 ${Math.round(g.score)}점 · 최대 통과 ${g.usageMax}회`

  if (CAPTURE) {
    return (
      <div className="map-screen">
        <div className="map">
          <div ref={elRef} className="map-canvas" />
        </div>
        {selected && (
          <section className="sheet capture-card" aria-label="사각지대 요약">
            <p className="muted">사각지대 {rank}위 · 골목·이면도로</p>
            <p className="dialog-title">{selected.label}</p>
            <p className="muted">{stats(selected)}</p>
            {selected.near && <p className="muted">{selected.near.label}에서 {fmtM(selected.near.d)}</p>}
          </section>
        )}
      </div>
    )
  }

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
            골목·이면도로 중 위험 노출량이 큰 순서 · 위험 노출량 = Σ (1 − 안전도) × 통과 횟수 × 길이 ÷ 100
            {data && ` · ${groups.length.toLocaleString()}곳 (구간 ${data.segments.toLocaleString()}개)`}
          </p>
          <p className="muted">
            통과 횟수: 무작위 출발·도착 1,000쌍의 최단 경로가 지나간 횟수.
            {data && ` 큰길과 큰길 옆 인도 ${data.streetlightSkipped.toLocaleString()}구간은 가로등 데이터가 없어(가로등 미반영) 뺐어요.`}
            {' '}아파트 단지·캠퍼스·학교 안, 남구 밖(데이터 없음), 산책로·계단, 한 번도 안 지나간 길도 뺐어요. "○○ 부근"은 이름 없는 길에 가장 가까운 도로 이름을 붙인 거예요
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
                    <span className="blind-name">{g.label}</span>
                    <span className="muted">
                      위험 노출량 {Math.round(g.exposure)} · 길이 {fmtM(g.length)} · 최대 통과 {g.usageMax}회
                    </span>
                    <span className="muted">
                      {HIGHWAY_LABELS[g.highway] ?? '길'}{g.count > 1 ? ` 등 구간 ${g.count}개` : ''}
                      {g.near ? ` · ${g.near.label}에서 ${fmtM(g.near.d)}` : ''}
                    </span>
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
