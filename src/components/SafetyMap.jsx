import { useEffect, useMemo, useRef, useState } from 'react'
import { nearestPointOnLine, point, pointToLineDistance } from '@turf/turf'
import { FACILITY_TYPES, loadEdges, loadFacilities, loadMeta } from '../data.js'
import { GRADIENT_CSS, safetyColor } from '../colors.js'
import { AUTH_FAILURE_EVENT, createMap, loadNaverMaps } from '../lib/naver.js'
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
  const mapRef = useRef(null)
  const markersRef = useRef({})
  const layerRef = useRef(null)
  const [maps, setMaps] = useState(null)
  const [edges, setEdges] = useState(null)
  const [facilities, setFacilities] = useState(null)
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState(null)
  const [visible, setVisible] = useState({ cctv: false, bell: true, police: true, store: false })
  const [selected, setSelected] = useState(null)

  // 지도 + 데이터 불러오기
  useEffect(() => {
    let map
    let cancelled = false   // 스크립트 로드 전에 정리되면 지도를 만들지 않음 (StrictMode 이중 실행 때 지도 두 개 생김 방지)
    const onAuthFail = () => setError('네이버 지도 인증에 실패했어요. 클라이언트 ID와 콘솔에 등록한 Web 서비스 URL을 확인해 주세요')
    window.addEventListener(AUTH_FAILURE_EVENT, onAuthFail)
    loadNaverMaps()
      .then((m) => {
        if (cancelled) return
        map = createMap(m, elRef.current, {
          center: new m.LatLng(...CENTER),
          zoom: 15,
          zoomControl: false,
          mapDataControl: false,
          scaleControl: false,
        })
        mapRef.current = map
        setMaps(m)
      })
      .catch((err) => setError(err.message))
    Promise.all([loadEdges(), loadFacilities()])
      .then(([e, f]) => { setEdges(e); setFacilities(f) })
      .catch((err) => setError(err.message))
    // 기준일은 없어도 지도는 보이게
    loadMeta().then(setMeta).catch(() => setMeta(null))
    return () => {
      cancelled = true
      window.removeEventListener(AUTH_FAILURE_EVENT, onAuthFail)
      for (const list of Object.values(markersRef.current)) for (const m of list) m.setMap(null)
      markersRef.current = {}
      map?.destroy()
      mapRef.current = null
    }
  }, [])

  // 구간 그리기 (캔버스 오버레이 한 장) + 탭으로 구간 고르기
  useEffect(() => {
    const map = mapRef.current
    if (!maps || !map || !edges) return
    const layer = createSegmentLayer(maps, {
      features: edges.features,
      color: (f) => safetyColor(f.properties.safety),
    })
    layer.setMap(map)
    layerRef.current = layer

    const [x0, y0, x1, y1] = bbox(edges)
    map.fitBounds(new maps.LatLngBounds(new maps.LatLng(y0, x0), new maps.LatLng(y1, x1)))

    const proj = map.getProjection()
    const pickAt = (pageX, pageY) => {
      const coord = proj.fromPageXYToCoord(new maps.Point(pageX, pageY))
      const tap = point([coord.x, coord.y])
      let best = null
      let bestD = Infinity
      for (const f of edges.features) {
        const d = pointToLineDistance(tap, f, { units: 'meters' })
        if (d < bestD) { bestD = d; best = f }
      }
      if (best) {
        const [x, y] = nearestPointOnLine(best, tap).geometry.coordinates
        const a = proj.fromCoordToOffset(coord)
        const b = proj.fromCoordToOffset(new maps.LatLng(y, x))
        if (Math.hypot(a.x - b.x, a.y - b.y) > TAP_PX) best = null
      }
      setSelected(best)
    }
    // GL 지도는 click 이벤트를 주지 않아서, 눌렀다 뗀 위치가 거의 같으면(끌기가 아니면) 탭으로 봄
    const el = elRef.current
    let down = null
    const onDown = (e) => { down = e.isPrimary ? { x: e.pageX, y: e.pageY, t: e.timeStamp } : null }
    const onUp = (e) => {
      if (down && Math.hypot(e.pageX - down.x, e.pageY - down.y) < 6 && e.timeStamp - down.t < 600) pickAt(e.pageX, e.pageY)
      down = null
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      layer.setMap(null)
      layerRef.current = null
    }
  }, [maps, edges])

  // 고른 구간 강조
  useEffect(() => {
    layerRef.current?.setSelected(selected)
  }, [selected])

  // 시설 마커 켜고 끄기
  useEffect(() => {
    const map = mapRef.current
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
  }, [maps, facilities, visible])

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
            <span className="score-badge" style={{ background: safetyColor(p.safety) }}>{p.score}</span>
            <div>
              <p className="score-title">안전점수 {p.score}점 · {p.grade}등급</p>
              <p className="muted">길이 {Math.round(p.length)}m · 1등급 안전 ~ 5등급 위험 (분석 범위 안 상대 순위)</p>
            </div>
          </div>
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
