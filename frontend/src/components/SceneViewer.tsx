import React, { useRef, useCallback, Suspense, Component, ErrorInfo, useEffect, useState, useMemo } from 'react'
import { Canvas, ThreeEvent, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF, TransformControls, Grid, Line } from '@react-three/drei'
import * as THREE from 'three'
import { v4 as uuid } from 'uuid'
import { useSceneStore, PlacedShape } from '../store/useSceneStore'
import { SampleOverlay } from './SampleOverlay'
import { useSamplePatch } from '../hooks/useSamplePatch'

// ─── Error boundary ───────────────────────────────────────────────────────────

interface EBState { error: Error | null }
class SceneErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  state: EBState = { error: null }
  static getDerivedStateFromError(e: Error) { return { error: e } }
  componentDidCatch(e: Error, i: ErrorInfo) { console.error('[Scene]', e, i) }
  render() {
    if (this.state.error) return (
      <div style={errS.wrap}>
        <p style={errS.title}>3D viewer error</p>
        <pre style={errS.msg}>{this.state.error.message}</pre>
        <button style={errS.btn} onClick={() => this.setState({ error: null })}>Retry</button>
      </div>
    )
    return this.props.children
  }
}

// ─── GL canvas ref ────────────────────────────────────────────────────────────

function GlCapture({ onReady }: { onReady: (c: HTMLCanvasElement) => void }) {
  const { gl } = useThree()
  useEffect(() => { onReady(gl.domElement) }, [gl, onReady])
  return null
}

// ─── Snap face normal to nearest cardinal axis ────────────────────────────────
// Scan meshes have noisy per-face normals. Snap to ±X / ±Y / ±Z so placed
// shapes are always perfectly axis-aligned regardless of scan surface warping.

function snapNormal(n: THREE.Vector3): THREE.Vector3 {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z)
  if (ay >= ax && ay >= az) return new THREE.Vector3(0, Math.sign(n.y), 0)
  if (ax >= az)             return new THREE.Vector3(Math.sign(n.x), 0, 0)
  return                           new THREE.Vector3(0, 0, Math.sign(n.z))
}

// ─── Scan mesh (primitive only — group is owned by SceneViewer for orient TC) ─

interface ScanMeshProps {
  url: string
  dimmed: boolean
  placementActive: boolean
  onPlace: (point: THREE.Vector3, normal: THREE.Vector3) => void
}

function ScanMesh({ url, dimmed, placementActive, onPlace }: ScanMeshProps) {
  const { scene } = useGLTF(url)

  useEffect(() => {
    let tris = 0
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const g = o.geometry as THREE.BufferGeometry
        tris += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach((m: THREE.Material) => { m.side = THREE.FrontSide })
      }
    })
    console.info(`[Scan] loaded, ~${Math.round(tris).toLocaleString()} tris`)
  }, [scene])

  useEffect(() => {
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach((m: THREE.Material) => {
          m.transparent = dimmed
          m.opacity = dimmed ? 0.45 : 1.0
        })
      }
    })
  }, [dimmed, scene])

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (!placementActive) return
    e.stopPropagation()
    const rawNormal = e.face?.normal?.clone() ?? new THREE.Vector3(0, 0, 1)
    const worldNormal = rawNormal
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(e.object.matrixWorld))
      .normalize()
    onPlace(e.point.clone(), snapNormal(worldNormal))
  }, [placementActive, onPlace])

  return <primitive object={scene} onClick={handleClick} />
}

// ─── Floor polygon (triangulated from room tracer outline) ───────────────────

function FloorPolyObject({ shape }: { shape: PlacedShape }) {
  const { selectedShapeId, selectShape, mode, setFloorY, wallHeight } = useSceneStore()
  const isSelected = selectedShapeId === shape.id
  const meshRef = useRef<THREE.Mesh>(null!)

  const geometry = useMemo(() => {
    const pts = shape.polygonPoints ?? []
    if (pts.length < 3) return null
    // Reverse winding so the normal faces up (+Y) after rotateX(+PI/2)
    const reversed = [...pts].reverse()
    const threeShape = new THREE.Shape(reversed.map(([x, z]) => new THREE.Vector2(x, z)))
    const geom = new THREE.ShapeGeometry(threeShape)
    geom.rotateX(Math.PI / 2)
    return geom
  }, [shape.polygonPoints])

  const onTransformChange = useCallback(() => {
    if (!meshRef.current) return
    const newY = meshRef.current.position.y
    // Move all walls and the floor polygon to match the new floor level
    setFloorY(newY)
  }, [setFloorY, wallHeight])

  if (!geometry || !shape.visible || mode === 'sample') return null

  return (
    <>
      <mesh
        ref={meshRef}
        geometry={geometry}
        position={[0, shape.position[1], 0]}
        onClick={(e) => { if (mode === 'transform') { e.stopPropagation(); selectShape(shape.id) } }}
      >
        <meshStandardMaterial
          color={isSelected ? '#5a8aaa' : '#8a9aaa'}
          roughness={0.95}
          side={THREE.FrontSide}
          transparent opacity={0.7}
        />
      </mesh>
      {isSelected && mode === 'transform' && (
        <TransformControls
          object={meshRef}
          mode="translate"
          showX={false}
          showZ={false}
          onObjectChange={onTransformChange}
        />
      )}
    </>
  )
}

// ─── Placed shape (wall plane or box) ────────────────────────────────────────

function PlacedShapeObject({ shape }: { shape: PlacedShape }) {
  if (shape.type === 'floor-poly') return <FloorPolyObject shape={shape} />

  const { selectedShapeId, selectShape, mode, gizmoMode, updateShape, textures } = useSceneStore()
  const meshRef = useRef<THREE.Mesh>(null!)
  const isSelected = selectedShapeId === shape.id
  const hidden = mode === 'sample' || !shape.visible

  const texture = shape.textureId ? textures.find((t) => t.texture_id === shape.textureId) : null

  const mat = React.useMemo(() => {
    if (texture) {
      const loader = new THREE.TextureLoader()
      const tex = loader.load(texture.texture_url)
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(shape.uvRepeat[0], shape.uvRepeat[1])
      return new THREE.MeshStandardMaterial({ map: tex, side: THREE.FrontSide })
    }
    return new THREE.MeshStandardMaterial({
      color: shape.type === 'wall' ? '#c8d8e8' : '#e8d0b0',
      transparent: true, opacity: 0.6,
      side: shape.type === 'wall' ? THREE.FrontSide : THREE.DoubleSide,
    })
  }, [texture, shape.uvRepeat, shape.type])

  const onTransformChange = useCallback(() => {
    if (!meshRef.current) return
    const { position: p, rotation: r, scale: sc } = meshRef.current
    updateShape(shape.id, {
      position: [p.x, p.y, p.z],
      rotation: [r.x, r.y, r.z],
      scale: [sc.x, sc.y, sc.z],
    })
  }, [shape.id, updateShape])

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (mode !== 'transform') return
    e.stopPropagation()
    selectShape(shape.id)
  }, [mode, selectShape, shape.id])

  if (hidden) return null

  return (
    <>
      <mesh
        ref={meshRef}
        position={shape.position}
        rotation={shape.rotation}
        scale={shape.scale}
        material={mat}
        onClick={handleClick}
      >
        {shape.type === 'wall' ? <planeGeometry args={[1, 1]} /> : <boxGeometry args={[1, 1, 1]} />}
      </mesh>

      {isSelected && (
        <mesh position={shape.position} rotation={shape.rotation} scale={shape.scale}>
          {shape.type === 'wall' ? <planeGeometry args={[1, 1]} /> : <boxGeometry args={[1, 1, 1]} />}
          <meshBasicMaterial color="#4a9eff" wireframe />
        </mesh>
      )}

      {isSelected && mode === 'transform' && (
        <TransformControls object={meshRef} mode={gizmoMode} onObjectChange={onTransformChange} />
      )}
    </>
  )
}

// ─── Plan camera — true orthographic, swapped in/out on mode change ───────────

function PlanCamera({ center, bounds }: { center: [number,number,number]; bounds: [[number,number,number],[number,number,number]] | null }) {
  const { set, size, camera } = useThree()

  // Capture the original perspective camera on first render (before any swap)
  const origCameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  if (origCameraRef.current === null) origCameraRef.current = camera as THREE.PerspectiveCamera

  React.useEffect(() => {
    const origCamera = origCameraRef.current!

    const roomW = bounds ? bounds[1][0] - bounds[0][0] : 10
    const roomD = bounds ? bounds[1][2] - bounds[0][2] : 10
    const roomSize = Math.max(roomW, roomD)
    const margin = roomSize * 0.35
    const aspect = size.width / size.height
    const halfH = roomSize / 2 + margin
    const halfW = halfH * aspect

    const floorY = bounds?.[0][1] ?? 0
    const ceilY  = bounds?.[1][1] ?? 5

    const ortho = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, -10000, 10000)
    ortho.position.set(center[0], ceilY + 100, center[2])
    ortho.up.set(0, 0, -1)
    ortho.lookAt(center[0], floorY, center[2])
    ortho.updateProjectionMatrix()

    set({ camera: ortho })

    return () => { set({ camera: origCamera }) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, bounds, set, size.width, size.height])

  return null
}

// ─── Floor click plane for room tracer (inside R3F canvas) ───────────────────

function FloorTracerPlane({ floorY, onAdd, onPreview }: {
  floorY: number
  onAdd: (p: THREE.Vector3) => void
  onPreview: (p: THREE.Vector3 | null) => void
}) {
  return (
    <mesh
      position={[0, floorY, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={(e) => { e.stopPropagation(); onAdd(e.point) }}
      onPointerMove={(e) => { e.stopPropagation(); onPreview(e.point) }}
      onPointerLeave={() => onPreview(null)}
    >
      <planeGeometry args={[2000, 2000]} />
      <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

// ─── Tracer polyline overlay (inside R3F canvas) ──────────────────────────────

function TracerPolyline({ points, preview }: {
  points: [number, number, number][]
  preview: THREE.Vector3 | null
}) {
  if (points.length === 0) return null
  const previewPt: [number, number, number] | null = preview
    ? [preview.x, preview.y, preview.z]
    : null

  return (
    <>
      {points.length >= 2 && (
        <Line points={points} color="#4a9eff" lineWidth={2} />
      )}
      {previewPt && (
        <Line points={[points[points.length - 1], previewPt]} color="#4a9eff" lineWidth={1.5} opacity={0.45} transparent />
      )}
      {previewPt && points.length >= 3 && (
        <Line points={[previewPt, points[0]]} color="#44ff88" lineWidth={1} opacity={0.35} transparent />
      )}
      {points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshBasicMaterial color={i === 0 ? '#44ff88' : '#4a9eff'} />
        </mesh>
      ))}
    </>
  )
}

// ─── Plan mode controls overlay (HTML, outside canvas) ───────────────────────

function PlanControls({ onExport }: { onExport: () => void }) {
  const { tracerPoints, lastTracerPolygon, wallHeight, setWallHeight, floorY, setFloorY, clearTracerPoints, finalizeTracerRoom, scaleAllWalls, shapes } = useSceneStore()
  const hasWalls = shapes.some(s => s.type === 'wall')

  const exportDxf = async () => {
    const pts = tracerPoints.length >= 3 ? tracerPoints : lastTracerPolygon
    if (!pts) return
    try {
      const res = await fetch('/api/mesh/export-room-dxf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: pts, wall_height: wallHeight }),
      })
      if (!res.ok) { console.error('DXF export failed', await res.text()); return }
      const blob = await res.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = 'room-plan.dxf'
      link.click()
    } catch (e) {
      console.error('DXF export error', e)
    }
  }

  const hasDxf = tracerPoints.length >= 3 || !!lastTracerPolygon

  return (
    <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8, alignItems: 'center', zIndex: 10, pointerEvents: 'auto' }}>
      <div style={planS.hint}>📋 Click floor to trace room — click first point to close</div>
      <div style={planS.ctrl}>
        <span style={planS.lbl}>Floor Y</span>
        <button style={planS.nudgeBtn} onClick={() => setFloorY(Math.round((floorY - 0.05) * 100) / 100)} title="Lower floor">▼</button>
        <span style={{ ...planS.lbl, minWidth: 40, textAlign: 'center', color: '#aaa' }}>{floorY.toFixed(2)}</span>
        <button style={planS.nudgeBtn} onClick={() => setFloorY(Math.round((floorY + 0.05) * 100) / 100)} title="Raise floor">▲</button>
      </div>
      <div style={planS.ctrl}>
        <span style={planS.lbl}>Wall H</span>
        <input
          type="number" min={1} max={12} step={0.1}
          value={wallHeight}
          onChange={(e) => setWallHeight(parseFloat(e.target.value) || 2.8)}
          style={planS.numInput}
        />
        <span style={planS.lbl}>m</span>
        {hasWalls && (
          <button style={planS.applyBtn} onClick={() => scaleAllWalls(wallHeight)} title="Apply height to all placed walls">
            Apply all
          </button>
        )}
      </div>
      {tracerPoints.length > 0 && (
        <button style={planS.clearBtn} onClick={clearTracerPoints}>
          Clear ({tracerPoints.length} pts)
        </button>
      )}
      {tracerPoints.length >= 3 && (
        <button style={planS.closeBtn} onClick={finalizeTracerRoom}>
          ✓ Generate {tracerPoints.length} walls
        </button>
      )}
      {hasDxf && (
        <button style={planS.dxfBtn} onClick={exportDxf} title="Export room as DXF for Vectorworks / AutoCAD">
          Export DXF
        </button>
      )}
      <button style={planS.exportBtn} onClick={onExport}>Export PNG</button>
    </div>
  )
}

const planS: Record<string, React.CSSProperties> = {
  hint:     { background: 'rgba(0,0,0,0.85)', color: '#999', fontSize: 12, padding: '7px 14px', borderRadius: 6, border: '1px solid #2a2a2a', whiteSpace: 'nowrap', pointerEvents: 'none' },
  ctrl:     { display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,0.85)', padding: '5px 10px', borderRadius: 6, border: '1px solid #2a2a2a' },
  lbl:      { fontSize: 11, color: '#555' },
  numInput: { width: 42, background: '#111', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 12, padding: '2px 5px', textAlign: 'center' },
  applyBtn: { background: 'transparent', border: '1px solid #3a3a3a', borderRadius: 4, color: '#888', fontSize: 11, padding: '2px 7px', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  nudgeBtn: { background: 'transparent', border: '1px solid #3a3a3a', borderRadius: 3, color: '#777', fontSize: 11, padding: '1px 6px', cursor: 'pointer', lineHeight: 1 },
  clearBtn: { background: 'transparent', border: '1px solid #3a3a3a', borderRadius: 6, color: '#666', fontSize: 12, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' },
  closeBtn: { background: '#0d2d0d', border: '1px solid #1a6a1a', borderRadius: 6, color: '#44ff88', fontSize: 12, padding: '6px 14px', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 700 },
  dxfBtn:   { background: '#2a1a4a', border: '1px solid #5a3a9c', borderRadius: 6, color: '#b088ff', fontSize: 12, padding: '7px 14px', cursor: 'pointer', whiteSpace: 'nowrap' },
  exportBtn:{ background: '#1a3a5c', border: '1px solid #2a5a8c', borderRadius: 6, color: '#7ac0ff', fontSize: 12, padding: '7px 14px', cursor: 'pointer', whiteSpace: 'nowrap' },
}


// ─── Scene interior (has R3F context) ─────────────────────────────────────────

interface SceneInteriorProps {
  meshId: string
  glbUrl: string
  center: [number, number, number]
  bounds: [[number, number, number], [number, number, number]] | null
  mode: string
  gizmoMode: string
  shapes: PlacedShape[]
  isDimmed: boolean
  placementActive: boolean
  orbitEnabled: boolean
  scanVisible: boolean
  onGlReady: (c: HTMLCanvasElement) => void
  onPlace: (point: THREE.Vector3, normal: THREE.Vector3) => void
  scanGroupRef: React.RefObject<THREE.Group>
}

function SceneInterior({
  glbUrl, center, bounds, mode, shapes, isDimmed,
  placementActive, orbitEnabled, scanVisible, onGlReady, onPlace, scanGroupRef,
}: SceneInteriorProps) {
  const { gizmoMode, setScanRotation, setScanPosition, tracerPoints, addTracerPoint, finalizeTracerRoom, floorY } = useSceneStore()
  const [tracerPreview, setTracerPreview] = useState<THREE.Vector3 | null>(null)

  const handleTracerAdd = useCallback((p: THREE.Vector3) => {
    const pts = useSceneStore.getState().tracerPoints
    if (pts.length >= 3) {
      const [fx, , fz] = pts[0]
      if (Math.sqrt((p.x - fx) ** 2 + (p.z - fz) ** 2) < 0.5) {
        finalizeTracerRoom()
        return
      }
    }
    addTracerPoint([p.x, floorY, p.z])
  }, [addTracerPoint, finalizeTracerRoom, floorY])

  // Restore stored scan transform when group mounts
  const onGroupMounted = useCallback((el: THREE.Group | null) => {
    if (!el) return
    ;(scanGroupRef as React.MutableRefObject<THREE.Group | null>).current = el
    const { scanRotation, scanPosition } = useSceneStore.getState()
    el.rotation.set(scanRotation[0], scanRotation[1], scanRotation[2])
    el.position.set(scanPosition[0], scanPosition[1], scanPosition[2])
  }, [scanGroupRef])

  const handleOrientChange = useCallback(() => {
    if (!scanGroupRef.current) return
    const { rotation: r, position: p } = scanGroupRef.current
    setScanRotation([r.x, r.y, r.z])
    setScanPosition([p.x, p.y, p.z])
  }, [scanGroupRef, setScanRotation, setScanPosition])

  return (
    <>
      <GlCapture onReady={onGlReady} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[10, 20, 10]} intensity={1.4} />
      <directionalLight position={[-10, 10, -10]} intensity={0.4} />

      {/* Scan wrapped in a group so orient gizmo can move/rotate the whole scan */}
      <group ref={onGroupMounted} visible={scanVisible}>
        <Suspense fallback={
          <mesh><torusGeometry args={[0.3, 0.05, 8, 24]} /><meshBasicMaterial color="#4a9eff" wireframe /></mesh>
        }>
          <ScanMesh url={glbUrl} dimmed={isDimmed} placementActive={placementActive} onPlace={onPlace} />
        </Suspense>
      </group>

      {/* Orient gizmo — render once group ref is populated */}
      {mode === 'orient' && scanGroupRef.current && (
        <TransformControls
          object={scanGroupRef as unknown as React.MutableRefObject<THREE.Object3D>}
          mode={gizmoMode}
          onObjectChange={handleOrientChange}
        />
      )}

      {shapes.map((shape) => (
        <PlacedShapeObject key={shape.id} shape={shape} />
      ))}

      <Grid
        args={[200, 200]}
        position={[center[0], bounds?.[0][1] ?? 0, center[2]]}
        cellColor="#222" sectionColor="#2d2d2d"
        cellSize={0.5} sectionSize={5}
        fadeDistance={200}
      />

      {mode === 'plan' && <PlanCamera center={center} bounds={bounds} />}
      {mode === 'plan' && (
        <>
          <FloorTracerPlane floorY={floorY} onAdd={handleTracerAdd} onPreview={setTracerPreview} />
          <TracerPolyline points={tracerPoints} preview={tracerPreview} />
        </>
      )}

      <OrbitControls
        target={mode === 'plan' ? [center[0], bounds?.[0][1] ?? 0, center[2]] as [number,number,number] : center}
        makeDefault
        enabled={orbitEnabled}
        enableRotate={mode !== 'plan'}
      />
    </>
  )
}

// ─── Main viewer ──────────────────────────────────────────────────────────────

export function SceneViewer() {
  const { mesh, mode, gizmoMode, shapes, setError, setLoading, setMode, setPatchResult, addShape, scanVisible } = useSceneStore()
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const scanGroupRef = useRef<THREE.Group | null>(null)
  const { capture } = useSamplePatch(glCanvasRef.current)

  const onGlReady = useCallback((c: HTMLCanvasElement) => { glCanvasRef.current = c }, [])

  const handlePlace = useCallback((point: THREE.Vector3, normal: THREE.Vector3) => {
    const { mode: m, mesh: currentMesh, shapes: currentShapes } = useSceneStore.getState()
    const isWall = m === 'place-wall'
    const defaultN = isWall ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
    const q = new THREE.Quaternion().setFromUnitVectors(defaultN, normal)
    const euler = new THREE.Euler().setFromQuaternion(q)

    const b = currentMesh?.bounds
    const span = b ? Math.max(b[1][0] - b[0][0], b[1][2] - b[0][2]) : 4
    const wallW = span * 0.35
    const wallH = span * 0.28
    const idx = currentShapes.length + 1

    addShape({
      id: uuid(),
      type: isWall ? 'wall' : 'box',
      label: isWall ? `Wall ${idx}` : `Blocker ${idx}`,
      position: [point.x, point.y, point.z],
      rotation: [euler.x, euler.y, euler.z],
      scale: isWall ? [wallW, wallH, 1] : [wallW * 0.4, wallH * 0.5, wallW * 0.4],
      textureId: null,
      uvRepeat: [1, 1],
      visible: true,
    })
  }, [addShape])

  const onSampleCapture = useCallback(async (rect: { x: number; y: number; w: number; h: number }) => {
    setLoading(true)
    setError(null)
    try {
      const result = await capture(rect)
      if (!result) throw new Error('Canvas not ready — try again')
      setPatchResult(result)
      setMode('generate')
    } catch (e) {
      setError(`Patch capture failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [capture, setLoading, setError, setMode, setPatchResult])

  if (!mesh) return null

  const center = mesh.center as [number, number, number]
  const bounds = mesh.bounds
  const camDistance = bounds
    ? Math.max(...(bounds[1] as number[]).map((v, i) => v - (bounds[0] as number[])[i])) * 1.8
    : 5

  const placementActive = mode === 'place-wall' || mode === 'place-box'
  const isDimmed = mode !== 'view'
  const orbitEnabled = mode !== 'sample' && !placementActive

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <SceneErrorBoundary>
        <Canvas
          camera={{
            position: [center[0], center[1] + camDistance * 0.4, center[2] + camDistance],
            fov: 50, near: 0.001, far: 10000,
          }}
          gl={{ preserveDrawingBuffer: true }}
          style={{ background: '#181818', display: 'block', width: '100%', height: '100%' }}
        >
          <SceneInterior
            meshId={mesh.mesh_id}
            glbUrl={mesh.glb_url}
            center={center}
            bounds={bounds}
            mode={mode}
            gizmoMode={gizmoMode}
            shapes={shapes}
            isDimmed={isDimmed}
            placementActive={placementActive}
            orbitEnabled={orbitEnabled}
            scanVisible={scanVisible}
            onGlReady={onGlReady}
            onPlace={handlePlace}
            scanGroupRef={scanGroupRef as React.RefObject<THREE.Group>}
          />
        </Canvas>
      </SceneErrorBoundary>

      {mode === 'sample' && <SampleOverlay onCapture={onSampleCapture} />}
      <DebugBar />
      {placementActive && <PlacementHint mode={mode} />}
      {mode === 'orient' && <OrientHint />}
      {mode === 'plan' && <PlanControls onExport={() => {
        if (glCanvasRef.current) {
          const link = document.createElement('a')
          link.download = 'floor-plan.png'
          link.href = glCanvasRef.current.toDataURL('image/png')
          link.click()
        }
      }} />}
    </div>
  )
}

// ─── UI overlays ──────────────────────────────────────────────────────────────

function PlacementHint({ mode }: { mode: string }) {
  return (
    <div style={hintS.banner}>
      {mode === 'place-wall'
        ? '🪟  Click the scan — wall snaps to nearest vertical/horizontal plane'
        : '📦  Click the scan surface to drop a furniture blocker'}
    </div>
  )
}

function OrientHint() {
  return (
    <div style={hintS.banner}>
      🧭 Drag gizmo handles to align the scan · switch T / R / S in the toolbar · Reset to undo
    </div>
  )
}

function DebugBar() {
  const { mesh, shapes } = useSceneStore()
  if (!mesh) return null
  const b = mesh.bounds
  const size = b ? (b[1] as number[]).map((v, i) => (v - (b[0] as number[])[i]).toFixed(1)) : null
  return (
    <div style={debugS.bar}>
      {mesh.vertex_count.toLocaleString()} verts · {mesh.face_count.toLocaleString()} faces
      {size && ` · ${size[0]} × ${size[1]} × ${size[2]} m`}
      {shapes.length > 0 && ` · ${shapes.length} shape${shapes.length !== 1 ? 's' : ''} placed`}
      {!mesh.has_uv && <span style={{ color: '#f39c12', marginLeft: 6 }}>no UVs (auto-unwrap on export)</span>}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const errS: Record<string, React.CSSProperties> = {
  wrap: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#181818', gap: 14, padding: 32 },
  title: { fontSize: 15, fontWeight: 700, color: '#e74c3c' },
  msg: { fontSize: 12, color: '#999', background: '#1e1e1e', border: '1px solid #252525', borderRadius: 6, padding: '10px 14px', maxWidth: 480, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  btn: { padding: '7px 22px', background: '#1a3a5c', border: '1px solid #2a5a8c', borderRadius: 6, color: '#7ac0ff', fontSize: 13, cursor: 'pointer' },
}

const debugS: Record<string, React.CSSProperties> = {
  bar: { position: 'absolute', bottom: 10, left: 10, fontSize: 11, color: '#555', background: 'rgba(0,0,0,0.65)', padding: '4px 10px', borderRadius: 4, pointerEvents: 'none' },
}

const hintS: Record<string, React.CSSProperties> = {
  banner: { position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.8)', color: '#ccc', fontSize: 12, padding: '7px 16px', borderRadius: 6, border: '1px solid #333', pointerEvents: 'none', whiteSpace: 'nowrap' },
}
