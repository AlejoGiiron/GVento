import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ACCIONES, ORIGENES_POR_DEFECTO, claveLimite, diaBogota, ipDelCliente, leerOrigenes, origenPermitido,
  segundosParaReintentar, validarCuerpo,
} from './reglas'

const h = (o: Record<string, string>) => new Headers(o)

describe('portal · IP del cliente (decidido el 2026-10-15 con la medición en prod)', () => {
  it('cf-connecting-ip manda; x-forwarded-for solo si cf viene vacío; sin las dos, null', () => {
    expect([
      ipDelCliente(h({ 'cf-connecting-ip': '186.27.163.201', 'x-forwarded-for': '1.2.3.4' })),
      ipDelCliente(h({ 'cf-connecting-ip': '  ', 'x-forwarded-for': '186.27.163.201,186.27.163.201, 3.2.52.109' })),
      ipDelCliente(h({ 'x-forwarded-for': ' 186.27.163.201 , 3.2.52.109' })),
      ipDelCliente(h({ 'x-real-ip': '1.2.3.4' })),
      ipDelCliente(h({ 'x-forwarded-for': '' })),
    ]).toEqual(['186.27.163.201', '186.27.163.201', '186.27.163.201', null, null])
  })
})

describe('portal · origen (CORS por allowlist)', () => {
  const lista = leerOrigenes(undefined)
  it('sin PORTAL_ORIGENES: el dominio del portal y la app; nada más', () => {
    expect(lista).toEqual([...ORIGENES_POR_DEFECTO])
    expect(['https://pedir.gvento.online', 'https://g-vento.vercel.app', 'https://evil.com',
      'https://pedir.gvento.online.evil.com', 'http://pedir.gvento.online', 'https://g-vento-x-equipo.vercel.app']
      .map((o) => `${o}: ${origenPermitido(o, lista, null)}`))
      .toEqual(['https://pedir.gvento.online: true', 'https://g-vento.vercel.app: true', 'https://evil.com: false',
        'https://pedir.gvento.online.evil.com: false', 'http://pedir.gvento.online: false', 'https://g-vento-x-equipo.vercel.app: false'])
  })
  it('vistas previas: solo https://g-vento-<algo><sufijo>', () => {
    const suf = '-alejandro-projects.vercel.app'
    expect(['https://g-vento-git-feat-p2-alejandro-projects.vercel.app', 'https://g-vento-abc123-alejandro-projects.vercel.app',
      'https://otro-git-x-alejandro-projects.vercel.app', 'https://g-vento-a.b-alejandro-projects.vercel.app',
      'https://g-vento--alejandro-projects.vercel.app.evil.com']
      .map((o) => origenPermitido(o, lista, suf))).toEqual([true, true, false, false, false])
  })
  it('PORTAL_ORIGENES reemplaza la lista por defecto', () => {
    expect(leerOrigenes(' http://localhost:5180 , http://localhost:5173,')).toEqual(['http://localhost:5180', 'http://localhost:5173'])
  })
})

describe('portal · cuerpo (allowlist de acciones y claves)', () => {
  it('catálogo y cotizar válidos → los parámetros de la base', () => {
    expect(validarCuerpo('{"accion":"catalogo","slug":"salchimelo"}')).toEqual({ ok: true, accion: 'catalogo', params: { p_slug: 'salchimelo' } })
    expect(validarCuerpo('{"accion":"cotizar","slug":"s","items":[{"product_id":"x","cantidad":1}],"lat":3.4,"lng":-76.5}'))
      .toEqual({ ok: true, accion: 'cotizar', params: { p_slug: 's', p_items: [{ product_id: 'x', cantidad: 1 }], p_lat: 3.4, p_lng: -76.5 } })
    expect(validarCuerpo('{"accion":"cotizar","slug":"s","items":[]}'))
      .toEqual({ ok: true, accion: 'cotizar', params: { p_slug: 's', p_items: [], p_lat: null, p_lng: null } })
  })
  it('rechaza lo demás, con contraste clave por clave', () => {
    const casos = [
      'no es json', '[]', 'null', '{"slug":"s"}', '{"accion":"crear","slug":"s"}', '{"accion":"toString","slug":"s"}',
      '{"accion":"catalogo","slug":"s","items":[]}', '{"accion":"catalogo"}', '{"accion":"catalogo","slug":""}',
      `{"accion":"catalogo","slug":"${'a'.repeat(41)}"}`, '{"accion":"cotizar","slug":"s"}',
      '{"accion":"cotizar","slug":"s","items":{}}', '{"accion":"cotizar","slug":"s","items":[],"lat":"3"}',
      '{"accion":"cotizar","slug":"s","items":[],"total":1}', '{"accion":"cotizar","slug":"s","items":[],"lat":1e999}',
    ]
    expect(casos.map((c) => validarCuerpo(c).ok)).toEqual(casos.map(() => false))
    expect(validarCuerpo('{"accion":"cotizar","slug":"s","items":[],"total":1,"precio":2}'))
      .toEqual({ ok: false, error: 'Clave no permitida: precio, total.' })
  })
  it('cada acción tiene su función de la base y un límite > 0', () => {
    expect(Object.entries(ACCIONES).map(([a, v]) => `${a}→${v.rpc}:${v.porMinuto > 0}`))
      .toEqual(['catalogo→portal_catalogo:true', 'cotizar→portal_cotizar:true'])
  })
})

describe('portal · clave del límite (la IP nunca sale en claro)', () => {
  const sal = 'x'.repeat(32)
  // 2026-10-15 23:30 en Bogotá = 2026-10-16 04:30 UTC.
  const noche = new Date('2026-10-16T04:30:00Z')
  const madrugada = new Date('2026-10-16T05:30:00Z')   // 00:30 del 16 en Bogotá
  it('el día es el de Bogotá (R7), no el UTC', () => {
    expect([diaBogota(noche), diaBogota(madrugada)]).toEqual(['2026-10-15', '2026-10-16'])
  })
  it('forma `acción:` + 64 hex (el CHECK portal_limites_clave) y sin la IP', async () => {
    const c = await claveLimite('cotizar', '186.27.163.201', sal, noche)
    expect(c).toMatch(/^cotizar:[0-9a-f]{64}$/)
    expect(c).not.toContain('186')
    // Sin IP: UN solo balde global, sea cual sea la acción.
    expect([await claveLimite('catalogo', null, sal, noche), await claveLimite('cotizar', null, sal, noche)])
      .toEqual(['global:sin-ip', 'global:sin-ip'])
  })
  it('las claves que produce, para cada acción, cumplen el CHECK portal_limites_clave LEÍDO del .sql', async () => {
    // Una acción nueva con guion o número (crear-pedido) daría 503 en producción solo para ella.
    const sql = readFileSync(resolve(__dirname, '../../portal-publico.sql'), 'utf-8')
    const m = sql.match(/constraint portal_limites_clave check \(clave ~ '([^']+)'\)/)
    expect(m, 'el CHECK está en supabase/portal-publico.sql').not.toBeNull()
    const check = new RegExp(m![1])
    const claves = [...await Promise.all(Object.keys(ACCIONES).map((a) => claveLimite(a as keyof typeof ACCIONES, '186.27.163.201', sal, noche))),
      await claveLimite('cotizar', null, sal, noche)]
    expect(claves.filter((c) => !check.test(c))).toEqual([])
    // Contraste: lo que no debe entrar, no entra.
    expect(['cotizar:186.27.163.201', 'cotizar:sin-ip', 'crear-pedido:' + 'a'.repeat(64)].map((c) => check.test(c))).toEqual([false, false, false])
  })
  it('cambia con la IP, con el día (de Bogotá) y con la sal; igual dentro del mismo día', async () => {
    const base = await claveLimite('cotizar', '186.27.163.201', sal, noche)
    expect(await claveLimite('cotizar', '186.27.163.201', sal, new Date('2026-10-15T06:00:00Z'))).toBe(base)
    const distintas = await Promise.all([
      claveLimite('cotizar', '186.27.163.202', sal, noche),
      claveLimite('cotizar', '186.27.163.201', sal, madrugada),
      claveLimite('cotizar', '186.27.163.201', 'y'.repeat(32), noche),
    ])
    expect(distintas.map((d) => d === base)).toEqual([false, false, false])
  })
  it('Retry-After: los segundos que faltan para el minuto siguiente', () => {
    expect([segundosParaReintentar(new Date('2026-10-15T12:00:00Z')), segundosParaReintentar(new Date('2026-10-15T12:00:59Z'))]).toEqual([60, 1])
  })
})
