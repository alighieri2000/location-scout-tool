import React from 'react'
import { useSceneStore } from '../store/useSceneStore'

const HELP: Record<string, string> = {
  import:      'Drop a scan file to get started — OBJ, GLB, USDZ, PLY, PTS',
  view:        'Orbit: left drag · Zoom: scroll · Pan: right drag',
  'place-wall': 'Click the scan — wall plane snaps to the nearest cardinal axis (vertical/horizontal)',
  'place-box':  'Click the scan surface to place a furniture blocker box',
  transform:   'Click a shape to select · drag the gizmo · switch T/R/S in the toolbar',
  orient:      'Drag the scan gizmo to rotate/translate the whole scan into alignment · T = translate · R = rotate',
  sample:      'Drag a rectangle over a clean section of the scan wall to sample its texture',
  generate:    'Describe the surface, then Generate — AI creates a seamless tileable texture',
  plan:        'Top-down floor plan view · shapes visible from above · Export PNG to save',
}

export function StatusBar() {
  const { mode, isLoading } = useSceneStore()
  return (
    <div style={s.bar}>
      {isLoading && <span>⏳</span>}
      <span style={s.help}>{HELP[mode] ?? ''}</span>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  bar: { height: 26, background: '#141414', borderTop: '1px solid #1e1e1e', display: 'flex', alignItems: 'center', padding: '0 14px', gap: 8, flexShrink: 0 },
  help: { fontSize: 11, color: '#4a4a4a' },
}
