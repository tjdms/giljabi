import { useEffect, useMemo, useRef, useState } from 'react'
import { nearestPointOnLine, point, pointToLineDistance } from '@turf/turf'
import { FACILITY_TYPES, loadEdges, loadFacilities, loadMeta } from '../data.js'
import { GRADIENT_CSS, NO_DATA_COLOR, edgeColor } from '../colors.js'
import { AREA_LABELS, isNoDataArea } from '../lib/areas.js'
import { listenMapTap, useNaverMap } from '../lib/useNaverMap.js'
import { createSegmentLayer } from '../lib/segmentLayer.js'

const CENTER = [35.1375, 129.0995]   // 경성대·부경대역 부근
const NEARBY_M = 50                  // 구간 주변 시설로 보여줄 거리
const TAP_PX = 16                    // 이 픽셀 안에 있는 가장 가까운 구간을 누른 것으로 봄 (손가락 탭용)

function bbox(geojson) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const f of geojson.features) {
    for (const [x, y] of f.geometry.coordinates) {
      if (x < x0) x0 = x; if (y < y0) y0 = y
      if (x > x1) x1 = x; if (y > y1) y1 = y
    }
  }
  return [x0, y0, x1, y1]
}

export default function SafetyMap() {
  const elRef = useRef(null)
  const markersRef = useRef({})
  const layerRef = useRef(null)
  const { maps, map, error: mapError } = useNaverMap(elRef, { center: CENTER })
  const [edges, setEdges] = useState(null)
  const [facilities, setFacilities] = useState(null)
  const [meta, setMeta] = useState(null)
  const [dataError, setDataError] = useState(null)
  const error = mapError || dataError
  const [visible, setVisible] = useState({ cctv: false, bell: true, police: true, store: false })
  const [selected, setSelected] = useState(null)

  // 데이터 불러오기
  useEffect(() => {
    Promise.all([loadEdges(), loadFacilities()])
      .then(([e, f]) => { setEdges(e); setFacilities(f) })
      .catch((err) => setDataError(err.message))
    // 기준일은 없어도 지도는 보이게
    loadMeta().then(setMeta).catch(() => setMeta(null))
  }, [])

  // 지도가 바뀌거나 사라지면 마커 기록 비움
  useEffect(() => () => { markersRef.current = {} }, [map])

  // 구간 그리기 (캔버스 오버레이 한 장) + 탭으로 구간 고르기
  useEffect(() => {
    if (!maps || !map || !edges) return
    const layer = createSegmentLayer(maps, {
      features: edges.features,
      color: (f) => edgeColor(f.properties),
    })
    layer.setMap(map)
    layerRef.current = layer

    const [x0, y0, x1, y1] = bbox(edges)
    map.fitBounds(new maps.LatLngBounds(new maps.LatLng(y0, x0), new maps.LatLng(y1, x1)))

    const stopTap = listenMapTap(maps, map, elRef.current, (coord) => {
      const tap = point([coord.x, coord.y])
      let best = null
      let bestD = Infinity
      for (const f of edges.features) {
        const d = pointToLineDistance(tap, f, { units: 'meters' })
        if (d < bestD) { bestD = d; best = f }
      }
      if (best) {
        const [x, y] = nearestPointOnLine(best, tap).geometry.coordinates
        const proj = map.getProjection()   // 탭할 때 받아야 함 (미리 받아 두면 fitBounds 전 상태로 계산됨)
        const a = proj.fromCoordToOffset(coord)
        const b = proj.fromCoordToOffset(new maps.LatLng(y, x))
        if (Math.hypot(a.x - b.x, a.y - b.y) > TAP_PX) best = null
      }
      setSelected(best)
    })
    return () => {
      stopTap()
      layer.setMap(null)
      layerRef.current = null
    }
  }, [maps, map, edges])

  // 고른 구간 강조
  useEffect(() => {
    layerRef.current?.setSelected(selected)
  }, [selected])

  // 시설 마커 켜고 끄기
  useEffect(() => {
    if (!maps || !map || !facilities) return
    for (const [type, t] of Object.entries(FACILITY_TYPES)) {
      const on = visible[type]
      const have = markersRef.current[type]
      if (on && !have) {
        const size = type === 'police' ? 14 : 9
        markersRef.current[type] = facilities.features
          .filter((f) => f.properties.type === type)
          .map((f) => {
            const [lon, lat] = f.geometry.coordinates
            return new maps.Marker({
              map,
              position: new maps.LatLng(lat, lon),
              title: `${t.label}${f.properties.name ? ` · ${f.properties.name}` : ''}`,
              clickable: false,
              icon: {
                content: `<span class="fac-dot" style="width:${size}px;height:${size}px;background:${t.color}"></span>`,
                anchor: new maps.Point(size / 2, size / 2),
              },
            })
          })
      } else if (!on && have) {
        for (const m of have) m.setMap(null)
        delete markersRef.current[type]
      }
    }
  }, [maps, map, facilities, visible])

  const nearby = useMemo(() => {
    if (!selected || !facilities) return []
    return facilities.features
      .map((f) => ({ f, d: pointToLineDistance(f, selected, { units: 'meters' }) }))
      .filter(({ d }) => d <= NEARBY_M)
      .sort((a, b) => a.d - b.d)
  }, [selected, facilities])

  const nearbyCounts = useMemo(() => {
    const c = {}
    for (const { f } of nearby) c[f.properties.type] = (c[f.properties.type] || 0) + (f.properties.count || 1)
    return c
  }, [nearby])

  const p = selected?.properties

  return (
    <div className="map-screen">
      {/* 네이버 지도가 컨테이너에 position:relative를 넣어서, 바깥 칸으로 크기를 잡고 안쪽에 지도를 붙임 */}
      <div className="map">
        <div ref={elRef} className="map-canvas" />
      </div>

      <header className="map-top">
        <h1 className="brand">길잡이들</h1>
        <div className="chips" role="group" aria-label="시설 레이어">
          {Object.entries(FACILITY_TYPES).map(([type, t]) => (
            <button
              key={type}
              className={`chip ${visible[type] ? 'on' : ''}`}
              aria-pressed={visible[type]}
              onClick={() => setVisible((v) => ({ ...v, [type]: !v[type] }))}
            >
              <span className="dot" style={{ background: t.color }} />
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {error && <div className="loading error" role="alert">{error}</div>}
      {!error && (!edges || !maps) && <div className="loading">안전도 불러오는 중…</div>}

      {selected ? (
        <section className="sheet" aria-label="구간 정보">
          <button className="sheet-close" onClick={() => setSelected(null)} aria-label="닫기">×</button>
          <div className="score-row">
            <span className="score-badge" style={{ background: edgeColor(p) }}>{p.score}</span>
            <div>
              <p className="score-title">안전점수 {p.score}점 · {p.grade}등급</p>
              <p className="muted">길이 {Math.round(p.length)}m · 1등급 안전 ~ 5등급 위험 (분석 범위 안 상대 순위)</p>
            </div>
          </div>
          {isNoDataArea(p) && (
            <p className="no-data-note">
              {p.area_type === 'outside_namgu'
                ? '공공데이터 미포함 · 남구 밖이라 데이터 없음. 보안등·CCTV·상가 데이터가 남구 것만 있어서 점수가 실제보다 낮게 나와요'
                : `공공데이터 미포함 · ${AREA_LABELS[p.area_type]} 안이라 단지·학교 자체 CCTV·조명이 점수에 없어요. 실제보다 낮게 나올 수 있어요`}
            </p>
          )}
          {p.streetlight_missing && (
            <p className="no-data-note">
              가로등 미반영 · {p.highway === 'footway' ? '큰길 옆 인도·횡단보도' : '큰길'}이라 가로등이 있어도 보안등 데이터에 없어 점수가 낮게 나올 수 있어요
            </p>
          )}
          <p className="sheet-sub">주변 {NEARBY_M}m 시설</p>
          {nearby.length === 0 ? (
            <p className="muted">주변에 CCTV·비상벨·지구대·편의점이 없어요</p>
          ) : (
            <ul className="nearby">
              {Object.entries(FACILITY_TYPES).filter(([type]) => nearbyCounts[type]).map(([type, t]) => (
                <li key={type}>
                  <span className="dot" style={{ background: t.color }} />
                  {t.label} {nearbyCounts[type]}{type === 'cctv' ? '대' : '곳'}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="legend" aria-label="범례">
          <div className="legend-bar" style={{ background: GRADIENT_CSS }} />
          <div className="legend-labels"><span>위험</span><span>안전</span></div>
          <p className="legend-nodata">
            <span className="legend-swatch" style={{ background: NO_DATA_COLOR }} />
            공공데이터 미포함 (사유지·남구 밖)
          </p>
          {meta && (
            <p className="legend-date">
              기준일 {Object.values(meta.datasets).map((d) => `${d.label} ${d.base_date}`).join(' · ')}
              {' · '}{meta.road.label} {meta.road.source} ({meta.road.downloaded} 받음)
            </p>
          )}
        </section>
      )}
    </div>
  )
}
