import React from 'react'
import { useSceneStore, AppMode, GizmoMode } from '../store/useSceneStore'

interface Tool { mode: AppMode; label: string; icon: string; tip: string }

const TOOLS: Tool[] = [
  { mode: 'view',       label: 'View',    icon: '🔭', tip: 'Orbit and inspect the scan' },
  { mode: 'place-wall', label: 'Wall',    icon: '🪟', tip: 'Click the scan to place a wall plane' },
  { mode: 'place-box',  label: 'Blocker', icon: '📦', tip: 'Click the scan to place a furniture blocker' },
  { mode: 'transform',  label: 'Move',    icon: '✥',  tip: 'Select and transform placed shapes' },
  { mode: 'orient',     label: 'Orient',  icon: '🧭', tip: 'Rotate / translate the whole scan into alignment' },
  { mode: 'plan',       label: 'Plan',    icon: '📋', tip: 'Top-down floor plan view — see the room layout with measurements' },
  { mode: 'sample',     label: 'Sample',  icon: '🎨', tip: 'Drag a rect on the scan to sample wall texture' },
  { mode: 'generate',   label: 'Generate',icon: '✨', tip: 'Generate a clean AI texture' },
]

const GIZMO_MODES: { m: GizmoMode; label: string; tip: string }[] = [
  { m: 'translate', label: 'T', tip: 'Translate (move)' },
  { m: 'rotate',    label: 'R', tip: 'Rotate' },
  { m: 'scale',     label: 'S', tip: 'Scale' },
]

export function Toolbar() {
  const { mode, setMode, gizmoMode, setGizmoMode, shapes, mesh } = useSceneStore()
  const showGizmoBar = mode === 'transform' || mode === 'orient'

  return (
    <div style={styles.wrap}>
      <div style={styles.bar}>
        <span style={styles.brand}>📍 Location Scout</span>

        <div style={styles.tools}>
          {TOOLS.map((t) => (
            <button
              key={t.mode}
              title={t.tip}
              disabled={!mesh && t.mode !== 'view'}
              style={{
                ...styles.btn,
                ...(mode === t.mode ? styles.active : {}),
                opacity: !mesh && t.mode !== 'view' ? 0.3 : 1,
              }}
              onClick={() => setMode(t.mode)}
            >
              <span style={{ fontSize: 15 }}>{t.icon}</span>
              <span style={{ fontSize: 10 }}>{t.label}</span>
            </button>
          ))}
        </div>

        <div style={styles.right}>
          {shapes.length > 0 && (
            <span style={styles.shapeCount}>{shapes.length} shape{shapes.length !== 1 ? 's' : ''}</span>
          )}
          {mesh && (
            <button
              style={styles.newBtn}
              title="Load a different scan"
              onClick={() => useSceneStore.setState({
                mode: 'import', mesh: null, shapes: [], selectedShapeId: null,
                patchResult: null, textures: [],
                scanRotation: [0, 0, 0], scanPosition: [0, 0, 0],
              })}
            >
              New Scan
            </button>
          )}
        </div>
      </div>

      {/* T / R / S gizmo mode strip — visible in transform and orient modes */}
      {showGizmoBar && (
        <div style={styles.gizmoBar}>
          <span style={styles.gizmoLabel}>
            {mode === 'orient' ? 'Scan:' : 'Shape:'}
          </span>
          {GIZMO_MODES.map(({ m, label, tip }) => (
            <button
              key={m}
              title={tip}
              style={{
                ...styles.gizmoBtn,
                ...(gizmoMode === m ? styles.gizmoActive : {}),
              }}
              onClick={() => setGizmoMode(m)}
            >
              {label}
            </button>
          ))}
          {mode === 'orient' && (
            <button
              style={styles.resetBtn}
              title="Reset scan rotation and position to zero"
              onClick={() => useSceneStore.getState().setScanRotation([0, 0, 0])}
            >
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex', flexDirection: 'column',
    background: '#1c1c1c', borderBottom: '1px solid #2a2a2a',
    flexShrink: 0,
  },
  bar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '0 14px', height: 46,
  },
  brand: { fontSize: 12, fontWeight: 700, color: '#777', marginRight: 6, whiteSpace: 'nowrap' },
  tools: { display: 'flex', gap: 2, flex: 1 },
  btn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    padding: '4px 12px', background: 'transparent',
    border: '1px solid transparent', borderRadius: 6,
    color: '#777', cursor: 'pointer', lineHeight: 1,
    transition: 'all 0.1s',
  },
  active: { background: '#222', border: '1px solid #333', color: '#4a9eff' },
  right: { display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' },
  shapeCount: { fontSize: 11, color: '#555' },
  newBtn: {
    padding: '4px 12px', background: '#1e1e1e', border: '1px solid #2a2a2a',
    borderRadius: 6, color: '#666', fontSize: 11, cursor: 'pointer',
  },
  gizmoBar: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 14px', borderTop: '1px solid #222',
    background: '#181818',
  },
  gizmoLabel: { fontSize: 10, color: '#555', marginRight: 4, letterSpacing: '0.05em' },
  gizmoBtn: {
    padding: '3px 14px', fontSize: 11, fontWeight: 700,
    background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 4,
    color: '#666', cursor: 'pointer', letterSpacing: '0.04em',
  },
  gizmoActive: {
    background: '#1a2a3a', border: '1px solid #2a5a8c', color: '#7ac0ff',
  },
  resetBtn: {
    marginLeft: 10, padding: '3px 10px', fontSize: 10,
    background: 'transparent', border: '1px solid #2a2a2a',
    borderRadius: 4, color: '#666', cursor: 'pointer',
  },
}
