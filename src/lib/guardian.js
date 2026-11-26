// 보호자 번호: 이 기기의 localStorage에만 저장 (서버로 보내지 않음)
// 사생활 보호 모드 등에서 저장소를 못 쓰면 저장 안 된 것으로 처리

const KEY = 'giljabi.guardianPhone'
const SETUP_KEY = 'giljabi.setupDone'

const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => {
  try {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
    return true
  } catch { return false }
}

export const loadGuardianPhone = () => read(KEY)

// 숫자만 남김. 휴대폰(01x) 10~11자리만 받음. 저장 실패하면 false
export function saveGuardianPhone(input) {
  const digits = normalizePhone(input)
  if (!digits) return false
  write(SETUP_KEY, '1')
  return write(KEY, digits)
}

export const clearGuardianPhone = () => write(KEY, null)

export const normalizePhone = (input) => {
  const d = String(input ?? '').replace(/\D/g, '')
  return /^01[016789]\d{7,8}$/.test(d) ? d : null
}

export const formatPhone = (d) => (d?.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d?.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d)

// 처음 설정 화면을 이미 봤는지 (번호 저장 또는 "나중에")
export const isSetupDone = () => read(SETUP_KEY) === '1'
export const markSetupDone = () => write(SETUP_KEY, '1')
