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

  it('rol personalizado: HOY cae en cashier (falla abierto, R2) — pendiente pasar a waiter', () => {
    expect(rolLegacyDeRol('bartender')).toBe('cashier')
  })
})
