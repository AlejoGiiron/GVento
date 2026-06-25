import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useCustomerMutations, type Customer } from '@/hooks/useCustomers'

interface CustomerFormModalProps {
  /** Cliente a editar, o 'new' para crear. */
  customer: Customer | 'new'
  onClose: () => void
  /** Se llama con el cliente guardado (sirve para seleccionarlo tras crearlo). */
  onSaved?: (customer: Customer) => void
}

const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 13px', border: '1.5px solid #e5e7eb', borderRadius: 9,
  fontSize: 14, color: '#0f172a', outline: 'none', boxSizing: 'border-box', background: '#fff',
}

export function CustomerFormModal({ customer, onClose, onSaved }: CustomerFormModalProps) {
  const { save, isMutating } = useCustomerMutations()
  const isNew = customer === 'new'

  const [name, setName] = useState(isNew ? '' : customer.name)
  const [phone, setPhone] = useState(isNew ? '' : customer.phone ?? '')
  const [document, setDocument] = useState(isNew ? '' : customer.document ?? '')
  const [notes, setNotes] = useState(isNew ? '' : customer.notes ?? '')

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Ingresa el nombre del cliente'); return }
    const saved = await save({
      id: isNew ? undefined : customer.id,
      name: name.trim(),
      phone: phone.trim() || null,
      document: document.trim() || null,
      notes: notes.trim() || null,
    })
    if (saved) onSaved?.(saved as Customer)
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 60, fontFamily: 'Inter, system-ui, sans-serif', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        data-testid="customer-form-modal"
        style={{ background: '#fff', borderRadius: 14, width: 480, maxWidth: '100%', maxHeight: '90vh', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
            {isNew ? 'Nuevo cliente' : `Editar · ${customer.name}`}
          </h3>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, background: '#f1f5f9', border: 'none', cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}><X size={16} /></button>
        </div>

        <div style={{ padding: 22, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={fieldLabel}>Nombre <span style={{ color: '#dc2626' }}>*</span></label>
            <input data-testid="customer-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Juan Pérez" style={inputStyle} autoFocus />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>Teléfono</label>
              <input data-testid="customer-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="3001234567" style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>Documento</label>
              <input data-testid="customer-document" value={document} onChange={(e) => setDocument(e.target.value)} placeholder="C.C. / NIT" style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={fieldLabel}>Notas</label>
            <textarea data-testid="customer-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones del cliente..." rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
        </div>

        <div style={{ padding: '14px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '10px 20px', border: '1.5px solid #e2e8f0', borderRadius: 9, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155' }}>Cancelar</button>
          <button
            data-testid="customer-save"
            onClick={handleSave}
            disabled={isMutating}
            style={{ padding: '10px 24px', background: isMutating ? '#cbd5e1' : '#10b981', border: 'none', borderRadius: 10, cursor: isMutating ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6, boxShadow: isMutating ? 'none' : '0 4px 12px rgba(16,185,129,.3)' }}
          >
            {isMutating && <Loader2 size={14} className="animate-spin" />}
            {isNew ? 'Crear cliente' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
