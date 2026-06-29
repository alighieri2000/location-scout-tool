import React from 'react'
import { useSceneStore } from './store/useSceneStore'
import { Dropzone } from './components/Dropzone'
import { SceneViewer } from './components/SceneViewer'
import { Toolbar } from './components/Toolbar'
import { ShapePanel } from './components/ShapePanel'
import { StatusBar } from './components/StatusBar'

export default function App() {
  const { mode, mesh, error } = useSceneStore()

  return (
    <div style={s.root}>
      <Toolbar />

      <div style={s.main}>
        {mode === 'import' || !mesh
          ? <Dropzone />
          : <SceneViewer />
        }
        {mesh && <ShapePanel />}
      </div>

      <StatusBar />

      {error && (
        <div style={s.toast} onClick={() => useSceneStore.getState().setError(null)}>
          {error}
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#111' },
  main: { display: 'flex', flex: 1, overflow: 'hidden' },
  toast: {
    position: 'fixed', bottom: 36, left: '50%', transform: 'translateX(-50%)',
    background: '#c0392b', color: '#fff', padding: '9px 18px', borderRadius: 6,
    fontSize: 12, cursor: 'pointer', zIndex: 9999, maxWidth: 500, textAlign: 'center',
  },
}
