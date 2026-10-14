import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { SYSTEM_ROLES } from './permissions'

// CONTRATO (R1) de A — permisos de cobro. La lista de lo que la migración AGREGA a los
// roles de cada organización vive en DOS archivos SQL (la migración y su pre-flight) y
// tiene que coincidir, y además con SYSTEM_ROLES (lo que nace en una organización nueva):
// si divergen, el pre-flight predice una cosa y la migración hace otra.
const raiz = path.resolve(__dirname, '../..')
const lista = (rel: string) => {
  const sql = fs.readFileSync(path.join(raiz, rel), 'utf8').replace(/\r\n/g, '\n')
  const m = /-- AGREGAR:inicio[^\n]*\n([\s\S]*?)-- AGREGAR:fin/.exec(sql)
  expect(m, `${rel}: faltan las marcas AGREGAR`).not.toBeNull()
  return [...m![1].matchAll(/\('(\w+)',\s*'([\w.]+)'\)/g)].map((x) => `${x[1]}|${x[2]}`).sort()
}

describe('A: lo que se agrega a los roles', () => {
  const migracion = lista('supabase/permisos-cobro.sql')
  const preflight = lista('supabase/diag/permisos-cobro-preflight.sql')

  it('la migración y el pre-flight agregan EXACTAMENTE lo mismo', () => {
    expect(migracion.length).toBeGreaterThan(0)
    expect(preflight).toEqual(migracion)
  })

  it('todo lo que se agrega está en SYSTEM_ROLES (una organización nueva nace igual)', () => {
    for (const par of migracion) {
      const [rol, clave] = par.split('|')
      expect(SYSTEM_ROLES[rol], `rol ${rol}`).toBeDefined()
      expect(SYSTEM_ROLES[rol], `${rol} debería tener ${clave}`).toContain(clave)
    }
  })

  it('las dos claves de cobro llegan a admin y cajero; al mozo, mesas.cobrar (y pos.vender se queda)', () => {
    for (const rol of ['admin', 'cajero']) {
      expect(SYSTEM_ROLES[rol]).toContain('pos.vender')
      expect(SYSTEM_ROLES[rol]).toContain('mesas.cobrar')
    }
    expect(SYSTEM_ROLES.mozo).toContain('pos.vender')
    expect(SYSTEM_ROLES.mozo).toContain('mesas.cobrar')
  })
})
