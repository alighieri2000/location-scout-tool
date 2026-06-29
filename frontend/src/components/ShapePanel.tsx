/**
 * Right-side panel. Two responsibilities:
 * 1. Shape list — shows placed walls/boxes, lets user rename, select, delete, assign textures
 * 2. Texture generation — prompt + method controls, generates AI texture, assigns to selected shape
 */
import React, { useState } from 'react'
import axios from 'axios'
import { v4 as uuid } from 'uuid'
import { useSceneStore, PlacedShape } from '../store/useSceneStore'

export function ShapePanel() {
  const {
    shapes, selectedShapeId, selectShape, removeShape, updateShape,
    textures, applyTextureToShape,
    patchResult, clearPatchResult,
    prompt, setPrompt,
    setLoading, setError, isLoading, addTexture, setMode,
    mesh, addShape, toggleShapeVisibility,
    scanVisible, setScanVisible,
  } = useSceneStore()

  const [genMethod, setGenMethod] = useState<'flux' | 'material_diffusion'>('material_diffusion')
  const [detectError, setDetectError] = useState<string | null>(null)
  const [detecting, setDetecting] = useState(false)
  const selectedShape = shapes.find((s) => s.id === selectedShapeId) ?? null

  // ── Auto-detect planes ────────────────────────────────────────────────────

  const detectPlanes = async () => {
    if (!mesh) return
    setDetecting(true)
    setDetectError(null)
    try {
      const res = await axios.post('/api/mesh/detect-planes', { mesh_id: mesh.mesh_id })
      const planes: Array<{
        type: string
        center: [number, number, number]
        rotation: [number, number, number]
        width: number
        height: number
      }> = res.data.planes
      let wallIndex = 1
      for (const plane of planes) {
        addShape({
          id: uuid(),
          type: 'wall',
          label: plane.type === 'floor' ? 'Floor' : `Wall ${wallIndex++}`,
          position: plane.center as [number, number, number],
          rotation: plane.rotation as [number, number, number],
          scale: [plane.width, plane.height, 1],
          textureId: null,
          uvRepeat: [Math.max(1, Math.ceil(plane.width)), Math.max(1, Math.ceil(plane.height))],
          visible: true,
        })
      }
      setMode('transform')
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.detail ?? e.message : String(e)
      setDetectError(`Detection failed: ${msg}`)
    } finally {
      setDetecting(false)
    }
  }

  // ── Texture generation ────────────────────────────────────────────────────

  const generate = async () => {
    if (!prompt.trim()) return
    setLoading(true)
    setError(null)
    try {
      let res
      if (patchResult) {
        res = await axios.post('/api/texture/from-patch', {
          patch_path: patchResult.patch_path,
          prompt,
          method: genMethod,
          output_size: 1024,
        })
      } else {
        res = await axios.post('/api/texture/from-text', { prompt, output_size: 1024 })
      }
      const tex = { ...res.data, prompt }
      addTexture(tex)
      // Auto-assign to selected shape
      if (selectedShapeId) applyTextureToShape(selectedShapeId, tex.texture_id)
      setMode('transform')
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.detail ?? e.message : String(e)
      setError(`Generation failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.panel}>

      {/* ── Auto-detect room planes ────────────────────────────────────── */}
      <Section title="Auto-Detect Room">
        <button
          style={{ ...s.primaryBtn, opacity: detecting || !mesh ? 0.5 : 1 }}
          onClick={detectPlanes}
          disabled={detecting || !mesh}
        >
          {detecting ? 'Detecting…' : '🔍 Detect Walls & Floor'}
        </button>
        {detectError && (
          <p style={{ ...s.hint, color: '#e74c3c', marginTop: 6 }}>{detectError}</p>
        )}
        <p style={{ ...s.hint, marginTop: 6 }}>
          Finds walls, floor, and ceiling automatically using RANSAC plane fitting (~5–15 s)
        </p>
      </Section>

      {/* ── Shape list ─────────────────────────────────────────────────── */}
      <Section title="Outliner">
        {/* Scan mesh row */}
        {mesh && (
          <div style={{ ...s.shapeRow, background: '#1a1a1a', border: '1px solid #222', marginBottom: 4 }}>
            <span style={s.shapeIcon}>🏠</span>
            <span style={{ ...s.shapeLabel, color: '#888' }}>Scan mesh</span>
            <button
              style={{ ...s.visBtn, color: scanVisible ? '#4a9eff' : '#333' }}
              title={scanVisible ? 'Hide scan' : 'Show scan'}
              onClick={() => setScanVisible(!scanVisible)}
            >
              {scanVisible ? '●' : '○'}
            </button>
          </div>
        )}

        {shapes.length === 0 ? (
          <p style={s.hint}>
            Use <strong style={{ color: '#ccc' }}>Wall</strong> or <strong style={{ color: '#ccc' }}>Blocker</strong> in
            the toolbar, then click the scan to place a shape — or Auto-Detect above.
          </p>
        ) : (
          <div style={s.shapeList}>
            {shapes.map((shape) => (
              <ShapeRow
                key={shape.id}
                shape={shape}
                isSelected={shape.id === selectedShapeId}
                onSelect={() => { selectShape(shape.id); setMode('transform') }}
                onRemove={() => removeShape(shape.id)}
                onRename={(label) => updateShape(shape.id, { label })}
                onToggleVisible={() => toggleShapeVisibility(shape.id)}
              />
            ))}
          </div>
        )}

        {shapes.length > 0 && (
          <p style={{ ...s.hint, marginTop: 8 }}>
            Switch to <strong style={{ color: '#ccc' }}>Move</strong> mode to reposition with gizmos.
          </p>
        )}
      </Section>

      {/* ── UV tiling for selected shape ───────────────────────────────── */}
      {selectedShape?.textureId && (
        <Section title="Tiling">
          <UvSliders shape={selectedShape} />
        </Section>
      )}

      {/* ── Texture library ────────────────────────────────────────────── */}
      {textures.length > 0 && (
        <Section title="Textures">
          <div style={s.texGrid}>
            {textures.map((tex) => {
              const assignedTo = shapes.find((sh) => sh.textureId === tex.texture_id)
              return (
                <div
                  key={tex.texture_id}
                  style={{
                    ...s.texThumb,
                    outline: selectedShape?.textureId === tex.texture_id
                      ? '2px solid #4a9eff' : '2px solid transparent',
                  }}
                  title={tex.prompt}
                  onClick={() => {
                    if (selectedShapeId) applyTextureToShape(selectedShapeId, tex.texture_id)
                  }}
                >
                  <img src={tex.texture_url} alt={tex.prompt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  {assignedTo && (
                    <div style={s.texBadge}>{assignedTo.label}</div>
                  )}
                </div>
              )
            })}
          </div>
          {selectedShapeId && <p style={{ ...s.hint, marginTop: 6 }}>Click a texture to assign it to the selected shape.</p>}
        </Section>
      )}

      {/* ── Texture generation ─────────────────────────────────────────── */}
      <Section title={patchResult ? 'Generate from Patch' : 'Generate Texture'}>
        {patchResult ? (
          <div style={{ marginBottom: 10 }}>
            <img src={patchResult.preview_data_url} style={s.patchImg} alt="sampled patch" />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <span style={{ ...s.hint, flex: 1, margin: 0 }}>Wall patch sampled ✓</span>
              <button style={s.microBtn} onClick={clearPatchResult}>Clear</button>
            </div>
          </div>
        ) : (
          <p style={s.hint}>
            Use <strong style={{ color: '#ccc' }}>Sample</strong> to drag a patch from the scan first,
            or generate from text alone.
          </p>
        )}

        <label style={s.label}>Surface description</label>
        <textarea
          style={s.textarea}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="smooth white plaster, aged brick, raw concrete…"
        />

        <label style={s.label}>Method</label>
        <div style={s.radioGroup}>
          {(['flux', 'material_diffusion'] as const).map((m) => (
            <label key={m} style={s.radio}>
              <input type="radio" value={m} checked={genMethod === m} onChange={() => setGenMethod(m)} />
              <span style={{ marginLeft: 6 }}>
                {m === 'flux' ? 'FLUX Fill — fast' : 'Material Diffusion — seamless'}
              </span>
            </label>
          ))}
        </div>

        {!selectedShapeId && shapes.length > 0 && (
          <p style={{ ...s.hint, color: '#c0870a', marginBottom: 8 }}>
            Select a shape first — texture will auto-assign to it.
          </p>
        )}

        <button
          style={{ ...s.primaryBtn, opacity: isLoading ? 0.5 : 1 }}
          onClick={generate}
          disabled={isLoading}
        >
          {isLoading ? 'Generating…' : patchResult ? '✨ Generate from patch' : '✨ Generate from text'}
        </button>

        {!patchResult && (
          <button style={{ ...s.secondaryBtn, marginTop: 6 }} onClick={() => setMode('sample')}>
            Sample a patch first
          </button>
        )}
      </Section>

    </div>
  )
}

// ─── Shape row ────────────────────────────────────────────────────────────────

function ShapeRow({ shape, isSelected, onSelect, onRemove, onRename, onToggleVisible }: {
  shape: PlacedShape
  isSelected: boolean
  onSelect: () => void
  onRemove: () => void
  onRename: (label: string) => void
  onToggleVisible: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(shape.label)
  const { textures } = useSceneStore()
  const tex = shape.textureId ? textures.find((t) => t.texture_id === shape.textureId) : null

  return (
    <div
      style={{ ...s.shapeRow, background: isSelected ? '#1a2a3a' : '#1a1a1a', border: `1px solid ${isSelected ? '#2a5a8c' : '#222'}`, opacity: shape.visible ? 1 : 0.4 }}
      onClick={onSelect}
    >
      <span style={s.shapeIcon}>{shape.type === 'wall' ? '🪟' : shape.type === 'floor-poly' ? '⬛' : '📦'}</span>

      {editing ? (
        <input
          style={s.renameInput}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { onRename(draft); setEditing(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { onRename(draft); setEditing(false) } }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          style={s.shapeLabel}
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}
          title="Double-click to rename"
        >
          {shape.label}
        </span>
      )}

      {tex && (
        <div style={s.texDot} title={tex.prompt}>
          <img src={tex.texture_url} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 3 }} alt="" />
        </div>
      )}

      <button
        style={{ ...s.visBtn, color: shape.visible ? '#4a9eff' : '#333' }}
        onClick={(e) => { e.stopPropagation(); onToggleVisible() }}
        title={shape.visible ? 'Hide' : 'Show'}
      >
        {shape.visible ? '●' : '○'}
      </button>

      <button
        style={s.deleteBtn}
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        title="Remove shape"
      >
        ×
      </button>
    </div>
  )
}

// ─── UV sliders ───────────────────────────────────────────────────────────────

function UvSliders({ shape }: { shape: PlacedShape }) {
  const { updateShape } = useSceneStore()
  const [rx, ry] = shape.uvRepeat

  return (
    <>
      <label style={s.label}>Repeat X: {rx.toFixed(1)}</label>
      <input type="range" min={0.1} max={20} step={0.1} value={rx} style={s.slider}
        onChange={(e) => updateShape(shape.id, { uvRepeat: [parseFloat(e.target.value), ry] })} />
      <label style={s.label}>Repeat Y: {ry.toFixed(1)}</label>
      <input type="range" min={0.1} max={20} step={0.1} value={ry} style={s.slider}
        onChange={(e) => updateShape(shape.id, { uvRepeat: [rx, parseFloat(e.target.value)] })} />
    </>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={s.sectionTitle}>{title}</p>
      {children}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  panel: { width: 272, flexShrink: 0, background: '#161616', borderLeft: '1px solid #1e1e1e', padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  sectionTitle: { fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 },
  hint: { fontSize: 11, color: '#666', lineHeight: 1.6, marginBottom: 0 },
  label: { display: 'block', fontSize: 11, color: '#666', marginBottom: 5 },
  shapeList: { display: 'flex', flexDirection: 'column', gap: 5 },
  shapeRow: { display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 6, cursor: 'pointer' },
  shapeIcon: { fontSize: 13, flexShrink: 0 },
  shapeLabel: { flex: 1, fontSize: 12, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  renameInput: { flex: 1, background: '#111', border: '1px solid #3a6a9c', borderRadius: 3, color: '#eee', fontSize: 12, padding: '2px 6px' },
  texDot: { width: 18, height: 18, borderRadius: 3, overflow: 'hidden', flexShrink: 0, border: '1px solid #333' },
  visBtn: { flexShrink: 0, background: 'none', border: 'none', fontSize: 9, cursor: 'pointer', lineHeight: 1, padding: '0 3px', transition: 'color 0.15s' },
  deleteBtn: { flexShrink: 0, background: 'none', border: 'none', color: '#555', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: '0 2px' },
  texGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 },
  texThumb: { width: '100%', aspectRatio: '1', borderRadius: 4, overflow: 'hidden', cursor: 'pointer', background: '#222', position: 'relative' },
  texBadge: { position: 'absolute', bottom: 2, left: 2, right: 2, fontSize: 9, background: 'rgba(0,0,0,0.75)', color: '#aaa', padding: '2px 4px', borderRadius: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  patchImg: { width: '100%', borderRadius: 4, border: '1px solid #2a2a2a', display: 'block' },
  textarea: { width: '100%', background: '#1a1a1a', border: '1px solid #252525', borderRadius: 6, color: '#ccc', fontSize: 12, padding: '7px 9px', resize: 'vertical', marginBottom: 10, fontFamily: 'inherit' },
  radioGroup: { display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 12 },
  radio: { fontSize: 11, color: '#777', cursor: 'pointer', display: 'flex', alignItems: 'center' },
  primaryBtn: { width: '100%', padding: '9px 0', background: '#1a3a5c', border: '1px solid #2a5a8c', borderRadius: 6, color: '#7ac0ff', fontSize: 13, cursor: 'pointer' },
  secondaryBtn: { width: '100%', padding: '7px 0', background: 'transparent', border: '1px solid #252525', borderRadius: 6, color: '#666', fontSize: 11, cursor: 'pointer' },
  slider: { width: '100%', marginBottom: 10, accentColor: '#4a9eff' },
  microBtn: { fontSize: 10, color: '#666', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' },
}
