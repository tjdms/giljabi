// public/data/의 결과 파일 읽기 (scripts/score.py가 생성)
const base = import.meta.env.BASE_URL

const cache = new Map()   // 탭을 바꿔도 다시 받지 않게

function getJson(name) {
  if (!cache.has(name)) {
    const p = fetch(`${base}data/${name}`).then((res) => {
      if (!res.ok) throw new Error(`${name}을(를) 불러오지 못했어요 (${res.status})`)
      return res.json()
    })
    p.catch(() => cache.delete(name))   // 실패하면 다음에 다시 시도
    cache.set(name, p)
  }
  return cache.get(name)
}

export const loadEdges = () => getJson('edges_scored.geojson')
export const loadFacilities = () => getJson('facilities.geojson')
export const loadMeta = () => getJson('meta.json')

export const FACILITY_TYPES = {
  cctv:   { label: 'CCTV',   color: '#C792EA' },
  bell:   { label: '비상벨', color: '#FFFFFF' },
  police: { label: '지구대', color: '#F48FB1' },
  store:  { label: '편의점', color: '#80CBC4' },
}
