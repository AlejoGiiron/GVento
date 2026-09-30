import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, cashierCreds, type Creds } from './helpers/auth'

// ============================================================================
// Bucket restaurant-logos (logo + QR de Nequi): quién puede subir, REEMPLAZAR y
// borrar, y dónde. La app sube con `upsert: true` a rutas fijas
// `<sede>/logo.<ext>` y `<sede>/nequi-qr.<ext>` (uploadRestaurantLogo /
// uploadNequiQR en supabase-helpers), desde ConfigPage, cuya ruta exige
// `config.acceder` (<ProtectedRoute permission="config.acceder" /> en App.tsx).
//
// Contrato:
//  (a) quien tiene config.acceder REEMPLAZA el logo y el QR de SU sede.
//  (b) un admin de OTRA organización NO puede subir, reemplazar ni borrar nada
//      en la carpeta de esta sede — y SÍ puede en la suya (contraste R10: sin
//      él, un "no puede nada" pasaría (b) por la razón equivocada).
//  (c) un usuario SIN config.acceder (cajero) no puede subir, reemplazar ni
//      borrar, ni siquiera en su propia sede.
//
// 🔴 remove() sobre un objeto que la RLS no deja borrar NO devuelve error:
//    devuelve una lista vacía. Todo intento de borrado se verifica LISTANDO.
// ============================================================================

const BUCKET = 'restaurant-logos'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const otraCreds = (): Creds => ({ email: process.env.E2E_OTRA_EMAIL!, password: process.env.E2E_OTRA_PASSWORD! })

async function cliente(creds: Creds): Promise<{ c: SupabaseClient; sede: string }> {
  const c = createClient(process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword(creds)
  if (error) throw new Error(`login ${creds.email}: ${error.message}`)
  const { data: { user } } = await c.auth.getUser()
  const { data, error: e2 } = await c.from('profiles').select('restaurant_id').eq('id', user!.id).single()
  if (e2) throw e2
  return { c, sede: data!.restaurant_id as string }
}

const subir = (c: SupabaseClient, path: string) =>
  c.storage.from(BUCKET).upload(path, PNG, { upsert: true, contentType: 'image/png' })

/** ¿Existe el objeto? Se pregunta como owner de LAB (lectura pública del bucket). */
async function existe(c: SupabaseClient, path: string): Promise<boolean> {
  const [carpeta, nombre] = path.split('/')
  const { data, error } = await c.storage.from(BUCKET).list(carpeta, { search: nombre })
  if (error) throw error
  return (data ?? []).some((f) => f.name === nombre)
}

let owner: { c: SupabaseClient; sede: string }
let cajero: { c: SupabaseClient; sede: string }
let otra: { c: SupabaseClient; sede: string }

test.beforeAll(async () => {
  expect(process.env.E2E_OTRA_EMAIL, 'falta E2E_OTRA_* (scripts/capturas/local.config)').toBeTruthy()
  owner = await cliente(ownerCreds())
  cajero = await cliente(cashierCreds())
  otra = await cliente(otraCreds())
  expect(otra.sede, 'otra.test tiene que estar en OTRA sede').not.toBe(owner.sede)
})

test.describe.serial('restaurant-logos', () => {
  test('(a) el logo y el QR se REEMPLAZAN (2ª subida a la misma ruta)', async () => {
    for (const archivo of ['logo.png', 'nequi-qr.png']) {
      const path = `${owner.sede}/${archivo}`
      const r1 = await subir(owner.c, path)
      expect(r1.error, `1ª subida de ${archivo}: ${r1.error?.message}`).toBeNull()
      const r2 = await subir(owner.c, path)
      expect(r2.error, `2ª subida (reemplazo) de ${archivo}: ${r2.error?.message}`).toBeNull()
    }
  })

  test('(b) un admin de OTRA organización no toca la carpeta de esta sede', async () => {
    const ajeno = `${owner.sede}/logo.png`          // existe (lo dejó el test anterior)
    const plantado = `${owner.sede}/intruso.png`    // no existe

    // Subir un archivo NUEVO en la carpeta ajena.
    const ins = await subir(otra.c, plantado)
    expect(ins.error, 'OTRA org pudo SUBIR a la carpeta de esta sede').not.toBeNull()
    expect(await existe(owner.c, plantado)).toBe(false)

    // Reemplazar el logo ajeno.
    const upd = await subir(otra.c, ajeno)
    expect(upd.error, 'OTRA org pudo REEMPLAZAR el logo de esta sede').not.toBeNull()

    // Borrar el logo ajeno: remove() no da error aunque RLS lo impida → se lista.
    await otra.c.storage.from(BUCKET).remove([ajeno])
    expect(await existe(owner.c, ajeno), 'OTRA org pudo BORRAR el logo de esta sede').toBe(true)

    // CONTRASTE: en SU propia carpeta sí puede las tres cosas.
    const propio = `${otra.sede}/logo.png`
    expect((await subir(otra.c, propio)).error).toBeNull()
    expect((await subir(otra.c, propio)).error).toBeNull()
    await otra.c.storage.from(BUCKET).remove([propio])
    expect(await existe(owner.c, propio)).toBe(false)
  })

  test('(c) un usuario SIN config.acceder (cajero) no sube, no reemplaza, no borra', async () => {
    expect(cajero.sede).toBe(owner.sede)   // misma sede: lo que decide es el permiso
    const nuevo = `${cajero.sede}/cajero.png`
    expect((await subir(cajero.c, nuevo)).error, 'el cajero pudo SUBIR').not.toBeNull()
    expect(await existe(owner.c, nuevo)).toBe(false)

    const logo = `${owner.sede}/logo.png`
    expect((await subir(cajero.c, logo)).error, 'el cajero pudo REEMPLAZAR el logo').not.toBeNull()
    await cajero.c.storage.from(BUCKET).remove([logo])
    expect(await existe(owner.c, logo), 'el cajero pudo BORRAR el logo').toBe(true)
  })

  // Contraste de (c) y limpieza: el owner SÍ puede borrar lo suyo.
  test('limpieza: el owner borra lo que subió', async () => {
    const paths = [`${owner.sede}/logo.png`, `${owner.sede}/nequi-qr.png`]
    await owner.c.storage.from(BUCKET).remove(paths)
    for (const p of paths) expect(await existe(owner.c, p), `quedó ${p}`).toBe(false)
  })
})
