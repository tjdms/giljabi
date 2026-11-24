import { useEffect, useState } from 'react'
import { AUTH_FAILURE_EVENT, createMap, loadNaverMaps } from './naver.js'

const AUTH_MESSAGE = '네이버 지도 인증에 실패했어요. 클라이언트 ID와 콘솔에 등록한 Web 서비스 URL을 확인해 주세요'

// 지도 칸(elRef)에 네이버 지도를 한 번 만들고 { maps, map, error } 반환
export function useNaverMap(elRef, { center, zoom = 15 }) {
  const [state, setState] = useState({ maps: null, map: null, error: null })

  useEffect(() => {
    let map
    let cancelled = false   // 스크립트 로드 전에 정리되면 지도를 만들지 않음 (StrictMode 이중 실행 때 지도 두 개 생김 방지)
    const onAuthFail = () => setState((s) => ({ ...s, error: AUTH_MESSAGE }))
    window.addEventListener(AUTH_FAILURE_EVENT, onAuthFail)
    loadNaverMaps()
      .then((maps) => {
        if (cancelled) return
        map = createMap(maps, elRef.current, {
          center: new maps.LatLng(...center),
          zoom,
          zoomControl: false,
          mapDataControl: false,
          scaleControl: false,
        })
        setState({ maps, map, error: null })
      })
      .catch((err) => setState((s) => ({ ...s, error: err.message })))
    return () => {
      cancelled = true
      window.removeEventListener(AUTH_FAILURE_EVENT, onAuthFail)
      map?.destroy()
    }
    // 처음 한 번만 만듦
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return state
}

// GL 지도는 click 이벤트를 주지 않아서, 눌렀다 뗀 위치가 거의 같으면(끌기가 아니면) 탭으로 봄.
// onTap(coord)에 지도 좌표(LatLng)를 넘김. 정리 함수 반환
export function listenMapTap(maps, map, el, onTap) {
  let down = null
  const onDown = (e) => { down = e.isPrimary ? { x: e.pageX, y: e.pageY, t: e.timeStamp } : null }
  const onUp = (e) => {
    if (down && Math.hypot(e.pageX - down.x, e.pageY - down.y) < 6 && e.timeStamp - down.t < 600) {
      onTap(map.getProjection().fromPageXYToCoord(new maps.Point(e.pageX, e.pageY)))
    }
    down = null
  }
  el.addEventListener('pointerdown', onDown, true)   // 캡처 단계: 마커 등이 전파를 막아도 받음
  el.addEventListener('pointerup', onUp, true)
  return () => {
    el.removeEventListener('pointerdown', onDown, true)
    el.removeEventListener('pointerup', onUp, true)
  }
}
