# 길잡이들 — 안심 귀갓길 앱

부산 남구 대학가(경성대·부경대·대연동) 심야 귀갓길 안전도를 공공데이터로 점수화하고, 최단 경로 대신 안심 경로를 추천하는 모바일 웹앱.
슬로건: **가장 짧은 길보다, 더 안심되는 길**

## 작업 규칙
- 한국어로 답하고, 커밋 메시지도 한국어로 짧게 쓴다.
- 기능별 브랜치에서 작업하고 PR로 main에 합친다: `feature/data`, `feature/map`, `feature/route`, `feature/navigation`, `feature/sos`
- 데이터를 지어내지 않는다. 점수·시설 데이터가 없으면 멈추고 알린다. 화면 확인용 임시 데이터가 필요하면 파일명에 `sample_`을 붙이고 화면에도 "샘플"이라고 표시한다.
- 작업 하나 끝날 때마다 `npm run build`가 통과하는지 확인한다.

## 기술 스택
- 앱: Vite + React + Leaflet(react-leaflet) + Turf.js, 서버 없이 정적 사이트
- 지도 타일: CARTO dark (출처 표기 필수)
- 경로 계산: 브라우저에서 직접 (edges_scored.geojson의 u, v로 그래프 만들고 다익스트라)
- 점수 계산: Python (osmnx, geopandas, rasterio) — `scripts/`
- 배포: Vercel

## 폴더 구조
```
data/clean/          정리된 공공데이터 (수정 금지)
scripts/             점수 계산 파이썬 (노트북 → score.py)
public/data/         앱이 읽는 결과 파일 (scripts가 생성)
src/                 앱 코드
```

## 데이터 (data/clean/)
공통 컬럼: id, type, name, lat, lon, count, base_date, source, note (WGS84)

| 파일 | 용도 |
|---|---|
| light_namgu.csv | 보안등 4,831지점 — 점수 |
| cctv_namgu.csv | CCTV 861지점 (count = 카메라 대수) — 점수 + 지도 |
| shop_namgu.csv | 상가 4,066곳 — 점수 |
| dem_namgu.tif | 경사도 (DEM 90m, EPSG:5179) — 점수 |
| bell_namgu.csv | 비상벨 80 — 지도만 |
| police_namgu.csv | 지구대·파출소 7 — 지도·SOS |
| store_namgu.csv | 편의점 153 — 지도만 |
| safe_road_namgu.csv | 구청 안심귀갓길 시설 17 — 비교용 |
| bus_namgu.csv | 버스정류장 511 — 지도만(선택) |

## 안전점수 (scripts/score.py)
`scripts/길잡이들_안전점수_계산.ipynb`를 그대로 옮겨서 로컬에서 실행되는 score.py로 만든다. 계산 방식은 노트북을 따르고 바꾸지 않는다.
- 도로망: OSMnx 보행 네트워크, 교차로~교차로 구간, 거리 계산은 EPSG:5179
- 보행망에서 뺌 (`drop_unwalkable`): 운전면허시험장 코스(service=driving_learning), 출입 금지(access=private/no, 단 foot=yes·designated면 유지), 묘역(landuse=cemetery) 안, 이용 시간이 정해진(24/7 아님) 구역 안(UN기념공원: OSM에 leisure=park + 9~17/18시). 구간 중간점 기준. 7,710 → 7,288구간
  - 정규화가 남은 구간 기준이라 다른 구간 safety도 조금 바뀜(평균 0.004)
- 지표·가중치(이정현 외 2024 재조정): 보안등 0.414, CCTV 0.356, 상가 0.168, 경사도 0.062(가파를수록 위험)
- 밀도 = 반경 내 시설 수 ÷ 구간 길이 × 100 (반경: 보안등 25m, CCTV·상가 50m, 최소 길이 20m)
- 인도(footway=sidewalk)·횡단보도(crossing) 구간은 30m 안 가장 가까운 차도 구간과 짝지어 지표별로 max(자기 밀도, 차도 밀도)를 씀. 인도가 따로 그려진 차도는 보행망에 없어서 차도망(drive)을 따로 받아 밀도만 계산 (경로 그래프는 보행망 그대로)
- 정규화: 상위 5% 잘라서 min-max → 가중합 = safety(0~1) → 5분위 등급
- risk = 1 − safety, cost = length × (1 + risk)
- 출력 `public/data/edges_scored.geojson`: 구간 LineString, 속성 u, v, length, safety, score(=safety×100 반올림), grade(1~5), cost
  - light_n, cctv_n, shop_n, slope_n: 지표별 정규화 값(0~1, 클수록 안전 방향, slope_n은 평평할수록 1). safety = 0.414·light_n + 0.356·cctv_n + 0.168·shop_n + 0.062·slope_n (반올림 오차 0.0001 이하)
  - 불리언(no_public_data, blindspot_exclude, streetlight_missing)은 JSON true/false
  - area_type(apartment/campus/school/park 또는 null), no_public_data(area_type 있으면 true), blindspot_exclude(outside_namgu/apartment/campus/school이면 true)
  - paired_highway(인도·횡단보도가 짝지어진 차도 종류), streetlight_missing(큰길 trunk~tertiary·_link 또는 그 옆에 짝지어진 인도·횡단보도면 true: 보안등 데이터에 가로등이 없어 점수가 낮게 나옴)
  - highway(OSM 도로 종류), name(OSM 도로 이름, 없으면 null — 약 35%만 있음), usage(이용 빈도: 무작위 출발·도착 1,000쌍(직선 300m~2km, 시드 20261126)의 최단 경로가 지나간 횟수, 양방향 합산)
  - 구역: OSM 남구 행정경계(relation 4068408) 밖 = outside_namgu, landuse=residential 중 building=apartments가 들어 있는 영역 = apartment, amenity=university/college = campus, amenity=school = school, leisure=park = park. 구간 중간점 기준, 겹치면 outside_namgu > campus > school > apartment > park
  - 남구 밖: 보안등·CCTV·상가 데이터가 남구 것만 있어서 분석 범위 중 수영구 쪽 등은 시설이 없는 것처럼 나옴 (구간 11.6%)
  - 아파트·캠퍼스·학교 안 시설(CCTV·조명)은 사유지라 공공데이터에 없음 → 점수는 그대로 두고 지도·경로에서 따로 처리
- 출력 `public/data/facilities.geojson`: cctv, bell, police, store 점 데이터 (type 속성 포함)
- 출력 `public/data/meta.json`: 데이터별 기준일·출처 (보안등·CCTV·상가·비상벨·지구대·편의점) + 도로망 받은 날짜 — 범례 표시용

## 기능 (만드는 순서)
1. **안전도 지도**: 구간을 safety 값으로 그라데이션 색칠, 시설 레이어 켜고 끄기, 구간 누르면 점수·주변 시설 표시, 범례·데이터 기준일
2. **경로 비교**: 출발·도착 선택(지도 탭/내 위치) → 최단(length 기준) vs 안심(cost 기준) 두 경로를 같이 그리고 거리·예상 시간·평균 점수 비교
3. **실시간 안내**: 안심 경로 선택 후 시작 → `navigator.geolocation.watchPosition`으로 위치 추적, 경로에서 30m 이상 벗어나면 알림 + 재탐색, 도착 20m 안이면 도착 화면. **데모 모드**: 실제 위치 대신 경로를 따라 위치를 일정 속도로 움직임(발표 시연용)
4. **SOS**: 모든 화면에 떠 있는 버튼 → `tel:112` 전화, 보호자에게 현재 위치 링크 `sms:` 문자, 가까운 지구대·비상벨 표시. 자동 신고 아님
5. (추가) 같이 걷기: 안내 중 마스코트가 함께 걷는 화면 — 마스코트 미정, 자리만
6. (추가) 사각지대·제안: 점수 낮은 구간 목록

## 디자인
- 와이어프레임 v3 (11화면): https://www.figma.com/design/tNcgMtGYpbOeZW6MnmabvO
- 다크 톤: 배경 #1B2440
- 안전도 그라데이션: 파랑(안전) → 노랑 → 주황(위험). 적록색약 고려해 초록·빨강 쓰지 않음
- 안심 경로 선 #6EC6FF, 최단 경로 선 #9AA0AA
- 폰트: Noto Sans KR
- 모바일 우선 (390px 기준), 하단 탭 3개: 안전도 지도 / 경로 / 사각지대
