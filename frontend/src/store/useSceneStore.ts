import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { PatchResult } from '../hooks/useSamplePatch'

export type AppMode = 'import' | 'view' | 'place-wall' | 'place-box' | 'transform' | 'orient' | 'sample' | 'generate' | 'plan'
export type GizmoMode = 'translate' | 'rotate' | 'scale'

export interface MeshInfo {
  mesh_id: string
  glb_url: string
  vertex_count: number
  face_count: number
  bounds: [[number, number, number], [number, number, number]] | null
  center: [number, number, number]
  has_uv: boolean
  floor_y: number | null
}

export interface PlacedShape {
  id: string
  type: 'wall' | 'box' | 'floor-poly'
  label: string
  position: [number, number, number]
  rotation: [number, number, number]   // euler XYZ radians
  scale: [number, number, number]
  textureId: string | null
  uvRepeat: [number, number]
  visible: boolean
  polygonPoints?: [number, number][]   // XZ pairs for floor-poly type
}

export interface TextureEntry {
  texture_id: string
  texture_url: string
  source: string
  prompt: string
}

interface SceneState {
  mode: AppMode
  gizmoMode: GizmoMode
  scanRotation: [number, number, number]
  scanPosition: [number, number, number]
  scanVisible: boolean
  mesh: MeshInfo | null
  shapes: PlacedShape[]
  selectedShapeId: string | null
  patchResult: PatchResult | null
  textures: TextureEntry[]
  prompt: string
  isLoading: boolean
  error: string | null

  // Room tracer
  tracerPoints: [number, number, number][]
  lastTracerPolygon: [number, number, number][] | null
  wallHeight: number
  floorY: number

  setMode: (mode: AppMode) => void
  setGizmoMode: (m: GizmoMode) => void
  setScanRotation: (r: [number, number, number]) => void
  setScanPosition: (p: [number, number, number]) => void
  setScanVisible: (v: boolean) => void
  setMesh: (mesh: MeshInfo) => void
  addShape: (shape: PlacedShape) => void
  updateShape: (id: string, patch: Partial<PlacedShape>) => void
  removeShape: (id: string) => void
  selectShape: (id: string | null) => void
  toggleShapeVisibility: (id: string) => void
  setPatchResult: (result: PatchResult | null) => void
  clearPatchResult: () => void
  addTexture: (tex: TextureEntry) => void
  applyTextureToShape: (shapeId: string, textureId: string) => void
  setPrompt: (prompt: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void

  // Room tracer actions
  addTracerPoint: (p: [number, number, number]) => void
  clearTracerPoints: () => void
  setWallHeight: (h: number) => void
  setFloorY: (y: number) => void
  finalizeTracerRoom: () => void
  scaleAllWalls: (h: number) => void
}

export const useSceneStore = create<SceneState>((set) => ({
  mode: 'import',
  gizmoMode: 'translate',
  scanRotation: [0, 0, 0],
  scanPosition: [0, 0, 0],
  scanVisible: true,
  mesh: null,
  shapes: [],
  selectedShapeId: null,
  patchResult: null,
  textures: [],
  prompt: 'smooth white plaster wall, seamless',
  isLoading: false,
  error: null,
  tracerPoints: [],
  lastTracerPolygon: null,
  wallHeight: 2.8,
  floorY: 0,

  setMode: (mode) => set({ mode }),
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
  setScanRotation: (scanRotation) => set({ scanRotation }),
  setScanPosition: (scanPosition) => set({ scanPosition }),
  setScanVisible: (scanVisible) => set({ scanVisible }),
  setMesh: (mesh) => set({
    mesh, mode: 'view',
    shapes: [], selectedShapeId: null, patchResult: null, textures: [],
    scanRotation: [0, 0, 0], scanPosition: [0, 0, 0], scanVisible: true,
    tracerPoints: [], lastTracerPolygon: null,
    wallHeight: mesh.bounds
      ? Math.round((mesh.bounds[1][1] - mesh.bounds[0][1]) * 10) / 10
      : 2.8,
    floorY: mesh.floor_y ?? mesh.bounds?.[0][1] ?? 0,
  }),

  addShape: (shape) => set((s) => ({ shapes: [...s.shapes, shape], selectedShapeId: shape.id })),
  updateShape: (id, patch) =>
    set((s) => ({ shapes: s.shapes.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh)) })),
  removeShape: (id) =>
    set((s) => ({
      shapes: s.shapes.filter((sh) => sh.id !== id),
      selectedShapeId: s.selectedShapeId === id ? null : s.selectedShapeId,
    })),
  selectShape: (id) => set({ selectedShapeId: id }),
  toggleShapeVisibility: (id) =>
    set((s) => ({
      shapes: s.shapes.map((sh) => sh.id === id ? { ...sh, visible: !sh.visible } : sh),
    })),

  setPatchResult: (result) => set({ patchResult: result }),
  clearPatchResult: () => set({ patchResult: null }),

  addTexture: (tex) => set((s) => ({ textures: [...s.textures, tex] })),
  applyTextureToShape: (shapeId, textureId) =>
    set((s) => ({
      shapes: s.shapes.map((sh) => (sh.id === shapeId ? { ...sh, textureId } : sh)),
    })),

  setPrompt: (prompt) => set({ prompt }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  addTracerPoint: (p) => set((s) => ({ tracerPoints: [...s.tracerPoints, p] })),
  clearTracerPoints: () => set({ tracerPoints: [] }),
  setWallHeight: (wallHeight) => set({ wallHeight }),

  setFloorY: (newFloorY) => set((s) => ({
    floorY: newFloorY,
    shapes: s.shapes.map(sh => {
      if (sh.type === 'wall') {
        return { ...sh, position: [sh.position[0], newFloorY + s.wallHeight / 2, sh.position[2]] as [number, number, number] }
      }
      if (sh.type === 'floor-poly') {
        return { ...sh, position: [sh.position[0], newFloorY, sh.position[2]] as [number, number, number] }
      }
      return sh
    }),
  })),
  finalizeTracerRoom: () => set((s) => {
    const pts = s.tracerPoints
    if (pts.length < 3) return {}

    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length
    const cz = pts.reduce((a, p) => a + p[2], 0) / pts.length
    const floorY = s.floorY
    const wallH = s.wallHeight

    const wallShapes: PlacedShape[] = pts.flatMap((p1, i) => {
      const p2 = pts[(i + 1) % pts.length]
      const dx = p2[0] - p1[0]
      const dz = p2[2] - p1[2]
      const segLen = Math.sqrt(dx * dx + dz * dz)
      if (segLen < 0.05) return []

      const mx = (p1[0] + p2[0]) / 2
      const my = floorY + wallH / 2
      const mz = (p1[2] + p2[2]) / 2

      let nx = -dz / segLen
      let nz = dx / segLen
      if (nx * (cx - mx) + nz * (cz - mz) < 0) { nx = -nx; nz = -nz }

      const ry = Math.atan2(nx, nz)

      return [{
        id: uuid(),
        type: 'wall' as const,
        label: `Wall ${i + 1}`,
        position: [mx, my, mz] as [number, number, number],
        rotation: [0, ry, 0] as [number, number, number],
        scale: [segLen, wallH, 1] as [number, number, number],
        textureId: null,
        uvRepeat: [Math.max(1, Math.ceil(segLen)), Math.max(1, Math.ceil(wallH))],
        visible: true,
      }]
    })

    // Floor polygon — triangulated from the room outline, exact fit, no overshoot
    const floorShape: PlacedShape = {
      id: uuid(),
      type: 'floor-poly',
      label: 'Floor',
      position: [cx, floorY, cz],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      textureId: null,
      uvRepeat: [1, 1],
      visible: true,
      polygonPoints: pts.map(p => [p[0], p[2]] as [number, number]),
    }

    return {
      shapes: [...s.shapes, floorShape, ...wallShapes],
      tracerPoints: [],
      lastTracerPolygon: pts,
    }
  }),

  scaleAllWalls: (newHeight) => set((s) => ({
    wallHeight: newHeight,
    shapes: s.shapes.map(sh => {
      if (sh.type !== 'wall') return sh
      const floorY = sh.position[1] - sh.scale[1] / 2   // recover floor Y from existing center
      return {
        ...sh,
        scale: [sh.scale[0], newHeight, sh.scale[2]] as [number, number, number],
        position: [sh.position[0], floorY + newHeight / 2, sh.position[2]] as [number, number, number],
        uvRepeat: [sh.uvRepeat[0], Math.max(1, Math.ceil(newHeight))] as [number, number],
      }
    }),
  })),
}))
