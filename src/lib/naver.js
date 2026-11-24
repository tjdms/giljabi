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
