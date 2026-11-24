// public/data/의 결과 파일 읽기 (scripts/score.py가 생성)
const base = import.meta.env.BASE_URL

async function getJson(name) {
  const res = await fetch(`${base}data/${name}`)
  if (!res.ok) throw new Error(`${name}을(를) 불러오지 못했어요 (${res.status})`)
  return res.json()
}

export const loadEdges = () => getJson('edges_scored.geojson')
export const loadFacilities = () => getJson('facilities.geojson')

export const FACILITY_TYPES = {
  cctv:   { label: 'CCTV',   color: '#C792EA' },
  bell:   { label: '비상벨', color: '#FFFFFF' },
  police: { label: '지구대', color: '#F48FB1' },
  store:  { label: '편의점', color: '#80CBC4' },
}

// 시설 종류별 가장 최근 기준일
export function baseDates(facilities) {
  const out = {}
  for (const f of facilities.features) {
    const { type, base_date } = f.properties
    if (base_date && (!out[type] || base_date > out[type])) out[type] = base_date
  }
  return out
}
