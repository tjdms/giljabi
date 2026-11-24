// 7,710개 구간을 캔버스 한 장에 그리는 네이버 지도 사용자 정의 오버레이
// 구간마다 Polyline이나 Data 레이어를 쓰면 페이지가 멈춰서 직접 그림
// 문서: https://navermaps.github.io/maps.js.ncp/docs/naver.maps.OverlayView.html

export function createSegmentLayer(maps, { features, color, weight = 3, opacity = 0.9 }) {
  // 구간별 경계 상자 (화면 밖 구간 건너뛰기용)
  const boxes = features.map((f) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const [x, y] of f.geometry.coordinates) {
      if (x < x0) x0 = x; if (y < y0) y0 = y
      if (x > x1) x1 = x; if (y > y1) y1 = y
    }
    return [x0, y0, x1, y1]
  })

  const colors = features.map(color)

  function SegmentLayer() {
    this.canvas = document.createElement('canvas')
    this.canvas.style.position = 'absolute'
    this.canvas.style.pointerEvents = 'none'
    this.selected = null
  }
  SegmentLayer.prototype = new maps.OverlayView()

  SegmentLayer.prototype.onAdd = function () {
    this.getPanes().overlayLayer.appendChild(this.canvas)
    // 좌표 → 세계 좌표 변환은 한 번만 (그릴 때마다 하면 느림)
    const proj = this.getProjection()
    this.world = features.map((f) => f.geometry.coordinates.map(([x, y]) => proj.fromCoordToPoint(new maps.LatLng(y, x))))
    const map = this.getMap()
    // 확대·이동 중에도 다시 그림. idle은 처음 자리 잡은 뒤 한 번 더 맞추기용
    this.listeners = ['bounds_changed', 'zoom_changed', 'size_changed', 'idle']
      .map((ev) => maps.Event.addListener(map, ev, () => this.draw()))
  }

  SegmentLayer.prototype.onRemove = function () {
    maps.Event.removeListener(this.listeners)
    this.canvas.remove()
  }

  SegmentLayer.prototype.setSelected = function (f) {
    this.selected = f
    this.draw()
  }

  SegmentLayer.prototype.draw = function () {
    const map = this.getMap()
    const proj = this.getProjection()
    if (!map || !proj) return
    const t0 = performance.now()
    const size = map.getSize()
    const b = map.getBounds()
    const [minX, minY, maxX, maxY] = [b.getMin().x, b.getMin().y, b.getMax().x, b.getMax().y]
    const nw = new maps.LatLng(maxY, minX)
    const se = new maps.LatLng(minY, maxX)
    const origin = proj.fromCoordToOffset(nw)   // 화면 왼쪽 위
    // 세계 좌표 → 화면 픽셀 배율 (GL은 줌이 실수라 두 점으로 직접 구함)
    const wNw = proj.fromCoordToPoint(nw)
    const wSe = proj.fromCoordToPoint(se)
    const scale = (proj.fromCoordToOffset(se).x - origin.x) / (wSe.x - wNw.x)
    const dpr = window.devicePixelRatio || 1
    const c = this.canvas
    c.style.left = `${origin.x}px`
    c.style.top = `${origin.y}px`
    c.style.width = `${size.width}px`
    c.style.height = `${size.height}px`
    c.width = Math.round(size.width * dpr)
    c.height = Math.round(size.height * dpr)
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const line = (pts) => {
      ctx.beginPath()
      pts.forEach((p, i) => {
        const x = (p.x - wNw.x) * scale
        const y = (p.y - wNw.y) * scale
        if (i) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      })
      ctx.stroke()
    }

    ctx.globalAlpha = opacity
    ctx.lineWidth = weight
    let drawn = 0
    features.forEach((f, i) => {
      const [x0, y0, x1, y1] = boxes[i]
      if (x1 < minX || x0 > maxX || y1 < minY || y0 > maxY) return
      ctx.strokeStyle = colors[i]
      line(this.world[i])
      drawn++
    })
    if (this.selected) {
      ctx.globalAlpha = 0.95
      ctx.lineWidth = weight + 4
      ctx.strokeStyle = '#FFFFFF'
      const i = features.indexOf(this.selected)
      if (i >= 0) line(this.world[i])
    }
    this.lastDraw = { drawn, ms: Math.round(performance.now() - t0) }
  }

  return new SegmentLayer()
}
