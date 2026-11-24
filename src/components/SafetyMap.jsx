import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { pointToLineDistance } from '@turf/turf'
import { FACILITY_TYPES, baseDates, loadEdges, loadFacilities } from '../data.js'
import { GRADIENT_CSS, safetyColor } from '../colors.js'

const CENTER = [35.1375, 129.0995]   // 경성대·부경대역 부근
const NEARBY_M = 50                  // 구간 주변 시설로 보여줄 거리

function FitToData({ edges }) {
  const map = useMap()
  useEffect(() => {
    if (edges) map.fitBounds(L.geoJSON(edges).getBounds(), { padding: [8, 8] })
  }, [edges, map])
  return null
}

function ClearOnMapClick({ onClear }) {
  useMapEvents({ click: onClear })
  return null
}

export default function SafetyMap() {
  const [edges, setEdges] = useState(null)
  const [facilities, setFacilities] = useState(null)
  const [error, setError] = useState(null)
  const [visible, setVisible] = useState({ cctv: false, bell: true, police: true, store: false })
  const [selected, setSelected] = useState(null)
  const renderer = useMemo(() => L.canvas({ tolerance: 8 }), [])

  useEffect(() => {
    Promise.all([loadEdges(), loadFacilities()])
      .then(([e, f]) => { setEdges(e); setFacilities(f) })
      .catch((err) => setError(err.message))
  }, [])

  const dates = useMemo(() => (facilities ? baseDates(facilities) : {}), [facilities])

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

  const onEachEdge = (feature, layer) => {
    layer.on('click', (e) => {
      L.DomEvent.stopPropagation(e)
      setSelected(feature)
    })
  }

  if (error) return <div className="placeholder"><p>{error}</p></div>

  const p = selected?.properties

  return (
    <div className="map-screen">
      <MapContainer center={CENTER} zoom={15} zoomControl={false} preferCanvas className="map">
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          maxZoom={20}
        />
        <FitToData edges={edges} />
        <ClearOnMapClick onClear={() => setSelected(null)} />

        {edges && (
          <GeoJSON
            data={edges}
            renderer={renderer}
            style={(f) => ({ color: safetyColor(f.properties.safety), weight: 3, opacity: 0.9 })}
            onEachFeature={onEachEdge}
          />
        )}
        {selected && (
          <GeoJSON
            key={`${p.u}-${p.v}-${p.length}`}
            data={selected}
            renderer={renderer}
            interactive={false}
            style={{ color: '#FFFFFF', weight: 7, opacity: 0.9 }}
          />
        )}

        {facilities?.features
          .filter((f) => visible[f.properties.type])
          .map((f) => {
            const t = FACILITY_TYPES[f.properties.type]
            const [lon, lat] = f.geometry.coordinates
            return (
              <CircleMarker
                key={f.properties.id}
                center={[lat, lon]}
                radius={f.properties.type === 'police' ? 7 : 4}
                renderer={renderer}
                pathOptions={{ color: '#1B2440', weight: 1, fillColor: t.color, fillOpacity: 1 }}
              >
                <Tooltip>{t.label}{f.properties.name ? ` · ${f.properties.name}` : ''}</Tooltip>
              </CircleMarker>
            )
          })}
      </MapContainer>

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

      {!edges && <div className="loading">안전도 불러오는 중…</div>}

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
          <p className="legend-date">
            기준일 {Object.entries(dates).map(([type, d]) => `${FACILITY_TYPES[type]?.label ?? type} ${d}`).join(' · ')} · 도로망 OpenStreetMap
          </p>
        </section>
      )}
    </div>
  )
}
