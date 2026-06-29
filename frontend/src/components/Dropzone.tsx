import React, { useCallback, useState } from 'react'
import axios from 'axios'
import { useSceneStore } from '../store/useSceneStore'

const ACCEPTED = ['.obj', '.glb', '.gltf', '.usdz', '.ply', '.stl', '.pts', '.las', '.xyz']

export function Dropzone() {
  const { setMesh, setLoading, setError, isLoading } = useSceneStore()
  const [isDragging, setIsDragging] = useState(false)

  const upload = useCallback(async (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ACCEPTED.includes(ext)) {
      setError(`Unsupported file type: ${ext}. Please export as .glb or .obj from your scan app.`)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await axios.post('/api/mesh/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setMesh(res.data)
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.detail ?? e.message : String(e)
      setError(`Upload failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [setMesh, setLoading, setError])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) upload(file)
  }, [upload])

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) upload(file)
  }, [upload])

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <label
        style={{
          ...styles.zone,
          borderColor: isDragging ? '#4a9eff' : '#333',
          background: isDragging ? '#1a2a3a' : '#1a1a1a',
        }}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept={ACCEPTED.join(',')}
          style={{ display: 'none' }}
          onChange={onChange}
          disabled={isLoading}
        />
        {isLoading ? (
          <>
            <span style={styles.icon}>⏳</span>
            <p style={styles.heading}>Processing scan…</p>
          </>
        ) : (
          <>
            <span style={styles.icon}>📐</span>
            <p style={styles.heading}>Drop your scan file here</p>
            <p style={styles.sub}>or click to browse</p>
            <p style={styles.formats}>{ACCEPTED.join('  ·  ')}</p>
            <p style={styles.apps}>From Polycam · Scaniverse · Vectorworks Nomad</p>
          </>
        )}
      </label>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  zone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    width: 480,
    height: 320,
    border: '2px dashed',
    borderRadius: 12,
    cursor: 'pointer',
    transition: 'all 0.15s',
    padding: 32,
    textAlign: 'center',
  },
  icon: { fontSize: 48 },
  heading: { fontSize: 18, fontWeight: 600, color: '#eee' },
  sub: { fontSize: 14, color: '#777' },
  formats: { fontSize: 11, color: '#555', letterSpacing: '0.05em', marginTop: 8 },
  apps: { fontSize: 11, color: '#444', marginTop: 4 },
}
