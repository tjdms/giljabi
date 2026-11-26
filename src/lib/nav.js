// 실시간 안내 계산 (경로 위 진행 거리, 이탈 거리, 도착 판정, 데모 이동)
// 브라우저·Node 둘 다에서 돌도록 DOM 없이 작성. 좌표는 [위도, 경도]
import { along, distance, length as lineLength, lineString, nearestPointOnLine, point } from '@turf/turf'

export const NAV_OPTIONS = {
  offRouteM: 30,          // 경로에서 이만큼 벗어나면 이탈
  offRouteFixes: 2,       // GPS는 연속 이만큼 벗어나야 이탈로 봄 (튀는 값 걸러내기). 데모는 1
  maxAccuracyM: 50,       // GPS 정확도가 이보다 나쁘면 이탈 판정에 안 씀
  arriveM: 20,            // 도착 지점 이만큼 안이면 도착
  walkMps: 67 / 60,       // 도보 속도 (경로 비교와 같은 67m/분)
  demoSpeeds: [1, 5, 10], // 데모 배속
}

const toXY = ([lat, lng]) => [lng, lat]
const toLatLng = ([x, y]) => [y, x]

export function routeLine(coords) {
  return lineString(coords.map(toXY))
}

export const distanceM = (a, b) => distance(point(toXY(a)), point(toXY(b)), { units: 'meters' })

export function lineLengthM(line) {
  return lineLength(line, { units: 'meters' })
}

// 위치를 경로에 투영: 벗어난 거리, 지나온 거리, 남은 거리
export function progressOn(line, latlng, totalM = lineLengthM(line)) {
  const p = nearestPointOnLine(line, point(toXY(latlng)), { units: 'meters' })
  const alongM = p.properties.location
  return {
    offM: p.properties.dist,
    alongM,
    remainingM: Math.max(0, totalM - alongM),
    snapped: toLatLng(p.geometry.coordinates),
  }
}

// 경로 시작점에서 m만큼 간 위치
export function pointAlongM(line, m) {
  return toLatLng(along(line, Math.max(0, m), { units: 'meters' }).geometry.coordinates)
}

// 경로 위 alongM 지점에서 진행 방향의 오른쪽으로 sideM만큼 옮긴 점 (데모에서 경로 이탈 흉내용)
export function offsetFromRoute(line, alongM, sideM) {
  const totalM = lineLengthM(line)
  const a = pointAlongM(line, Math.min(alongM, totalM - 1))
  const b = pointAlongM(line, Math.min(alongM + 1, totalM))
  const mPerLat = 111320
  const mPerLng = 111320 * Math.cos((a[0] * Math.PI) / 180)
  const dx = (b[1] - a[1]) * mPerLng
  const dy = (b[0] - a[0]) * mPerLat
  const n = Math.hypot(dx, dy) || 1
  // 진행 방향 (dx, dy)의 오른쪽 수직 = (dy, -dx)
  return [a[0] + (-dx / n) * sideM / mPerLat, a[1] + (dy / n) * sideM / mPerLng]
}
