import { describe, it, expect } from 'vitest'
import { rolLegacyDeRol } from './rolLegacy'
import { puedeCobrar } from './posMovil'
import { SYSTEM_ROLES } from './permissions'

describe('rolLegacyDeRol: el rol viejo que corresponde a cada rol RBAC', () => {
  it('roles de sistema', () => {
    expect(rolLegacyDeRol('owner')).toBe('admin')
    expect(rolLegacyDeRol('admin')).toBe('admin')
    expect(rolLegacyDeRol('cajero')).toBe('cashier')
    expect(rolLegacyDeRol('mozo')).toBe('waiter')
  })

  it('coherente con los permisos: entra a /m (rol viejo) ⇔ tiene fiado (RBAC), en cada rol de sistema', () => {
    for (const [nombre, permisos] of Object.entries(SYSTEM_ROLES)) {
      const fiado = permisos.includes('*') || permisos.includes('fiado.gestionar')
      expect(puedeCobrar(rolLegacyDeRol(nombre)), `rol ${nombre}`).toBe(fiado)
    }
  })

  it('rol personalizado: falla CERRADO (waiter: no entra a /m ni cobra) hasta que A decida por permisos', () => {
    for (const nombre of ['bartender', 'Cajero', 'cajero ', 'domiciliario', '']) {
      expect(rolLegacyDeRol(nombre), `"${nombre}"`).toBe('waiter')
      expect(puedeCobrar(rolLegacyDeRol(nombre))).toBe(false)
    }
  })
})
