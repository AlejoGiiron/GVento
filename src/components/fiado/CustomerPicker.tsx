import { useMemo, useState } from 'react'
import { Search, Plus, Check, UserRound } from 'lucide-react'
import { useCustomers, type Customer } from '@/hooks/useCustomers'
import { CustomerFormModal } from '@/components/fiado/CustomerFormModal'

interface CustomerPickerProps {
  value: string | null
  onChange: (customerId: string, customerName: string) => void
}

const inputStyle: React.CSSProperties = {
  flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: '#0f172a',
}

/**
 * Selector de cliente con búsqueda y alta rápida inline. Componente controlado
 * (value = customerId). Reutilizado por el cobro del POS, el cierre de mesa y
 * (potencialmente) cualquier flujo que exija elegir cliente.
 */
export function CustomerPicker({ value, onChange }: CustomerPickerProps) {
  const { customers } = useCustomers()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q) || (c.document ?? '').includes(q),
    )
  }, [customers, search])

  return (
    <div data-testid="customer-picker">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1.5px solid #e5e7eb', borderRadius: 9, padding: '10px 12px', background: '#fff' }}>
        <Search size={15} color="#94a3b8" />
        <input
          data-testid="customer-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente por nombre, teléfono o documento"
          style={inputStyle}
        />
        <button
          data-testid="customer-quick-create"
          onClick={() => setCreating(true)}
          title="Crear cliente"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', border: '1.5px dashed #a7f3d0', background: '#ecfdf5', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#065f46', flex: '0 0 auto' }}
        >
          <Plus size={13} /> Nuevo
        </button>
      </div>

      <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', border: '1px solid #f1f5f9', borderRadius: 9 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>
            {customers.length === 0 ? 'Aún no hay clientes. Crea el primero.' : 'Sin coincidencias.'}
          </div>
        ) : (
          filtered.map((c, idx) => {
            const selected = c.id === value
            return (
              <button
                key={c.id}
                data-testid="customer-option"
                onClick={() => onChange(c.id, c.name)}
                style={{
                  width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', border: 'none', cursor: 'pointer',
                  borderBottom: idx < filtered.length - 1 ? '1px solid #f8fafc' : 'none',
                  background: selected ? '#ecfdf5' : '#fff',
                }}
              >
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: selected ? '#10b981' : '#f1f5f9', display: 'grid', placeItems: 'center', color: selected ? '#fff' : '#94a3b8', flex: '0 0 auto' }}>
                  {selected ? <Check size={15} /> : <UserRound size={15} />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                  {(c.phone || c.document) && (
                    <div style={{ fontSize: 11.5, color: '#64748b' }}>
                      {[c.phone, c.document].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              </button>
            )
          })
        )}
      </div>

      {creating && (
        <CustomerFormModal
          customer="new"
          onClose={() => setCreating(false)}
          onSaved={(c: Customer) => { onChange(c.id, c.name); setSearch('') }}
        />
      )}
    </div>
  )
}
