import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { GeoJSON, MapContainer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet'
import { loadEdges } from '../data.js'
import { safetyColor } from '../colors.js'
import { buildGraph, compareRoutes } from '../lib/route.js'
import BaseTiles from './BaseTiles.jsx'

const CENTER = [35.1375, 129.0995]
const SAFE_COLOR = '#6EC6FF'
const SHORT_COLOR = '#9AA0AA'
const SNAP_WARN_M = 150   // 가장 가까운 길이 이보다 멀면 분석 범위 밖으로 봄

const pinIcon = (label, cls) => L.divIcon({
  className: '',
  html: `<div class="pin ${cls}">${label}</div>`,
  iconSize: [40, 24],
  iconAnchor: [20, 24],
})
const START_ICON = pinIcon('출발', 'pin-start')
const END_ICON = pinIcon('도착', 'pin-end')

// ?from=위도,경도&to=위도,경도 로 바로 열기 (시연·공유용)
function paramPoint(name) {
  const v = new URLSearchParams(window.location.search).get(name)
  const p = v?.split(',').map(Number)
  return p?.length === 2 && p.every(Number.isFinite) ? p : null
}

function PickOnMap({ onPick }) {
  useMapEvents({ click: (e) => onPick([e.latlng.lat, e.latlng.lng]) })
  return null
}

function FitRoute({ coords }) {
  const map = useMap()
  useEffect(() => {
    if (coords?.length) map.fitBounds(coords, { paddingTopLeft: [24, 150], paddingBottomRight: [24, 190] })
  }, [coords, map])
  return null
}

const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`)

export default function RouteCompare() {
  const [edges, setEdges] = useState(null)
  const [error, setError] = useState(null)
  const [start, setStart] = useState(paramPoint('from'))
  const [end, setEnd] = useState(paramPoint('to'))
  const [picking, setPicking] = useState(paramPoint('from') ? 'end' : 'start')
  const [focus, setFocus] = useState('safe')
  const [locating, setLocating] = useState(false)
  const renderer = useMemo(() => L.canvas(), [])

  useEffect(() => {
    loadEdges().then(setEdges).catch((err) => setError(err.message))
  }, [])

  const graph = useMemo(() => (edges ? buildGraph(edges) : null), [edges])
  const result = useMemo(
    () => (graph && start && end ? compareRoutes(graph, start, end) : null),
    [graph, start, end],
  )
  const offNetwork = result?.snap?.some((s) => s.dist > SNAP_WARN_M)

  const pick = (p) => {
    if (picking === 'start') { setStart(p); setPicking('end') }
    else { setEnd(p); setPicking(null) }
  }

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

  const same = result?.short && Math.abs(result.safe.length - result.short.length) < 1
  const extra = result?.short ? result.safe.length - result.short.length : 0
  const routes = result?.short ? [
    { id: 'short', label: '최단 경로', color: SHORT_COLOR, r: result.short },
    { id: 'safe', label: '안심 경로', color: SAFE_COLOR, r: result.safe },
  ] : []
  // 고른 경로를 위에 그림
  const drawOrder = [...routes].sort((a) => (a.id === focus ? 1 : -1))

  return (
    <div className="map-screen">
      <MapContainer center={CENTER} zoom={15} zoomControl={false} preferCanvas className="map">
        <BaseTiles />
        {edges && (
          <GeoJSON
            data={edges}
            renderer={renderer}
            interactive={false}
            style={(f) => ({ color: safetyColor(f.properties.safety), weight: 1.5, opacity: 0.35 })}
          />
        )}
        <PickOnMap onPick={(p) => (picking ? pick(p) : null)} />
        {drawOrder.map(({ id, color, r }) => (
          <Polyline
            key={id}
            positions={r.coords}
            renderer={renderer}
            pathOptions={{
              color,
              weight: id === focus ? 7 : 5,
              opacity: id === focus ? 1 : 0.7,
              dashArray: id === 'short' ? '8 6' : null,
            }}
          />
        ))}
        {start && <Marker position={start} icon={START_ICON} />}
        {end && <Marker position={end} icon={END_ICON} />}
        <FitRoute coords={result?.safe?.coords} />
      </MapContainer>

      <header className="route-top">
        <div className="od">
          <button className={`od-row ${picking === 'start' ? 'picking' : ''}`} onClick={() => setPicking('start')}>
            <span className="od-dot start" />
            <span className="od-label">{start ? '출발 지점' : '출발 — 지도를 눌러 고르기'}</span>
          </button>
          <button className={`od-row ${picking === 'end' ? 'picking' : ''}`} onClick={() => setPicking('end')}>
            <span className="od-dot end" />
            <span className="od-label">{end ? '도착 지점' : '도착 — 지도를 눌러 고르기'}</span>
          </button>
        </div>
        <div className="od-actions">
          <button className="chip on" onClick={useMyLocation} disabled={locating}>
            {locating ? '위치 찾는 중…' : '내 위치에서 출발'}
          </button>
          {start && end && <button className="chip" onClick={swap}>출발·도착 바꾸기</button>}
          {(start || end) && <button className="chip" onClick={reset}>다시 고르기</button>}
        </div>
      </header>

      {!edges && !error && <div className="loading">길 정보 불러오는 중…</div>}

      {error && (
        <div className="toast" role="alert" onClick={() => setError(null)}>{error}</div>
      )}

      {result?.error && <div className="toast" role="alert">{result.error}</div>}

      {result?.short && (
        <section className="sheet route-sheet" aria-label="경로 비교">
          {offNetwork && <p className="warn">출발이나 도착이 분석 범위(대학가 반경 1.2km) 밖이라 가장 가까운 길에서 계산했어요</p>}
          <div className="route-cards">
            {[...routes].reverse().map(({ id, label, color, r }) => (
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
                <span className="route-score">평균 점수 <b>{Math.round(r.score)}</b></span>
              </button>
            ))}
          </div>
          <p className="route-diff">
            {same
              ? '최단 경로가 가장 안심되는 길이에요'
              : `안심 경로가 ${fmtM(extra)}(+${Math.round((extra / result.short.length) * 100)}%) 더 걷고, 평균 점수는 ${Math.round(result.safe.score - result.short.score) >= 0 ? '+' : ''}${Math.round(result.safe.score - result.short.score)}점이에요`}
          </p>
        </section>
      )}
    </div>
  )
}
