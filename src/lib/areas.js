// 공공데이터가 없는 구역 (scripts/score.py의 area_type)
// 아파트 단지·캠퍼스·학교 안 시설(CCTV·조명)은 사유지라 공공데이터에 없어 점수가 낮게 나옴

export const AREA_LABELS = {
  apartment: '아파트 단지',
  campus: '캠퍼스',
  school: '학교',
  park: '공원',
}

// 지도에서 회색으로 칠하고, 경로 고를 때 risk를 대체하고, 비교 카드 평균에서 빼는 구역 (공원은 그대로)
export const NO_DATA_AREAS = new Set(['apartment', 'campus', 'school'])

export const isNoDataArea = (props) => NO_DATA_AREAS.has(props.area_type)
