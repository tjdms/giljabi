import { useEffect, useMemo, useRef, useState } from 'react'
import { loadEdges } from '../data.js'
import { edgeColor } from '../colors.js'
import { PLACES } from '../places.js'
import { buildGraph, compareRoutes } from '../lib/route.js'
import { createSegmentLayer } from '../lib/segmentLayer.js'
import { listenMapTap, useNaverMap } from '../lib/useNaverMap.js'
import { fitBoundsAll } from '../lib/naver.js'
import Navigation from './Navigation.jsx'

const CENTER = [35.1375, 129.0995]
const SAFE_COLOR = '#6EC6FF'
const SHORT_COLOR = '#9AA0AA'
const SNAP_WARN_M = 150   // 가장 가까운 길이 이보다 멀면 분석 범위 밖으로 봄

// ?from=위도,경도&to=위도,경도 로 바로 열기 (시연·공유용)
function paramPoint(name) {
  const v = new URLSearchParams(window.location.search).get(name)
  const p = v?.split(',').map(Number)
  return p?.length === 2 && p.every(Number.isFinite) ? p : null
}

const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`)
const samePoint = (a, b) => a && b && a[0] === b[0] && a[1] === b[1]

export default function RouteCompare() {
  const elRef = useRef(null)
  const { maps, map, error: mapError } = useNaverMap(elRef, { center: CENTER })
  const [edges, setEdges] = useState(null)
  const [error, setError] = useState(null)
  const [start, setStart] = useState(paramPoint('from'))
  const [end, setEnd] = useState(paramPoint('to'))
  const [picking, setPicking] = useState(paramPoint('from') ? 'end' : 'start')
  const [focus, setFocus] = useState('safe')
  // 안내 중이면 'gps' 또는 'demo'. ?nav=demo 로 바로 데모 시작 (시연용)
  const [nav, setNav] = useState(() => {
    const v = new URLSearchParams(window.location.search).get('nav')
    return v === 'gps' || v === 'demo' ? v : null
  })
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    loadEdges().then(setEdges).catch((err) => setError(err.message))
  }, [])

  const graph = useMemo(() => (edges ? buildGraph(edges) : null), [edges])
  const result = useMemo(
    () => (graph && start && end ? compareRoutes(graph, start, end) : null),
    [graph, start, end],
  )
  const offNetwork = result?.snap?.some((s) => s.dist > SNAP_WARN_M)

  const setPoint = (p) => {
    if (nav) return   // 안내 중에는 지도 탭으로 출발·도착을 바꾸지 않음
    if (picking === 'start') { setStart(p); setPicking(end ? null : 'end') }
    else if (picking === 'end') { setEnd(p); setPicking(start ? null : 'start') }
  }
  // 탭 리스너가 최신 상태를 보게
  const setPointRef = useRef(setPoint)
  setPointRef.current = setPoint

  // 배경 안전도 (흐리게) + 지도 탭으로 출발·도착 고르기
  useEffect(() => {
    if (!maps || !map || !edges) return
    const layer = createSegmentLayer(maps, {
      features: edges.features,
      color: (f) => edgeColor(f.properties),
      weight: 1.5,
      opacity: 0.35,
    })
    layer.setMap(map)
    const stopTap = listenMapTap(maps, map, elRef.current, (c) => setPointRef.current([c.y, c.x]))
    return () => { stopTap(); layer.setMap(null) }
  }, [maps, map, edges])

  // 두 경로 + 출발·도착 표시 (안내 중에는 안내 화면이 그림)
  useEffect(() => {
    if (!maps || !map || nav) return
    const overlays = []
    const pin = (latlng, label, cls) => overlays.push(new maps.Marker({
      map,
      position: new maps.LatLng(...latlng),
      clickable: false,
      icon: { content: `<div class="pin ${cls}">${label}</div>`, anchor: new maps.Point(20, 24) },
    }))
    if (result?.short) {
      const draw = (id, r, color) => overlays.push(new maps.Polyline({
        map,
        path: r.coords.map(([lat, lon]) => new maps.LatLng(lat, lon)),
        strokeColor: color,
        strokeWeight: id === focus ? 7 : 5,
        strokeOpacity: id === focus ? 1 : 0.7,
        strokeStyle: id === 'short' ? 'shortdash' : 'solid',
        strokeLineCap: 'round',
        clickable: false,
        zIndex: id === focus ? 20 : 10,   // 고른 경로를 위에
      }))
      draw('short', result.short, SHORT_COLOR)
      draw('safe', result.safe, SAFE_COLOR)
    }
    if (start) pin(start, '출발', 'pin-start')
    if (end) pin(end, '도착', 'pin-end')
    return () => { for (const o of overlays) o.setMap(null) }
  }, [maps, map, result, start, end, focus, nav])

  // 새 경로가 나오거나 안내가 끝나면 두 경로가 다 보이게
  useEffect(() => {
    if (!maps || !map || !result?.short || nav) return
    const pts = [...result.safe.coords, ...result.short.coords]
    const lats = pts.map((p) => p[0])
    const lons = pts.map((p) => p[1])
    fitBoundsAll(maps, map, [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)], { top: 170, right: 24, bottom: 230, left: 24 })
  }, [maps, map, result, nav])

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError('이 브라우저는 위치를 지원하지 않아요'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        setStart([pos.coords.latitude, pos.coords.longitude])
        setPicking(end ? null : 'end')
      },
      () => { setLocating(false); setError('내 위치를 가져오지 못했어요. 지도에서 출발 지점을 눌러 주세요') },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const swap = () => { setStart(end); setEnd(start) }
  const reset = () => { setStart(null); setEnd(null); setPicking('start') }
  const placeName = (p) => PLACES.find((x) => samePoint(x.latlng, p))?.label

  const same = result?.short && Math.abs(result.safe.length - result.short.length) < 1
  const extra = result?.short ? result.safe.length - result.short.length : 0
  const bothScored = result?.short && result.safe.score !== null && result.short.score !== null
  const scoreDiff = bothScored ? Math.round(result.safe.score - result.short.score) : null
  const routes = result?.short ? [
    { id: 'safe', label: '안심 경로', color: SAFE_COLOR, r: result.safe },
    { id: 'short', label: '최단 경로', color: SHORT_COLOR, r: result.short },
  ] : []
  const shownError = mapError || error || result?.error

  return (
    <div className="map-screen">
      <div className="map">
        <div ref={elRef} className="map-canvas" />
      </div>

      {!nav && <header className="route-top">
        <div className="od">
          <button className={`od-row ${picking === 'start' ? 'picking' : ''}`} onClick={() => setPicking('start')}>
            <span className="od-dot start" />
            <span className="od-label">{start ? (placeName(start) ?? '출발 지점') : '출발 — 지도를 누르거나 아래에서 고르기'}</span>
          </button>
          <button className={`od-row ${picking === 'end' ? 'picking' : ''}`} onClick={() => setPicking('end')}>
            <span className="od-dot end" />
            <span className="od-label">{end ? (placeName(end) ?? '도착 지점') : '도착 — 지도를 누르거나 아래에서 고르기'}</span>
          </button>
        </div>
        <div className="od-actions" role="group" aria-label="출발·도착 고르기">
          <button className="chip on" onClick={useMyLocation} disabled={locating}>
            {locating ? '위치 찾는 중…' : '내 위치에서 출발'}
          </button>
          {PLACES.map((p) => (
            <button
              key={p.id}
              className="chip"
              disabled={!p.latlng || !picking}
              title={p.latlng ? undefined : '좌표를 아직 확인하지 못했어요'}
              onClick={() => setPoint(p.latlng)}
            >
              {p.label}{p.latlng ? '' : ' (좌표 필요)'}
            </button>
          ))}
          {start && end && <button className="chip" onClick={swap}>바꾸기</button>}
          {(start || end) && <button className="chip" onClick={reset}>다시 고르기</button>}
        </div>
      </header>}

      {!edges && !shownError && <div className="loading">길 정보 불러오는 중…</div>}

      {shownError && (
        <div className="toast" role="alert" onClick={() => setError(null)}>{shownError}</div>
      )}

      {result?.short && !nav && (
        <section className="sheet route-sheet" aria-label="경로 비교">
          {offNetwork && <p className="warn">출발이나 도착이 분석 범위(대학가 반경 1.2km) 밖이라 가장 가까운 길에서 계산했어요</p>}
          <div className="route-cards">
            {routes.map(({ id, label, color, r }) => (
              <button
                key={id}
                className={`route-card ${focus === id ? 'on' : ''}`}
                style={{ '--c': color }}
                onClick={() => setFocus(id)}
                aria-pressed={focus === id}
              >
                <span className="route-name"><span className={`swatch ${id}`} />{label}</span>
                <span className="route-big">{fmtM(r.length)}</span>
                <span className="muted">도보 약 {Math.max(1, Math.round(r.minutes))}분</span>
                <span className="route-score">평균 점수 <b>{r.score === null ? '정보 없음' : Math.round(r.score)}</b></span>
                {r.noDataLength >= 1 && (
                  <span className="route-nodata">공공데이터 미포함 구간 {fmtM(r.noDataLength)}({Math.round(r.noDataRatio * 100)}%)</span>
                )}
              </button>
            ))}
          </div>
          <p className="route-diff">
            {same
              ? '최단 경로가 가장 안심되는 길이에요'
              : `안심 경로가 ${fmtM(extra)}(+${Math.round((extra / result.short.length) * 100)}%) 더 걸어요${scoreDiff === null ? '' : `. 평균 점수는 ${scoreDiff >= 0 ? '+' : ''}${scoreDiff}점이에요`}`}
          </p>
          <div className="nav-start">
            <button className="nav-start-main" onClick={() => setNav('gps')}>안심 경로로 안내 시작</button>
            <button className="chip" onClick={() => setNav('demo')}>데모로 보기</button>
          </div>
        </section>
      )}

      {/* 안내 화면은 같은 지도 위에 UI만 겹쳐 띄움 (끝내면 비교 화면 그대로) */}
      {nav && result?.safe && maps && map && (
        <div className="nav-layer">
          <Navigation maps={maps} map={map} graph={graph} route={result.safe} dest={end} mode={nav} onExit={() => setNav(null)} />
        </div>
      )}
    </div>
  )
}
