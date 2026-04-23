import { useRef, useState, useCallback } from 'react'
import { Upload, X, ImageIcon } from 'lucide-react'

const MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

interface ImageUploadProps {
  value: string | null
  onChange: (file: File | null) => void
  onRemove: () => void
}

export function ImageUpload({ value, onChange, onRemove }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [sizeError, setSizeError] = useState(false)
  const [typeError, setTypeError] = useState(false)

  const validate = useCallback((file: File): boolean => {
    setSizeError(false)
    setTypeError(false)
    if (!ACCEPTED.includes(file.type)) { setTypeError(true); return false }
    if (file.size > MAX_BYTES) { setSizeError(true); return false }
    return true
  }, [])

  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return
    if (validate(file)) onChange(file)
  }, [validate, onChange])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }, [handleFile])

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }
  const handleDragLeave = () => setDragging(false)

  // ── Preview mode ────────────────────────────────────────────
  if (value) {
    return (
      <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
        <img
          src={value}
          alt="Imagen del producto"
          style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0)', transition: 'background .15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(15,23,42,.3)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(15,23,42,0)' }}
        >
          <button
            type="button"
            onClick={onRemove}
            title="Eliminar imagen"
            style={{
              position: 'absolute', top: 8, right: 8,
              width: 32, height: 32, borderRadius: 8,
              background: 'rgba(15,23,42,.7)', border: 'none',
              cursor: 'pointer', color: '#fff',
              display: 'grid', placeItems: 'center',
            }}
          >
            <X size={15} strokeWidth={2.5} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          style={{
            position: 'absolute', bottom: 8, right: 8,
            padding: '5px 10px', borderRadius: 7,
            background: 'rgba(15,23,42,.7)', border: 'none',
            cursor: 'pointer', color: '#fff',
            fontSize: 11.5, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <Upload size={12} /> Cambiar
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(',')}
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
    )
  }

  // ── Drop zone ────────────────────────────────────────────────
  return (
    <div>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? '#10b981' : (sizeError || typeError) ? '#ef4444' : '#e2e8f0'}`,
          borderRadius: 10,
          padding: '28px 20px',
          background: dragging ? 'rgba(16,185,129,.04)' : '#fafafa',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          cursor: 'pointer', transition: 'all .15s',
          textAlign: 'center',
        }}
      >
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: dragging ? '#ecfdf5' : '#f1f5f9',
          display: 'grid', placeItems: 'center',
          color: dragging ? '#10b981' : '#94a3b8',
          transition: 'all .15s',
        }}>
          <ImageIcon size={20} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
            {dragging ? 'Suelta aquí' : 'Arrastra una imagen o'}
            {!dragging && (
              <span style={{ color: '#10b981', marginLeft: 4 }}>selecciona un archivo</span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 3 }}>
            JPG, PNG o WebP · máx. 2 MB
          </div>
        </div>
      </div>

      {sizeError && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 5 }}>
          <X size={12} strokeWidth={2.5} /> La imagen supera el límite de 2 MB
        </div>
      )}
      {typeError && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 5 }}>
          <X size={12} strokeWidth={2.5} /> Solo se aceptan JPG, PNG y WebP
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  )
}
