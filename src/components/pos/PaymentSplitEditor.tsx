import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { Enums } from '@/types/database.types'
import type { SalePaymentPart } from '@/lib/supabase-helpers'

// ─── Editor de pago dividido (mixto) ──────────────────────────────
// Compartido por POS (CheckoutModal) y Mesa (TableCheckoutModal). Solo se
// muestra en "modo dividir"; el caso común (un método al 100%) vive en el
// flujo simple del modal, intacto.
//
// - N líneas método+monto, máximo una por método (4 métodos del enum).
// - "Restante" en vivo = total − Σ montos imputados.
// - Reporta al padre (parts, valid) en cada cambio. valid = restante 0 exacto
//   y todo monto > 0 → el padre gobierna el botón Cobrar (bloqueante).
// - Vuelto anclado a la línea de efectivo: "recibido" es opcional y SOLO UI
//   (vuelto = recibido − monto efectivo). La fila se registra por el monto
//   imputado, nunca por lo recibido.

type PayMethod = Enums<'payment_method'>

const METHODS: { value: PayMethod; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'card', label: 'Tarjeta' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'nequi', label: 'Nequi / QR' },
]

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)

const parsePesos = (s: string) => parseInt(s.replace(/\D/g, ''), 10) || 0

interface Line {
  method: PayMethod
  amount: number
}

interface PaymentSplitEditorProps {
  total: number
  onChange: (parts: SalePaymentPart[], valid: boolean) => void
}

export function PaymentSplitEditor({ total, onChange }: PaymentSplitEditorProps) {
  // Semilla: una línea con el total en el primer método libre (efectivo).
  // Es un estado válido de arranque (equivale a "todo en un método"); el
  // cajero reduce esta línea y agrega otras para dividir.
  const [lines, setLines] = useState<Line[]>([{ method: 'cash', amount: total }])
  const [received, setReceived] = useState('') // recibido efectivo (opcional, solo UI)
  // El cajero ya tocó las líneas (dividió manualmente). Gobierna el re-sembrado.
  const [dirty, setDirty] = useState(false)

  // Re-sembrado INTELIGENTE ante un cambio de `total` (p.ej. se aplicó/cambió un
  // descuento tras abrir el split): si la semilla sigue INTACTA (!dirty), se
  // ajusta sola a [efectivo: nuevoTotal]. Si el cajero YA editó, NO se tocan sus
  // líneas — `remaining` (reactivo al prop `total`) recalcula y lo guía a la
  // diferencia; la validación Σ=total bloquea/desbloquea Cobrar sola.
  useEffect(() => {
    if (!dirty) setLines([{ method: 'cash', amount: total }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  const assigned = lines.reduce((s, l) => s + l.amount, 0)
  const remaining = total - assigned
  const valid = remaining === 0 && lines.every((l) => l.amount > 0)

  // Reporta parts + validez al padre en cada cambio de líneas.
  useEffect(() => {
    const parts: SalePaymentPart[] = lines.map((l) => ({ method: l.method, amount: l.amount }))
    onChange(parts, valid)
    // onChange es estable por parte del padre; evitamos incluirlo para no
    // re-disparar en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, valid])

  const usedMethods = new Set(lines.map((l) => l.method))
  const firstFreeMethod = (): PayMethod | null =>
    METHODS.find((m) => !usedMethods.has(m.value))?.value ?? null

  const addLine = () => {
    const next = firstFreeMethod()
    if (!next) return // ya están los 4 métodos
    setDirty(true)
    setLines((ls) => [...ls, { method: next, amount: 0 }])
  }

  const removeLine = (idx: number) => {
    setDirty(true)
    setLines((ls) => (ls.length <= 1 ? ls : ls.filter((_, i) => i !== idx)))
  }

  const setMethod = (idx: number, method: PayMethod) => {
    setDirty(true)
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, method } : l)))
  }

  const setAmount = (idx: number, amount: number) => {
    setDirty(true)
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, amount } : l)))
  }

  const canAdd = lines.length < METHODS.length

  const cashLine = lines.find((l) => l.method === 'cash')
  const receivedNum = parsePesos(received)
  const change = cashLine ? receivedNum - cashLine.amount : 0

  return (
    <div style={{ padding: '4px 0' }}>
      {/* Líneas método + monto */}
      {lines.map((line, i) => {
        // Opciones del select: los métodos no usados por OTRAS líneas + el propio.
        const options = METHODS.filter(
          (m) => m.value === line.method || !usedMethods.has(m.value),
        )
        return (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <select
              data-testid={`pay-line-method-${i}`}
              value={line.method}
              onChange={(e) => setMethod(i, e.target.value as PayMethod)}
              style={{
                flex: '0 0 140px', padding: '9px 10px', borderRadius: 8,
                border: '1.5px solid #e5e7eb', background: '#fff',
                fontSize: 13, color: '#334155', cursor: 'pointer', outline: 'none',
              }}
            >
              {options.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>

            <div style={{ flex: 1, position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                fontSize: 13, color: '#94a3b8', fontFamily: 'monospace', pointerEvents: 'none',
              }}>$</span>
              <input
                data-testid={`pay-line-amount-${i}`}
                inputMode="numeric"
                value={line.amount ? formatCOP(line.amount).replace('$', '').trim() : ''}
                onChange={(e) => setAmount(i, parsePesos(e.target.value))}
                placeholder="0"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '9px 10px 9px 22px',
                  borderRadius: 8, border: '1.5px solid #e5e7eb', background: '#fff',
                  fontSize: 14, fontWeight: 600, color: '#0f172a',
                  fontFamily: 'monospace', textAlign: 'right', outline: 'none',
                }}
              />
            </div>

            <button
              type="button"
              data-testid={`pay-line-remove-${i}`}
              onClick={() => removeLine(i)}
              disabled={lines.length <= 1}
              title="Quitar método"
              style={{
                flex: '0 0 32px', height: 32, display: 'grid', placeItems: 'center',
                borderRadius: 8, border: '1px solid #e5e7eb',
                background: lines.length <= 1 ? '#f8fafc' : '#fff',
                color: lines.length <= 1 ? '#cbd5e1' : '#64748b',
                cursor: lines.length <= 1 ? 'not-allowed' : 'pointer',
              }}
            >
              <X size={15} />
            </button>
          </div>
        )
      })}

      {/* Agregar método */}
      {canAdd && (
        <button
          type="button"
          data-testid="pay-add-method"
          onClick={addLine}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 2,
            padding: '7px 12px', borderRadius: 8, border: '1px dashed #cbd5e1',
            background: '#fff', color: '#334155', fontSize: 12.5, fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Plus size={14} /> Agregar método
        </button>
      )}

      {/* Restante en vivo */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginTop: 14, padding: '10px 12px', borderRadius: 10,
        background: valid ? '#ecfdf5' : '#fef2f2',
        border: `1px solid ${valid ? '#a7f3d0' : '#fecaca'}`,
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: valid ? '#065f46' : '#991b1b' }}>
          {remaining === 0 ? 'Asignado completo' : remaining > 0 ? 'Restante por asignar' : 'Excedido'}
        </span>
        <span
          data-testid="pay-remaining"
          style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: valid ? '#065f46' : '#991b1b' }}
        >
          {formatCOP(Math.abs(remaining))}
        </span>
      </div>

      {/* Vuelto: solo si hay línea de efectivo. "recibido" es opcional y solo UI. */}
      {cashLine && (
        <div style={{ marginTop: 12, padding: '12px 12px', borderRadius: 10, background: '#f8fafc', border: '1px solid #eef2f7' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Efectivo recibido (opcional)
          </div>
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 13, color: '#94a3b8', fontFamily: 'monospace', pointerEvents: 'none',
            }}>$</span>
            <input
              data-testid="pay-received"
              inputMode="numeric"
              value={received ? formatCOP(receivedNum).replace('$', '').trim() : ''}
              onChange={(e) => setReceived(e.target.value)}
              placeholder={formatCOP(cashLine.amount).replace('$', '').trim()}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '9px 10px 9px 22px',
                borderRadius: 8, border: '1.5px solid #e5e7eb', background: '#fff',
                fontSize: 14, fontWeight: 600, color: '#0f172a',
                fontFamily: 'monospace', textAlign: 'right', outline: 'none',
              }}
            />
          </div>
          {received !== '' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: change >= 0 ? '#065f46' : '#991b1b' }}>
                {change >= 0 ? 'Vuelto' : 'Falta'}
              </span>
              <span
                data-testid="pay-change"
                style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: change >= 0 ? '#065f46' : '#991b1b' }}
              >
                {formatCOP(Math.abs(change))}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
