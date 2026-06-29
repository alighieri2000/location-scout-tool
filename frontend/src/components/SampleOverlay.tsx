import React, { useRef, useState, useCallback } from 'react'

interface Rect { x: number; y: number; w: number; h: number }

interface Props {
  onCapture: (normalizedRect: Rect) => void
}

export function SampleOverlay({ onCapture }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const [dragRect, setDragRect] = useState<Rect | null>(null)
  const [confirmed, setConfirmed] = useState<Rect | null>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const bounds = containerRef.current!.getBoundingClientRect()
    startRef.current = { x: e.clientX - bounds.left, y: e.clientY - bounds.top }
    setDragRect(null)
    setConfirmed(null)
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!startRef.current) return
    const bounds = containerRef.current!.getBoundingClientRect()
    const cx = e.clientX - bounds.left
    const cy = e.clientY - bounds.top
    const { x, y } = startRef.current
    setDragRect({
      x: Math.min(x, cx),
      y: Math.min(y, cy),
      w: Math.abs(cx - x),
      h: Math.abs(cy - y),
    })
  }, [])

  const onMouseUp = useCallback(() => {
    if (!startRef.current || !dragRect || dragRect.w < 20 || dragRect.h < 20) {
      startRef.current = null
      return
    }
    startRef.current = null
    setConfirmed(dragRect)
    setDragRect(null)

    const bounds = containerRef.current!.getBoundingClientRect()
    onCapture({
      x: dragRect.x / bounds.width,
      y: dragRect.y / bounds.height,
      w: dragRect.w / bounds.width,
      h: dragRect.h / bounds.height,
    })
  }, [dragRect, onCapture])

  const activeRect = dragRect ?? confirmed

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', userSelect: 'none' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {/* instruction banner */}
      <div style={styles.banner}>
        Drag a rectangle over a <strong>clean section</strong> of the wall to sample its texture
      </div>

      {activeRect && (
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          {/* dark scrim outside the selection */}
          <defs>
            <mask id="selection-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={activeRect.x} y={activeRect.y}
                width={activeRect.w} height={activeRect.h}
                fill="black"
              />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.45)" mask="url(#selection-mask)" />

          {/* selection border */}
          <rect
            x={activeRect.x} y={activeRect.y}
            width={activeRect.w} height={activeRect.h}
            fill="rgba(74,158,255,0.08)"
            stroke="#4a9eff"
            strokeWidth={1.5}
            strokeDasharray="6 3"
          />

          {/* corner handles */}
          {[
            [activeRect.x, activeRect.y],
            [activeRect.x + activeRect.w, activeRect.y],
            [activeRect.x, activeRect.y + activeRect.h],
            [activeRect.x + activeRect.w, activeRect.y + activeRect.h],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={4} fill="#4a9eff" />
          ))}

          {/* size label */}
          {confirmed && (
            <text
              x={activeRect.x + activeRect.w / 2}
              y={activeRect.y - 8}
              textAnchor="middle"
              fill="#4a9eff"
              fontSize={11}
              fontFamily="sans-serif"
            >
              {Math.round(activeRect.w)} × {Math.round(activeRect.h)} px — patch ready
            </text>
          )}
        </svg>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    position: 'absolute',
    top: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.75)',
    color: '#aaa',
    fontSize: 12,
    padding: '7px 16px',
    borderRadius: 6,
    border: '1px solid #333',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  },
}
