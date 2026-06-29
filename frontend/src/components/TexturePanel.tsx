import React, { useState } from 'react'
import axios from 'axios'
import { useSceneStore } from '../store/useSceneStore'

export function TexturePanel() {
  const {
    mode, mesh, selectedFaces, activeTexture, textures, uvRepeat, patchResult,
    prompt, setPrompt, setActiveTexture, setUvRepeat,
    addTexture, setLoading, setError, setMode, isLoading, clearPatchResult,
  } = useSceneStore()

  const [method, setMethod] = useState<'flux' | 'material_diffusion'>('flux')

  const generateFromPatch = async () => {
    if (!patchResult || !prompt.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await axios.post('/api/texture/from-patch', {
        patch_path: patchResult.patch_path,
        prompt,
        method,
        output_size: 1024,
      })
      const tex = { ...res.data, prompt }
      addTexture(tex)
      setActiveTexture(tex)
      setMode('apply')
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.detail ?? e.message : String(e)
      setError(`Texture generation failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  const generateFromText = async () => {
    if (!prompt.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await axios.post('/api/texture/from-text', { prompt, output_size: 1024 })
      const tex = { ...res.data, prompt }
      addTexture(tex)
      setActiveTexture(tex)
      setMode('apply')
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.detail ?? e.message : String(e)
      setError(`Texture generation failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  const applyToMesh = async () => {
    if (!mesh || !activeTexture || selectedFaces.size === 0) return
    setLoading(true)
    setError(null)
    try {
      await axios.post('/api/mesh/apply-texture', {
        mesh_id: mesh.mesh_id,
        face_indices: Array.from(selectedFaces),
        texture_path: activeTexture.texture_url,
        uv_repeat_x: uvRepeat[0],
        uv_repeat_y: uvRepeat[1],
      })
      setMode('view')
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.detail ?? e.message : String(e)
      setError(`Apply failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.panel}>
      <h3 style={styles.heading}>Texture</h3>

      {/* Step 1 — Select */}
      {mode === 'select' && (
        <Section title="1 · Select Walls">
          <p style={styles.hint}>Click faces on the 3D view to select a wall surface.</p>
          <p style={styles.hint}>
            Selected: <strong style={{ color: '#4a9eff' }}>{selectedFaces.size} faces</strong>
          </p>
          {selectedFaces.size > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              <button style={styles.primaryBtn} onClick={() => setMode('sample')}>
                Sample a patch →
              </button>
              <button style={styles.secondaryBtn} onClick={() => setMode('generate')}>
                Skip to text gen
              </button>
            </div>
          )}
        </Section>
      )}

      {/* Step 2 — Sample */}
      {mode === 'sample' && (
        <Section title="2 · Sample Patch">
          <p style={styles.hint}>
            Drag a rectangle on the 3D view over a <strong>clean section</strong> of
            the wall — no furniture, no shadows. This seeds the AI texture.
          </p>
          {patchResult && (
            <div style={styles.patchPreviewWrap}>
              <img src={patchResult.preview_data_url} style={styles.patchPreview} alt="sampled patch" />
              <p style={{ ...styles.hint, marginTop: 6, textAlign: 'center' }}>Patch captured ✓</p>
              <button style={styles.primaryBtn} onClick={() => setMode('generate')}>
                Continue →
              </button>
              <button style={{ ...styles.secondaryBtn, marginTop: 4 }} onClick={() => clearPatchResult()}>
                Resample
              </button>
            </div>
          )}
        </Section>
      )}

      {/* Step 3 — Generate */}
      {(mode === 'generate' || mode === 'apply' || mode === 'view') && (
        <Section title={patchResult ? '3 · Generate from Patch' : '2 · Generate Texture'}>
          {patchResult && (
            <div style={styles.patchPreviewWrap}>
              <img src={patchResult.preview_data_url} style={styles.patchPreview} alt="patch" />
              <p style={{ ...styles.hint, marginTop: 4, textAlign: 'center', fontSize: 10 }}>
                Sampled wall patch
              </p>
            </div>
          )}

          <label style={styles.label}>Surface description</label>
          <textarea
            style={styles.textarea}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="smooth white plaster, aged brick, concrete…"
          />

          <label style={styles.label}>Method</label>
          <div style={styles.radioGroup}>
            {(['flux', 'material_diffusion'] as const).map((m) => (
              <label key={m} style={styles.radio}>
                <input type="radio" value={m} checked={method === m} onChange={() => setMethod(m)} />
                <span style={{ marginLeft: 6 }}>
                  {m === 'flux' ? 'FLUX Fill — fast (~$0.05)' : 'Material Diffusion — seamless (~$0.03)'}
                </span>
              </label>
            ))}
          </div>

          <button
            style={{ ...styles.primaryBtn, opacity: isLoading ? 0.5 : 1 }}
            onClick={patchResult ? generateFromPatch : generateFromText}
            disabled={isLoading}
          >
            {isLoading
              ? 'Generating…'
              : patchResult
              ? '✨ Generate from patch'
              : '✨ Generate from text'}
          </button>

          {patchResult && (
            <button
              style={{ ...styles.secondaryBtn, marginTop: 6 }}
              onClick={generateFromText}
              disabled={isLoading}
            >
              Text-only fallback
            </button>
          )}
        </Section>
      )}

      {/* Texture library */}
      {textures.length > 0 && (
        <Section title="Texture Library">
          <div style={styles.textureGrid}>
            {textures.map((tex) => (
              <div
                key={tex.texture_id}
                style={{
                  ...styles.texThumb,
                  outline: activeTexture?.texture_id === tex.texture_id
                    ? '2px solid #4a9eff'
                    : '2px solid transparent',
                }}
                title={tex.prompt}
                onClick={() => { setActiveTexture(tex); setMode('apply') }}
              >
                <img src={tex.texture_url} alt={tex.prompt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Step 4 — Tiling + Apply */}
      {activeTexture && (
        <Section title={selectedFaces.size > 0 ? '4 · Tiling & Apply' : 'Tiling'}>
          {activeTexture && (
            <img
              src={activeTexture.texture_url}
              alt="generated texture"
              style={{ width: '100%', borderRadius: 4, marginBottom: 10 }}
            />
          )}

          <label style={styles.label}>Repeat X: {uvRepeat[0].toFixed(1)}</label>
          <input
            type="range" min={0.1} max={20} step={0.1}
            value={uvRepeat[0]}
            onChange={(e) => setUvRepeat([parseFloat(e.target.value), uvRepeat[1]])}
            style={styles.slider}
          />
          <label style={styles.label}>Repeat Y: {uvRepeat[1].toFixed(1)}</label>
          <input
            type="range" min={0.1} max={20} step={0.1}
            value={uvRepeat[1]}
            onChange={(e) => setUvRepeat([uvRepeat[0], parseFloat(e.target.value)])}
            style={styles.slider}
          />

          {selectedFaces.size > 0 ? (
            <button
              style={{ ...styles.primaryBtn, opacity: isLoading ? 0.5 : 1 }}
              onClick={applyToMesh}
              disabled={isLoading}
            >
              {isLoading ? 'Applying…' : `📐 Apply to ${selectedFaces.size} faces`}
            </button>
          ) : (
            <p style={styles.hint}>Switch to Select mode to pick which faces to apply this to.</p>
          )}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={styles.sectionTitle}>{title}</p>
      {children}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 268,
    flexShrink: 0,
    background: '#161616',
    borderLeft: '1px solid #222',
    padding: 16,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  heading: {
    fontSize: 13,
    fontWeight: 700,
    color: '#ccc',
    marginBottom: 20,
    paddingBottom: 12,
    borderBottom: '1px solid #222',
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 10,
  },
  hint: { fontSize: 12, color: '#666', lineHeight: 1.5, marginBottom: 8 },
  label: { display: 'block', fontSize: 11, color: '#777', marginBottom: 5 },
  textarea: {
    width: '100%',
    background: '#1e1e1e',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    color: '#ddd',
    fontSize: 12,
    padding: '8px 10px',
    resize: 'vertical',
    marginBottom: 10,
    fontFamily: 'inherit',
  },
  radioGroup: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 },
  radio: { fontSize: 11, color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center' },
  primaryBtn: {
    width: '100%',
    padding: '9px 0',
    background: '#1a3a5c',
    border: '1px solid #2a5a8c',
    borderRadius: 6,
    color: '#7ac0ff',
    fontSize: 13,
    cursor: 'pointer',
  },
  secondaryBtn: {
    width: '100%',
    padding: '7px 0',
    background: 'transparent',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    color: '#666',
    fontSize: 12,
    cursor: 'pointer',
  },
  slider: { width: '100%', marginBottom: 12, accentColor: '#4a9eff' },
  textureGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 },
  texThumb: {
    width: '100%',
    aspectRatio: '1',
    borderRadius: 4,
    overflow: 'hidden',
    cursor: 'pointer',
    background: '#222',
  },
  patchPreviewWrap: {
    marginBottom: 12,
  },
  patchPreview: {
    width: '100%',
    borderRadius: 4,
    border: '1px solid #2a2a2a',
    display: 'block',
  },
}
