import { useEffect, useMemo, useState } from 'react'
import { loadFacilities } from '../data.js'
import { distanceM } from '../lib/nav.js'
import { formatPhone, isSetupDone, loadGuardianPhone, markSetupDone, normalizePhone, saveGuardianPhone } from '../lib/guardian.js'

const NEAREST_N = 3
const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`)

// 지도 링크: 받는 쪽 폰에 어떤 지도 앱이 있든 열리도록 구글 지도 검색 주소 사용
const mapLink = ([lat, lng]) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`

// sms: 본문 붙이기 — "?&body=" 형식이 iOS·Android 둘 다 열림
const smsHref = (phone, body) => `sms:${phone}?&body=${encodeURIComponent(body)}`

function GuardianForm({ initial, onSaved, onLater, laterLabel = '나중에' }) {
  const [value, setValue] = useState(initial ? formatPhone(initial) : '')
  const [error, setError] = useState(null)
  const save = (e) => {
    e.preventDefault()
    if (!normalizePhone(value)) { setError('휴대폰 번호(010으로 시작)를 넣어 주세요'); return }
    if (!saveGuardianPhone(value)) { setError('이 브라우저에서는 저장할 수 없어요 (사생활 보호 모드인지 확인해 주세요)'); return }
    onSaved(loadGuardianPhone())
  }
  return (
    <form className="guardian-form" onSubmit={save}>
      <label className="muted" htmlFor="guardian-phone">보호자 휴대폰 번호</label>
      <input
        id="guardian-phone"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        placeholder="010-1234-5678"
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(null) }}
      />
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="muted">이 기기에만 저장돼요. 서버로 보내지 않아요.</p>
      <div className="dialog-actions">
        {onLater && <button type="button" className="chip" onClick={onLater}>{laterLabel}</button>}
        <button type="submit" className="nav-start-main">저장</button>
      </div>
    </form>
  )
}

// 앱을 처음 열 때 보호자 번호 받기 (건너뛰기 가능)
export function FirstSetup() {
  const [open, setOpen] = useState(() => !isSetupDone())
  if (!open) return null
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <div className="dialog">
        <p id="setup-title" className="dialog-title">보호자 번호 설정</p>
        <p className="muted">SOS를 누르면 이 번호로 지금 위치 지도 링크를 문자로 보낼 수 있어요. 문자는 직접 보내기 버튼을 눌러야 가요.</p>
        <GuardianForm onSaved={() => setOpen(false)} onLater={() => { markSetupDone(); setOpen(false) }} />
      </div>
    </div>
  )
}

// 모든 화면에 떠 있는 SOS 버튼 + 확인 단계 + SOS 화면
export default function Sos() {
  const [stage, setStage] = useState('closed')   // 'closed' | 'confirm' | 'open' | 'phone'
  const [phone, setPhone] = useState(() => loadGuardianPhone())
  const [loc, setLoc] = useState(null)           // { latlng, accuracy }
  const [locError, setLocError] = useState(null)
  const [facilities, setFacilities] = useState(null)

  // SOS 화면을 열면 현재 위치를 한 번 받음
  useEffect(() => {
    if (stage !== 'open') return
    setLoc(null)
    setLocError(null)
    if (!navigator.geolocation) { setLocError('이 브라우저는 위치를 지원하지 않아요'); return }
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc({ latlng: [p.coords.latitude, p.coords.longitude], accuracy: p.coords.accuracy }),
      (err) => setLocError(err.code === 1 ? '위치 권한이 꺼져 있어요' : '위치를 받지 못했어요'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    )
    loadFacilities().then(setFacilities).catch(() => setFacilities(null))
  }, [stage])

  const nearest = useMemo(() => {
    if (!loc || !facilities) return null
    const pick = (type) => facilities.features
      .filter((f) => f.properties.type === type)
      .map((f) => ({ f, d: distanceM(loc.latlng, [f.geometry.coordinates[1], f.geometry.coordinates[0]]) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, NEAREST_N)
    return { police: pick('police'), bell: pick('bell') }
  }, [loc, facilities])

  const message = loc
    ? `[길잡이들] 도움이 필요해요. 지금 위치: ${mapLink(loc.latlng)} (오차 약 ${Math.round(loc.accuracy)}m)`
    : '[길잡이들] 도움이 필요해요. 위치를 확인하지 못했어요. 전화 주세요.'

  return (
    <>
      <button className="sos-fab" onClick={() => setStage('confirm')} aria-label="SOS 긴급 도움">SOS</button>

      {stage === 'confirm' && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="sos-confirm-title">
          <div className="dialog">
            <p id="sos-confirm-title" className="dialog-title">SOS를 열까요?</p>
            <p className="muted">112 전화, 보호자 문자, 가까운 지구대·비상벨을 볼 수 있어요. 자동으로 신고되지는 않아요.</p>
            <div className="dialog-actions">
              <button className="chip" onClick={() => setStage('closed')}>취소</button>
              <button
                className="sos-confirm"
                onClick={() => {
                  // 처음 설정 화면에서 저장했을 수 있으니 열 때 다시 읽음
                  const saved = loadGuardianPhone()
                  setPhone(saved)
                  setStage(saved ? 'open' : 'phone')
                }}
              >
                SOS 열기
              </button>
            </div>
          </div>
        </div>
      )}

      {stage === 'phone' && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="sos-phone-title">
          <div className="dialog">
            <p id="sos-phone-title" className="dialog-title">보호자 번호</p>
            <GuardianForm
              initial={phone}
              onSaved={(p) => { setPhone(p); setStage('open') }}
              onLater={() => setStage('open')}
              laterLabel={phone ? '취소' : '번호 없이 계속'}
            />
          </div>
        </div>
      )}

      {stage === 'open' && (
        <div className="sos-screen" role="dialog" aria-modal="true" aria-labelledby="sos-title">
          <header className="sos-head">
            <p id="sos-title" className="dialog-title">SOS</p>
            <button className="chip" onClick={() => setStage('closed')}>닫기</button>
          </header>

          <a className="sos-action sos-call" href="tel:112">112 전화하기</a>
          {phone ? (
            <a className="sos-action" href={smsHref(phone, message)}>
              보호자에게 위치 문자 보내기
              <span className="sos-sub">{formatPhone(phone)}{loc ? '' : ' · 위치 없이'}</span>
            </a>
          ) : (
            <button className="sos-action" onClick={() => setStage('phone')}>보호자 번호 넣기</button>
          )}
          {phone && <button className="sos-link" onClick={() => setStage('phone')}>보호자 번호 바꾸기</button>}

          <p className="sos-loc muted">
            {loc ? `지금 위치 확인됨 (오차 약 ${Math.round(loc.accuracy)}m)` : locError ?? '지금 위치를 찾는 중이에요…'}
          </p>

          {nearest && (
            <div className="sos-near">
              {[['police', '가까운 지구대·파출소'], ['bell', '가까운 비상벨']].map(([type, title]) => (
                <section key={type}>
                  <p className="sheet-sub">{title}</p>
                  <ul>
                    {nearest[type].map(({ f, d }) => (
                      <li key={f.properties.id}>
                        <span>{f.properties.name || (type === 'bell' ? '비상벨' : '지구대')}</span>
                        <span className="muted">직선 {fmtM(d)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <p className="muted sos-note">버튼을 눌러야 전화·문자 앱이 열려요. 자동으로 신고되지 않아요.</p>
        </div>
      )}
    </>
  )
}
