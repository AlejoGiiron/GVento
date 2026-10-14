import { describe, it, expect } from 'vitest'
import { rolLegacyDeRol } from './rolLegacy'
import { seRedirigeAMovil } from './posMovil'
import { SYSTEM_ROLES } from './permissions'

describe('rolLegacyDeRol: el rol viejo que corresponde a cada rol RBAC', () => {
  it('roles de sistema', () => {
    expect(rolLegacyDeRol('owner')).toBe('admin')
    expect(rolLegacyDeRol('admin')).toBe('admin')
    expect(rolLegacyDeRol('cajero')).toBe('cashier')
    expect(rolLegacyDeRol('mozo')).toBe('waiter')
  })

  it('se redirigen a /m solo dueño, admin y cajero; el mozo no (hasta M2)', () => {
    const redirigidos = Object.keys(SYSTEM_ROLES).filter((n) => seRedirigeAMovil(rolLegacyDeRol(n))).sort()
    expect(redirigidos).toEqual(['admin', 'cajero', 'owner'])
  })

  it('a nadie se lo redirige a /m sin poder vender: todo rol de sistema redirigido tiene pos.vender', () => {
    for (const [nombre, permisos] of Object.entries(SYSTEM_ROLES)) {
      if (!seRedirigeAMovil(rolLegacyDeRol(nombre))) continue
      expect(permisos.includes('*') || permisos.includes('pos.vender'), `rol ${nombre}`).toBe(true)
    }
  })

  it('rol personalizado: falla CERRADO (waiter: no se redirige a /m; cobrar lo deciden sus permisos)', () => {
    for (const nombre of ['bartender', 'Cajero', 'cajero ', 'domiciliario', '']) {
      expect(rolLegacyDeRol(nombre), `"${nombre}"`).toBe('waiter')
      expect(seRedirigeAMovil(rolLegacyDeRol(nombre))).toBe(false)
    }
  })
})
