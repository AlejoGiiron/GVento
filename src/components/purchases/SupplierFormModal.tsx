import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useSuppliers, type Supplier } from '@/hooks/useSuppliers'

interface SupplierFormModalProps {
  /** Proveedor a editar, o 'new' para crear. */
  supplier: Supplier | 'new'
  onClose: () => void
}

const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 13px', border: '1.5px solid #e5e7eb', borderRadius: 9,
  fontSize: 14, color: '#0f172a', outline: 'none', boxSizing: 'border-box', background: '#fff',
}

export function SupplierFormModal({ supplier, onClose }: SupplierFormModalProps) {
  const { save, isMutating } = useSuppliers()
  const isNew = supplier === 'new'

  const [name, setName] = useState(isNew ? '' : supplier.name)
  const [contactName, setContactName] = useState(isNew ? '' : supplier.contact_name ?? '')
  const [phone, setPhone] = useState(isNew ? '' : supplier.phone ?? '')
  const [document, setDocument] = useState(isNew ? '' : supplier.document ?? '')
  const [notes, setNotes] = useState(isNew ? '' : supplier.notes ?? '')

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Ingresa el nombre del proveedor'); return }
    await save({
      id: isNew ? undefined : supplier.id,
      name: name.trim(),
      contact_name: contactName.trim() || null,
      phone: phone.trim() || null,
      document: document.trim() || null,
      notes: notes.trim() || null,
    })
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50, fontFamily: 'Inter, system-ui, sans-serif', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        data-testid="supplier-form-modal"
        style={{ background: '#fff', borderRadius: 14, width: 480, maxWidth: '100%', maxHeight: '90vh', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
            {isNew ? 'Nuevo proveedor' : `Editar · ${supplier.name}`}
          </h3>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, background: '#f1f5f9', border: 'none', cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}><X size={16} /></button>
        </div>

        <div style={{ padding: 22, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={fieldLabel}>Nombre <span style={{ color: '#dc2626' }}>*</span></label>
            <input data-testid="supplier-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Distribuidora La 80" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>Contacto</label>
              <input data-testid="supplier-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nombre del contacto" style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>Teléfono</label>
              <input data-testid="supplier-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="3001234567" style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={fieldLabel}>NIT / Documento</label>
            <input data-testid="supplier-document" value={document} onChange={(e) => setDocument(e.target.value)} placeholder="900123456-7" style={inputStyle} />
          </div>
          <div>
            <label style={fieldLabel}>Notas</label>
            <textarea data-testid="supplier-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones, condiciones de pago..." rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
        </div>

        <div style={{ padding: '14px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '10px 20px', border: '1.5px solid #e2e8f0', borderRadius: 9, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155' }}>Cancelar</button>
          <button
            data-testid="supplier-save"
            onClick={handleSave}
            disabled={isMutating}
            style={{ padding: '10px 24px', background: isMutating ? '#cbd5e1' : '#10b981', border: 'none', borderRadius: 10, cursor: isMutating ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6, boxShadow: isMutating ? 'none' : '0 4px 12px rgba(16,185,129,.3)' }}
          >
            {isMutating && <Loader2 size={14} className="animate-spin" />}
            {isNew ? 'Crear proveedor' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
