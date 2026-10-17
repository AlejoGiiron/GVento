import { describe, expect, it } from 'vitest'
import { MAX_CANTIDAD, MAX_LINEAS, agregar, aItems, cambiarCantidad, firma, unidades } from './carrito'
import { celularValido, faltantesDatos, DATOS_VACIOS } from './datosCliente'

describe('portal · carrito (solo lo que el cliente quiere; ningún precio)', () => {
  it('el mismo producto con los mismos extras y nota se suma; con otros, es otra línea', () => {
    let c = agregar([], 'p1')
    c = agregar(c, 'p1')
    c = agregar(c, 'p1', 1, [{ extra_id: 'e1', cantidad: 1 }])
    c = agregar(c, 'p1', 1, [], 'sin cebolla')
    expect(c.map((l) => [l.product_id, l.cantidad, l.extras.length, l.nota])).toEqual([
      ['p1', 2, 0, ''], ['p1', 1, 1, ''], ['p1', 1, 0, 'sin cebolla']])
    expect(unidades(c)).toBe(4)
  })
  it('respeta los límites del servidor: 50 por línea y 30 líneas', () => {
    let c = agregar([], 'p1', 49)
    c = agregar(c, 'p1', 5)
    expect(c[0].cantidad).toBe(MAX_CANTIDAD)
    let d = Array.from({ length: MAX_LINEAS }, (_, i) => i).reduce((acc, i) => agregar(acc, `p${i}`), [] as ReturnType<typeof agregar>)
    d = agregar(d, 'otro')
    expect(d.length).toBe(MAX_LINEAS)
  })
  it('cambiar a 0 quita la línea', () => {
    const c = agregar([], 'p1', 2)
    expect(cambiarCantidad(c, c[0].clave, 0)).toEqual([])
    expect(cambiarCantidad(c, c[0].clave, 3)[0].cantidad).toBe(3)
  })
  it('lo que se manda tiene solo las claves de la allowlist de portal_calcular', () => {
    const c = agregar(agregar([], 'p1'), 'p2', 2, [{ extra_id: 'e1', cantidad: 1 }], 'bien cocido')
    expect(aItems(c)).toEqual([
      { product_id: 'p1', cantidad: 1 },
      { product_id: 'p2', cantidad: 2, extras: [{ extra_id: 'e1', cantidad: 1 }], nota: 'bien cocido' }])
    expect(aItems(c).flatMap((l) => Object.keys(l)).filter((k) => !['product_id', 'cantidad', 'extras', 'nota'].includes(k))).toEqual([])
  })
  it('la firma solo cambia si cambia lo que se pide', () => {
    const c = agregar([], 'p1')
    expect(firma(c)).toBe(firma(agregar([], 'p1')))
    expect(firma(c)).not.toBe(firma(agregar(c, 'p1')))
  })
})

describe('portal · datos de quien recibe', () => {
  it('celular de Colombia (3 + 9 dígitos), con o sin +57 y espacios', () => {
    expect(['300 123 4567', '+57 300 123 4567', '3001234567', '601 234 5678', '30012345', '5730012345678'].map(celularValido))
      .toEqual([true, true, true, false, false, false])
  })
  it('lo que falta para pagar, en orden; completo = []', () => {
    expect(faltantesDatos(DATOS_VACIOS, false)).toEqual([
      'el punto de entrega en el mapa', 'la dirección', 'el nombre de quien recibe', 'un celular de 10 dígitos', 'aceptar el uso de tus datos'])
    expect(faltantesDatos({ nombre: 'Laura', celular: '300 123 4567', direccion: 'Cra. 24 # 9-35', indicaciones: '', punto: { lat: 3.45, lng: -76.53 } }, true))
      .toEqual([])
  })
})
