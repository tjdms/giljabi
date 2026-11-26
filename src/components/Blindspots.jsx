import { useEffect, useMemo, useRef, useState } from 'react'
import { loadEdges } from '../data.js'
import { edgeColor, safetyColor } from '../colors.js'
import { PLACES } from '../places.js'
import { AREA_LABELS } from '../lib/areas.js'
import { buildBlindspots } from '../lib/blindspot.js'
import { createSegmentLayer } from '../lib/segmentLayer.js'
import { useNaverMap } from '../lib/useNaverMap.js'

const CENTER = [35.1375, 129.0995]
const PAGE = 30
const SHORT_M = 20   // "짧은 구간 숨기기" 기준

const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`)

// 사각지대 탭: 점수 낮은 구간 목록 + 지도에서 위치 보기
export default function Blindspots() {
  const elRef = useRef(null)
  const layerRef = useRef(null)
  const { maps, map, error: mapError } = useNaverMap(elRef, { center: CENTER })
  const [edges, setEdges] = useState(null)
  const [error, setError] = useState(null)
  const [shown, setShown] = useState(PAGE)
  const [hideShort, setHideShort] = useState(false)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    loadEdges().then(setEdges).catch((err) => setError(err.message))
  }, [])

  const all = useMemo(() => (edges ? buildBlindspots(edges, PLACES) : []), [edges])
  const list = useMemo(() => (hideShort ? all.filter((it) => it.f.properties.length >= SHORT_M) : all), [all, hideShort])
  const excluded = useMemo(() => (edges ? edges.features.filter((f) => f.properties.blindspot_exclude).length : 0), [edges])

  // 지도: 전체 안전도 + 고른 구간 강조
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
    layerRef.current?.setSelected(selected?.f ?? null)
    if (!maps || !map || !selected) return
    const c = selected.f.geometry.coordinates
    const lats = c.map((p) => p[1])
    const lngs = c.map((p) => p[0])
    map.fitBounds(
      new maps.LatLngBounds(new maps.LatLng(Math.min(...lats), Math.min(...lngs)), new maps.LatLng(Math.max(...lats), Math.max(...lngs))),
      { top: 60, right: 60, bottom: 60, left: 60 },
    )
  }, [maps, map, selected])

  const shownError = mapError || error

  return (
    <div className="blind-screen">
      <div className="blind-map">
        <div className="map">
          <div ref={elRef} className="map-canvas" />
        </div>
        {!selected && edges && <p className="blind-map-hint">목록에서 구간을 누르면 지도에서 보여 드려요</p>}
      </div>

      <section className="blind-list" aria-label="사각지대 목록">
        <header className="blind-head">
          <div>
            <h1 className="brand">사각지대</h1>
            <p className="muted">
              점수 낮은 순 · {list.length.toLocaleString()}구간
              {' · '}아파트 단지·캠퍼스·학교 안 {excluded.toLocaleString()}구간은 공공데이터가 없어 뺐어요
            </p>
          </div>
          <label className="blind-toggle">
            <input type="checkbox" checked={hideShort} onChange={(e) => { setHideShort(e.target.checked); setShown(PAGE) }} />
            {SHORT_M}m 미만 숨기기
          </label>
        </header>

        {shownError && <p className="form-error" role="alert">{shownError}</p>}
        {!edges && !shownError && <p className="muted">불러오는 중…</p>}

        <ol className="blind-items">
          {list.slice(0, shown).map((it, i) => {
            const p = it.f.properties
            const on = selected?.key === it.key
            return (
              <li key={it.key}>
                <button className={`blind-item ${on ? 'on' : ''}`} onClick={() => setSelected(on ? null : it)} aria-pressed={on}>
                  <span className="blind-rank">{i + 1}</span>
                  <span className="score-badge small" style={{ background: safetyColor(p.safety) }}>{p.score}</span>
                  <span className="blind-text">
                    <span>{p.grade}등급 · 길이 {fmtM(p.length)}{p.area_type ? ` · ${AREA_LABELS[p.area_type]}` : ''}</span>
                    {it.near && <span className="muted">{it.near.label}에서 {fmtM(it.near.d)}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
        {shown < list.length && (
          <button className="chip blind-more" onClick={() => setShown((n) => n + PAGE)}>더 보기 ({list.length - shown}구간 남음)</button>
        )}
      </section>
    </div>
  )
}
