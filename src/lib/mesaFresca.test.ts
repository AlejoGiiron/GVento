import { describe, it, expect } from 'vitest'
import { motivoParaNoCobrar, motivoParaNoCerrarVacia, motivoParaNoAgregar, NO_ABIERTA, type OrdenFresca } from './mesaFresca'

const fresca = (o: Partial<OrdenFresca> = {}): OrdenFresca =>
  ({ status: 'pending', total: 10000, discount_amount: 0, lineas: 10000, items: 2, ...o })

describe('motivoParaNoCobrar', () => {
  it('la mesa como la ve el modal: se cobra (contraste de todos los rechazos de abajo)', () => {
    expect(motivoParaNoCobrar(fresca(), 10000, 10000, false)).toBeNull()
    // Cortesía del 100 % que cubre todas las líneas: se puede cerrar en $0.
    expect(motivoParaNoCobrar(fresca(), 10000, 0, false)).toBeNull()
    // Con un descuento ya persistido de un intento anterior: el subtotal se recupera.
    expect(motivoParaNoCobrar(fresca({ total: 7000, discount_amount: 3000 }), 10000, 7000, false)).toBeNull()
  })

  it('ya cobrada o cancelada por otro equipo', () => {
    expect(motivoParaNoCobrar(fresca({ status: 'delivered' }), 10000, 10000, false)).toBe(NO_ABIERTA)
    expect(motivoParaNoCobrar(fresca({ status: 'cancelled' }), 10000, 10000, false)).toBe(NO_ABIERTA)
  })

  it('otro equipo agregó una tanda con el modal abierto (cortesía o descuento sobre lo viejo)', () => {
    const f = fresca({ total: 15000, lineas: 15000, items: 3 })
    expect(motivoParaNoCobrar(f, 10000, 0, false)).toMatch(/cambió.*\$\s?15\.000/)
    expect(motivoParaNoCobrar(f, 10000, 9000, false)).toMatch(/cambió/)
  })

  it('el total guardado en 0 con líneas > 0 (el caso de la 2b): no se cierra en $0', () => {
    expect(motivoParaNoCobrar(fresca({ total: 0, lineas: 13000 }), 0, 0, false))
      .toMatch(/consumo por \$\s?13\.000 sin cobrar/)
    // A fiado no se cierra en $0 sin cobro: queda como deuda, la guarda no aplica.
    expect(motivoParaNoCobrar(fresca({ total: 0, lineas: 13000 }), 0, 0, true)).toBeNull()
  })
})

describe('motivoParaNoCerrarVacia / motivoParaNoAgregar', () => {
  it('cerrar sin consumo: solo vacía y abierta', () => {
    expect(motivoParaNoCerrarVacia(fresca({ items: 0, lineas: 0, total: 0 }))).toBeNull()
    expect(motivoParaNoCerrarVacia(fresca({ items: 1 }))).toMatch(/ya tiene consumo \(1 ítem\)/)
    expect(motivoParaNoCerrarVacia(fresca({ items: 0, status: 'delivered' }))).toBe(NO_ABIERTA)
  })

  it('agregar: solo a una orden abierta', () => {
    for (const s of ['pending', 'preparing', 'ready']) expect(motivoParaNoAgregar(s)).toBeNull()
    for (const s of ['delivered', 'cancelled']) expect(motivoParaNoAgregar(s)).toMatch(/no se agregó nada/)
  })
})
