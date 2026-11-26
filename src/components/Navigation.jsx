import { useEffect, useMemo, useRef, useState } from 'react'
import { compareRoutes } from '../lib/route.js'
import { NAV_OPTIONS, distanceM, lineLengthM, offsetFromRoute, pointAlongM, progressOn, routeLine } from '../lib/nav.js'
import { useNaverMap } from '../lib/useNaverMap.js'

const SAFE_COLOR = '#6EC6FF'
const DEMO_TICK_MS = 200
const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`)

// 실시간 안내. mode: 'gps'(실제 위치) 또는 'demo'(경로를 따라 일정 속도로 움직임, 발표 시연용)
export default function Navigation({ graph, route, dest, mode, onExit }) {
  const elRef = useRef(null)
  const { maps, map, error: mapError } = useNaverMap(elRef, { center: route.coords[0], zoom: 17 })
  const [current, setCurrent] = useState(route)   // 따라가는 안심 경로 (재탐색하면 바뀜)
  const line = useMemo(() => routeLine(current.coords), [current])
  const totalM = useMemo(() => lineLengthM(line), [line])
  const [pos, setPos] = useState(null)             // { latlng, accuracy }
  const [status, setStatus] = useState('nav')      // 'nav' | 'arrived'
  const [notice, setNotice] = useState(null)
  const [gpsError, setGpsError] = useState(null)
  const [speed, setSpeed] = useState(5)
  const [paused, setPaused] = useState(false)
  const [follow, setFollow] = useState(true)
  const [reroutes, setReroutes] = useState(0)
  const demoAlong = useRef(0)
  const offCount = useRef(0)
  const startedAt = useRef(Date.now())
  const walked = useRef({ m: 0, last: null })

  const prog = useMemo(() => (pos ? progressOn(line, pos.latlng, totalM) : null), [pos, line, totalM])

  // 데모: 새 경로가 생기면 그 시작점부터 다시 걸음
  useEffect(() => { demoAlong.current = 0 }, [line])

  // 데모: 경로를 따라 일정 속도로 위치 이동
  useEffect(() => {
    if (mode !== 'demo' || status !== 'nav' || paused) return
    const id = setInterval(() => {
      demoAlong.current = Math.min(totalM, demoAlong.current + NAV_OPTIONS.walkMps * speed * (DEMO_TICK_MS / 1000))
      setPos({ latlng: pointAlongM(line, demoAlong.current), accuracy: 0 })
    }, DEMO_TICK_MS)
    return () => clearInterval(id)
  }, [mode, status, paused, speed, line, totalM])

  // GPS: 실제 위치 추적 + 화면 꺼짐 막기
  useEffect(() => {
    if (mode !== 'gps' || status !== 'nav') return
    if (!navigator.geolocation) { setGpsError('이 브라우저는 위치를 지원하지 않아요'); return }
    const id = navigator.geolocation.watchPosition(
      (p) => { setGpsError(null); setPos({ latlng: [p.coords.latitude, p.coords.longitude], accuracy: p.coords.accuracy }) },
      (err) => setGpsError(err.code === 1 ? '위치 권한이 꺼져 있어요. 브라우저 설정에서 허용해 주세요' : '위치를 받지 못하고 있어요'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    )
    let lock = null
    navigator.wakeLock?.request('screen').then((l) => { lock = l }).catch(() => {})
    return () => { navigator.geolocation.clearWatch(id); lock?.release().catch(() => {}) }
  }, [mode, status])

  // 위치가 바뀔 때마다: 걸은 거리, 도착, 경로 이탈 → 재탐색
  useEffect(() => {
    if (!pos || !prog || status !== 'nav') return
    const w = walked.current
    if (w.last) w.m += distanceM(w.last, pos.latlng)
    w.last = pos.latlng

    const near = (p) => distanceM(pos.latlng, p) <= NAV_OPTIONS.arriveM
    if (near(current.coords.at(-1)) || near(dest)) {
      setStatus('arrived')
      navigator.vibrate?.(300)
      return
    }
    const reliable = mode === 'demo' || (pos.accuracy ?? 0) <= NAV_OPTIONS.maxAccuracyM
    if (!reliable || prog.offM <= NAV_OPTIONS.offRouteM) { offCount.current = 0; return }
    offCount.current += 1
    if (offCount.current < (mode === 'demo' ? 1 : NAV_OPTIONS.offRouteFixes)) return
    offCount.current = 0
    navigator.vibrate?.([200, 100, 200])
    const r = compareRoutes(graph, pos.latlng, dest)
    if (r.safe) {
      setCurrent(r.safe)
      setReroutes((n) => n + 1)
      setNotice(`경로에서 ${Math.round(prog.offM)}m 벗어나서 새 안심 경로를 찾았어요`)
    } else {
      setNotice('경로를 벗어났어요. 새 경로를 찾지 못했어요')
    }
    // 위치가 바뀔 때만 판정 (경로가 바뀐 직후 같은 위치로 다시 판정하지 않게)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(id)
  }, [notice])

  // 지도: 경로 + 도착 표시
  useEffect(() => {
    if (!maps || !map) return
    const overlays = [
      new maps.Polyline({
        map,
        path: current.coords.map(([lat, lng]) => new maps.LatLng(lat, lng)),
        strokeColor: SAFE_COLOR,
        strokeWeight: 8,
        strokeOpacity: 0.95,
        strokeLineCap: 'round',
        clickable: false,
      }),
      new maps.Marker({
        map,
        position: new maps.LatLng(...current.coords.at(-1)),
        clickable: false,
        icon: { content: '<div class="pin pin-end">도착</div>', anchor: new maps.Point(20, 24) },
      }),
    ]
    return () => { for (const o of overlays) o.setMap(null) }
  }, [maps, map, current])

  // 지도: 내 위치 표시 + 따라가기 (지도를 끌면 따라가기 멈춤)
  const meRef = useRef(null)
  useEffect(() => {
    if (!maps || !map) return
    meRef.current = new maps.Marker({
      map,
      position: new maps.LatLng(...route.coords[0]),
      clickable: false,
      zIndex: 200,
      icon: { content: '<div class="me-dot"></div>', anchor: new maps.Point(11, 11) },
    })
    const l = maps.Event.addListener(map, 'dragstart', () => setFollow(false))
    return () => { maps.Event.removeListener(l); meRef.current?.setMap(null) }
  }, [maps, map, route])

  useEffect(() => {
    if (!maps || !map || !pos) return
    const ll = new maps.LatLng(...pos.latlng)
    meRef.current?.setPosition(ll)
    if (follow) map.setCenter(ll)
  }, [maps, map, pos, follow])

  const jumpOff = () => setPos({ latlng: offsetFromRoute(line, demoAlong.current, 45), accuracy: 0 })
  const remainingM = prog ? prog.remainingM : totalM
  const doneRatio = totalM ? 1 - remainingM / totalM : 0
  const elapsedMin = Math.max(1, Math.round((Date.now() - startedAt.current) / 60000))

  return (
    <div className="map-screen nav-screen">
      <div className="map">
        <div ref={elRef} className="map-canvas" />
      </div>

      <header className="nav-top">
        <div>
          <p className="nav-title">안심 경로 안내 중</p>
          <p className="muted">{mode === 'demo' ? `데모 모드 · ${speed}배속` : `GPS${pos?.accuracy ? ` · 정확도 ±${Math.round(pos.accuracy)}m` : ''}`}</p>
        </div>
        <button className="chip" onClick={onExit}>안내 끝내기</button>
      </header>

      {notice && <div className="nav-notice" role="alert">{notice}</div>}
      {(mapError || gpsError) && <div className="toast" role="alert">{mapError || gpsError}</div>}

      {!follow && status === 'nav' && (
        <button className="chip on nav-follow" onClick={() => setFollow(true)}>내 위치로</button>
      )}

      {status === 'nav' ? (
        <section className="sheet nav-sheet" aria-label="안내 정보">
          <div className="nav-remaining">
            <span className="route-big">{fmtM(remainingM)}</span>
            <span className="muted">남음 · 도보 약 {Math.max(1, Math.round(remainingM / (NAV_OPTIONS.walkMps * 60)))}분</span>
          </div>
          <div className="nav-progress" aria-label={`${Math.round(doneRatio * 100)}% 진행`}>
            <div style={{ width: `${doneRatio * 100}%` }} />
          </div>
          {!pos && mode === 'gps' && !gpsError && <p className="muted">위치를 찾는 중이에요…</p>}
          {prog && prog.offM > 10 && <p className="muted">경로에서 {Math.round(prog.offM)}m 떨어져 있어요</p>}
          {mode === 'demo' && (
            <div className="od-actions" role="group" aria-label="데모 조작">
              <button className="chip on" onClick={() => setPaused((p) => !p)}>{paused ? '다시 걷기' : '멈추기'}</button>
              {NAV_OPTIONS.demoSpeeds.map((s) => (
                <button key={s} className={`chip ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}>{s}배속</button>
              ))}
              <button className="chip" onClick={jumpOff}>경로 이탈 흉내</button>
            </div>
          )}
        </section>
      ) : (
        <section className="nav-arrived" aria-label="도착">
          <p className="nav-arrived-title">도착했어요</p>
          <p className="muted">
            걸은 거리 {fmtM(walked.current.m)}{mode === 'gps' ? ` · ${elapsedMin}분` : ''}
            {reroutes ? ` · 경로 다시 찾기 ${reroutes}번` : ''}
          </p>
          <button className="chip on" onClick={onExit}>경로 화면으로</button>
        </section>
      )}
    </div>
  )
}
