/**
 * Captures a cropped region from the Three.js WebGL canvas,
 * scales it to 1024×1024, and uploads it to the backend as a patch image.
 *
 * Relies on preserveDrawingBuffer: true being set on the R3F Canvas.
 */
import { useCallback } from 'react'
import axios from 'axios'

interface NormalizedRect { x: number; y: number; w: number; h: number }

export interface PatchResult {
  patch_url: string
  patch_path: string
  preview_data_url: string
}

export function useSamplePatch(glCanvas: HTMLCanvasElement | null) {
  const capture = useCallback(async (rect: NormalizedRect): Promise<PatchResult | null> => {
    if (!glCanvas) {
      console.warn('useSamplePatch: no WebGL canvas available')
      return null
    }

    // Grab current WebGL frame — requires preserveDrawingBuffer: true
    const srcDataUrl = glCanvas.toDataURL('image/png')

    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = reject
      img.src = srcDataUrl
    })

    const sw = img.naturalWidth
    const sh = img.naturalHeight
    const cropX = Math.round(rect.x * sw)
    const cropY = Math.round(rect.y * sh)
    const cropW = Math.max(Math.round(rect.w * sw), 1)
    const cropH = Math.max(Math.round(rect.h * sh), 1)

    // Scale patch to 1024×1024 for FLUX (square input preferred)
    const TARGET = 1024
    const offscreen = document.createElement('canvas')
    offscreen.width = TARGET
    offscreen.height = TARGET
    const ctx = offscreen.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, TARGET, TARGET)

    const previewDataUrl = offscreen.toDataURL('image/png')

    // Upload to backend
    const blob = await new Promise<Blob>((resolve) =>
      offscreen.toBlob((b) => resolve(b!), 'image/png')
    )
    const form = new FormData()
    form.append('file', blob, 'patch.png')
    const res = await axios.post('/api/texture/upload-patch', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })

    return {
      patch_url: res.data.patch_url,
      patch_path: res.data.patch_path,
      preview_data_url: previewDataUrl,
    }
  }, [glCanvas])

  return { capture }
}
