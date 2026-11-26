// 네이버 지도 JavaScript API v3 로드 (GL 서브 모듈 + 커스텀 스타일)
// 문서: https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Style-Editor.html

const CLIENT_ID = import.meta.env.VITE_NAVER_CLIENT_ID
export const STYLE_ID = import.meta.env.VITE_NAVER_STYLE_ID

export const AUTH_FAILURE_EVENT = 'naver-auth-failure'

let loading = null

export function loadNaverMaps() {
  if (window.naver?.maps?.Map) return Promise.resolve(window.naver.maps)
  if (loading) return loading
  if (!CLIENT_ID) return Promise.reject(new Error('.env에 VITE_NAVER_CLIENT_ID가 없어요'))

  loading = new Promise((resolve, reject) => {
    const callback = '__giljabiNaverReady'
    window[callback] = () => resolve(window.naver.maps)
    // 인증 실패는 스크립트 로드 뒤에 따로 불리므로 이벤트로 알림
    window.navermap_authFailure = () => window.dispatchEvent(new Event(AUTH_FAILURE_EVENT))
    const s = document.createElement('script')
    s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(CLIENT_ID)}&submodules=gl&callback=${callback}`
    s.onerror = () => { loading = null; reject(new Error('네이버 지도 스크립트를 불러오지 못했어요')) }
    document.head.appendChild(s)
  })
  return loading
}

export function createMap(maps, el, options) {
  if (!STYLE_ID) console.warn('.env에 VITE_NAVER_STYLE_ID가 없어 기본 스타일로 표시해요')
  return new maps.Map(el, {
    gl: true,
    ...(STYLE_ID ? { customStyleId: STYLE_ID } : {}),
    ...options,
  })
}

// fitBounds가 확대 단계를 정수로 잡아 범위가 화면 밖으로 잘리는 경우가 있어서,
// 맞춘 뒤 다 들어왔는지 보고 아니면 0.5단계씩 줄임. box = [최소위도, 최소경도, 최대위도, 최대경도]
export function fitBoundsAll(maps, map, [y0, x0, y1, x1], padding = { top: 0, right: 0, bottom: 0, left: 0 }) {
  map.fitBounds(new maps.LatLngBounds(new maps.LatLng(y0, x0), new maps.LatLng(y1, x1)), padding)
  let tries = 0
  const check = () => {
    const proj = map.getProjection()
    const size = map.getSize()
    const view = map.getBounds()
    const origin = proj.fromCoordToOffset(new maps.LatLng(view.getMax().y, view.getMin().x))   // 화면 왼쪽 위
    const a = proj.fromCoordToOffset(new maps.LatLng(y1, x0))   // 범위 왼쪽 위
    const b = proj.fromCoordToOffset(new maps.LatLng(y0, x1))   // 범위 오른쪽 아래
    // 여백을 절반 넘게 침범하면 덜 맞은 것으로 봄
    const tight = a.x - origin.x < padding.left / 2 || a.y - origin.y < padding.top / 2
      || origin.x + size.width - b.x < padding.right / 2 || origin.y + size.height - b.y < padding.bottom / 2
    if (tight && tries++ < 4) {
      map.setZoom(map.getZoom() - 0.5)
      maps.Event.once(map, 'idle', check)
    }
  }
  maps.Event.once(map, 'idle', check)
}
