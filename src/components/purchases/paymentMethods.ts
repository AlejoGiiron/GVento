// Métodos de pago aceptados por una compra (coinciden con el check de
// purchase_invoices.payment_method en supabase/compras-proveedores.sql).
export type PaymentMethodValue = 'cash' | 'card' | 'transfer' | 'nequi'

export const PAYMENT_METHODS: { value: PaymentMethodValue; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'card', label: 'Tarjeta' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'nequi', label: 'Nequi' },
]

const LABELS: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map(m => [m.value, m.label]),
)

export const paymentMethodLabel = (value: string): string => LABELS[value] ?? value
