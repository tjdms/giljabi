# 길잡이들 — 안심 귀갓길 앱

부산 남구 대학가(경성대·부경대·대연동) 심야 귀갓길 안전도를 공공데이터로 점수화하고, 최단 경로 대신 안심 경로를 추천하는 모바일 웹앱.
슬로건: **가장 짧은 길보다, 더 안심되는 길**

## 작업 규칙
- 한국어로 답하고, 커밋 메시지도 한국어로 짧게 쓴다.
- 기능별 브랜치에서 작업하고 PR로 main에 합친다: `feature/data`, `feature/map`, `feature/route`, `feature/navigation`, `feature/sos`, `feature/blindspot`
- 데이터를 지어내지 않는다. 점수·시설 데이터가 없으면 멈추고 알린다. 화면 확인용 임시 데이터가 필요하면 파일명에 `sample_`을 붙이고 화면에도 "샘플"이라고 표시한다.
- 작업 하나 끝날 때마다 `npm run build`가 통과하는지 확인한다.

## 기술 스택
- 앱: Vite + React + 네이버 지도 JavaScript API v3 + Turf.js, 서버 없이 정적 사이트
- 지도: 네이버 지도 JavaScript API v3, GL 서브 모듈(`submodules=gl`) + `gl: true` + `customStyleId`(Style Editor 다크 스타일). 스크립트 파라미터는 `ncpKeyId` (2025 개편 후)
  - 키: `.env`의 `VITE_NAVER_CLIENT_ID`, `VITE_NAVER_STYLE_ID` (`.env`는 커밋 금지, 형식은 `.env.example`). 클라이언트 ID는 빌드된 JS에 들어가므로 NCP 콘솔에 Web 서비스 URL(localhost, 배포 도메인)을 등록해서 막는다
  - 구간 7,710개는 `src/lib/segmentLayer.js`(OverlayView + 캔버스 한 장)로 그림. 구간마다 Polyline이나 Data 레이어(`addGeoJson`)를 쓰면 페이지가 멈춤 (측정: Data 레이어 넣는 데만 3.3초 뒤 응답 없음)
  - 구간 탭: GL 지도는 click 이벤트를 안 줘서 지도 칸의 pointerdown/pointerup으로 직접 판정 (6px 안에서 뗀 것만), 누른 곳에서 16px 안 가장 가까운 구간
  - 지도 컨테이너에 네이버가 position:relative를 넣으므로 바깥 칸(.map)으로 크기를 잡고 안쪽(.map-canvas)에 지도를 붙임
  - 커스텀 스타일을 쓰면 위성·지형 지도 유형과 교통·지적도 레이어는 못 씀. GL은 drawing·visualization 서브 모듈과 같이 못 씀
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
2. **경로 비교**: 출발·도착 선택(지도 탭/내 위치/자주 가는 곳) → 최단 vs 안심 두 경로를 같이 그리고 거리·예상 시간·평균 점수 비교
   - 안심 경로 고르기 (`src/lib/route.js`의 `ROUTE_OPTIONS`): 비용 length × (1 + k × risk)로 k = 0, 1, 2, 4, 8 후보를 만들고(같은 경로는 합침), 최단 대비 우회 `maxDetour`(기본 25%) 이내 후보 중 평균 안전점수(길이 가중)가 가장 높은 것. safety 점수식은 그대로
   - 공공데이터 미포함 구간(area_type apartment/campus/school): 경로 고를 때만 safety를 공공데이터 있는 구간의 중앙값(약 0.167)으로 바꿔 씀(`noDataMedian: 'public'`). 전체 중앙값(0.062)은 미포함 구간 원래 점수와 거의 같아 효과가 없어서 안 씀. 비교 카드 평균 점수는 이 구간을 뺀 길이 가중 평균이고, 미포함 구간 길이·비율을 같이 표시. park는 그대로
   - 한계: 보안등 데이터에 큰길 가로등이 없어서, 안심 경로가 큰길 대신 골목으로 빠지는 경우가 있음
3. **실시간 안내**: 안심 경로 선택 후 시작 → `navigator.geolocation.watchPosition`으로 위치 추적, 경로에서 30m 이상 벗어나면 알림 + 재탐색, 도착 20m 안이면 도착 화면. **데모 모드**: 실제 위치 대신 경로를 따라 위치를 일정 속도로 움직임(발표 시연용)
   - 기준값은 `src/lib/nav.js`의 `NAV_OPTIONS` (이탈 30m, 도착 20m, GPS는 연속 2번 벗어나야 이탈·정확도 50m보다 나쁜 값은 판정 제외). 이탈하면 진동 + 알림 + 지금 위치에서 안심 경로 다시 고르기
   - 데모: 도보 속도(67m/분)의 1·5·10배속, 멈추기, "경로 이탈 흉내"(진행 방향 오른쪽으로 45m 옮김 → 재탐색 시연). `?tab=route&from=위도,경도&to=위도,경도&nav=demo`로 바로 시작
   - 안내 화면은 경로 비교 화면의 지도를 같이 쓰고 UI만 겹쳐 띄움(끝내면 비교 화면으로 돌아감). GL 지도를 하나 더 만들면 두 번째 지도에 커스텀 스타일이 안 먹고 밝은 기본 스타일로 뜨는 경우가 있어서(스타일 요청이 한 지도에서만 나감) 지도는 한 화면에 하나만 만든다. GPS 모드는 화면 꺼짐 막기(Wake Lock) 시도
4. **SOS**: 모든 화면에 떠 있는 버튼 → `tel:112` 전화, 보호자에게 현재 위치 링크 `sms:` 문자, 가까운 지구대·비상벨 표시. 자동 신고 아님
   - `src/components/Sos.jsx`: 누르면 한 번 더 확인("SOS 열기") → SOS 화면(112 전화, 보호자 문자, 가까운 지구대·파출소 3곳과 비상벨 3곳 직선거리)
   - 보호자 번호: 앱 처음 열 때 설정(건너뛰기 가능), SOS 화면에서 바꾸기. 이 기기 localStorage에만 저장(`src/lib/guardian.js`), 휴대폰 번호(01x)만 받음
   - 문자 본문: 현재 위치 지도 링크(구글 지도 검색 주소, 받는 폰에 어떤 지도 앱이 있든 열림) + 위치 오차. 위치를 못 받으면 위치 없이 보냄. `sms:번호?&body=` 형식(iOS·Android)
5. (추가) 같이 걷기: 안내 중 마스코트가 함께 걷는 화면 — 마스코트 미정, 자리만
6. (추가) 사각지대·제안: 점수 낮은 구간 목록
   - 사각지대 탭(`src/components/Blindspots.jsx`, `src/lib/blindspot.js`): blindspot_exclude(아파트 단지·캠퍼스·학교) 구간은 빼고, 양방향 구간은 하나로 합쳐 점수 낮은 순(같으면 긴 구간 먼저). 위 지도 + 아래 목록, 항목 누르면 지도에서 강조. "20m 미만 숨기기" 선택
   - 한계: 상위 목록에 산책로(path)가 많음 (상위 30개 중 18개, 황령산 쪽). 결과 파일에 도로 종류가 없어 앱에서는 아직 못 거름

## 디자인
- 와이어프레임 v3 (11화면): https://www.figma.com/design/tNcgMtGYpbOeZW6MnmabvO
- 다크 톤: 배경 #1B2440
- 안전도 그라데이션: 파랑(안전) → 노랑 → 주황(위험). 적록색약 고려해 초록·빨강 쓰지 않음
- 안심 경로 선 #6EC6FF, 최단 경로 선 #9AA0AA
- 폰트: Noto Sans KR
- 모바일 우선 (390px 기준), 하단 탭 3개: 안전도 지도 / 경로 / 사각지대
