import { describe, it, expect } from 'vitest'
import { decidirSedeCocina, AVISO_SEDE_CAMBIADA } from './cocinaSede'

const perfil = { restaurant_id: 'sede-A', organization_id: 'org-1' }

describe('decidirSedeCocina (KDS)', () => {
  it('sin sesión: la guardada, sin aviso (no hay con qué comparar)', () => {
    expect(decidirSedeCocina({ guardada: 'sede-X', perfil: null, orgDeLaGuardada: null }))
      .toEqual({ sede: 'sede-X', aviso: null })
  })
  it('nada guardado: la del perfil, sin aviso', () => {
    expect(decidirSedeCocina({ guardada: null, perfil, orgDeLaGuardada: null }))
      .toEqual({ sede: 'sede-A', aviso: null })
  })
  it('otra sede de la MISMA organización: se respeta', () => {
    expect(decidirSedeCocina({ guardada: 'sede-B', perfil, orgDeLaGuardada: 'org-1' }))
      .toEqual({ sede: 'sede-B', aviso: null })
  })
  it('sede de OTRA organización: se descarta y se avisa', () => {
    expect(decidirSedeCocina({ guardada: 'sede-LAB', perfil, orgDeLaGuardada: 'org-2' }))
      .toEqual({ sede: 'sede-A', aviso: AVISO_SEDE_CAMBIADA })
  })
  it('no se pudo ver (RLS) o falló la lectura: se descarta y se avisa', () => {
    expect(decidirSedeCocina({ guardada: 'sede-LAB', perfil, orgDeLaGuardada: null }))
      .toEqual({ sede: 'sede-A', aviso: AVISO_SEDE_CAMBIADA })
    expect(decidirSedeCocina({ guardada: 'sede-LAB', perfil, orgDeLaGuardada: 'error' }))
      .toEqual({ sede: 'sede-A', aviso: AVISO_SEDE_CAMBIADA })
  })
  it('perfil sin organización y sede ilegible: no se confunde null con null', () => {
    expect(decidirSedeCocina({ guardada: 'sede-LAB', perfil: { restaurant_id: 'sede-A', organization_id: null }, orgDeLaGuardada: null }))
      .toEqual({ sede: 'sede-A', aviso: AVISO_SEDE_CAMBIADA })
  })
})
