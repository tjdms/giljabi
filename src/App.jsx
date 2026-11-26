import { useState } from 'react'
import SafetyMap from './components/SafetyMap.jsx'
import RouteCompare from './components/RouteCompare.jsx'
import Sos, { FirstSetup } from './components/Sos.jsx'

const TABS = [
  { id: 'map', label: '안전도 지도', icon: '◎' },
  { id: 'route', label: '경로', icon: '↗' },
  { id: 'blind', label: '사각지대', icon: '◐' },
]

export default function App() {
  // ?tab=route 로 바로 열기 (시연·공유용)
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    return TABS.some((x) => x.id === t) ? t : 'map'
  })

  return (
    <div className="app">
      <main className="screen">
        {tab === 'map' && <SafetyMap />}
        {tab === 'route' && <RouteCompare />}
        {tab === 'blind' && (
          <div className="placeholder">
            <p className="placeholder-title">{TABS.find((t) => t.id === tab).label}</p>
            <p>준비 중이에요</p>
          </div>
        )}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <span className="tab-icon" aria-hidden>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
      <Sos />
      <FirstSetup />
    </div>
  )
}
