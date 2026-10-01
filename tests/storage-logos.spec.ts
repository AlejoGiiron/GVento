import { test, expect } from '@playwright/test'
import { ownerCreds, cashierCreds } from './helpers/auth'
import { usuario, otraCreds, subir, existe, type Usuario } from './helpers/storage'

// ============================================================================
// Bucket restaurant-logos (logo + QR de Nequi): quién puede subir, REEMPLAZAR y
// borrar, y dónde. La app sube con `upsert: true` a rutas fijas
// `<sede>/logo.<ext>` y `<sede>/nequi-qr.<ext>` (uploadRestaurantLogo /
// uploadNequiQR en supabase-helpers), desde ConfigPage, cuya ruta exige
// `config.acceder` (<ProtectedRoute permission="config.acceder" /> en App.tsx).
// Policies: supabase/restaurant-logos-policies.sql.
//
// Contrato:
//  (a) quien tiene config.acceder REEMPLAZA el logo y el QR de SU sede.
//  (b) un admin de OTRA organización NO puede subir, reemplazar ni borrar nada
//      en la carpeta de esta sede — y SÍ puede en la suya (contraste R10: sin
//      él, un "no puede nada" pasaría (b) por la razón equivocada).
//  (c) un usuario SIN config.acceder (cajero) no puede subir, reemplazar ni
//      borrar, ni siquiera en su propia sede.
// Mutantes verificados el 2026-09-30: "UPDATE/DELETE con el alcance del INSERT
// de prod" muere en (b); "carpeta sin permiso" muere en (c).
// ============================================================================

const BUCKET = 'restaurant-logos'

let owner: Usuario
let cajero: Usuario
let otra: Usuario

test.beforeAll(async () => {
  owner = await usuario(ownerCreds())
  cajero = await usuario(cashierCreds())
  otra = await usuario(otraCreds())
  expect(otra.sede, 'otra.test tiene que estar en OTRA sede').not.toBe(owner.sede)
})

test.describe.serial('restaurant-logos', () => {
  test('(a) el logo y el QR se REEMPLAZAN (2ª subida a la misma ruta)', async () => {
    for (const archivo of ['logo.png', 'nequi-qr.png']) {
      const path = `${owner.sede}/${archivo}`
      const r1 = await subir(owner.c, BUCKET, path)
      expect(r1.error, `1ª subida de ${archivo}: ${r1.error?.message}`).toBeNull()
      const r2 = await subir(owner.c, BUCKET, path)
      expect(r2.error, `2ª subida (reemplazo) de ${archivo}: ${r2.error?.message}`).toBeNull()
    }
  })

  test('(b) un admin de OTRA organización no toca la carpeta de esta sede', async () => {
    const ajeno = `${owner.sede}/logo.png`          // existe (lo dejó el test anterior)
    const plantado = `${owner.sede}/intruso.png`    // no existe

    expect((await subir(otra.c, BUCKET, plantado)).error, 'OTRA org pudo SUBIR a la carpeta de esta sede').not.toBeNull()
    expect(await existe(owner.c, BUCKET, plantado)).toBe(false)

    expect((await subir(otra.c, BUCKET, ajeno)).error, 'OTRA org pudo REEMPLAZAR el logo de esta sede').not.toBeNull()

    await otra.c.storage.from(BUCKET).remove([ajeno])
    expect(await existe(owner.c, BUCKET, ajeno), 'OTRA org pudo BORRAR el logo de esta sede').toBe(true)

    // CONTRASTE: en SU propia carpeta sí puede las tres cosas.
    const propio = `${otra.sede}/logo.png`
    expect((await subir(otra.c, BUCKET, propio)).error).toBeNull()
    expect((await subir(otra.c, BUCKET, propio)).error).toBeNull()
    await otra.c.storage.from(BUCKET).remove([propio])
    expect(await existe(owner.c, BUCKET, propio)).toBe(false)
  })

  test('(c) un usuario SIN config.acceder (cajero) no sube, no reemplaza, no borra', async () => {
    expect(cajero.sede).toBe(owner.sede)   // misma sede: lo que decide es el permiso
    const nuevo = `${cajero.sede}/cajero.png`
    expect((await subir(cajero.c, BUCKET, nuevo)).error, 'el cajero pudo SUBIR').not.toBeNull()
    expect(await existe(owner.c, BUCKET, nuevo)).toBe(false)

    const logo = `${owner.sede}/logo.png`
    expect((await subir(cajero.c, BUCKET, logo)).error, 'el cajero pudo REEMPLAZAR el logo').not.toBeNull()
    await cajero.c.storage.from(BUCKET).remove([logo])
    expect(await existe(owner.c, BUCKET, logo), 'el cajero pudo BORRAR el logo').toBe(true)
  })

  // Contraste de (c) y limpieza: el owner SÍ puede borrar lo suyo.
  test('limpieza: el owner borra lo que subió', async () => {
    const paths = [`${owner.sede}/logo.png`, `${owner.sede}/nequi-qr.png`]
    await owner.c.storage.from(BUCKET).remove(paths)
    for (const p of paths) expect(await existe(owner.c, BUCKET, p), `quedó ${p}`).toBe(false)
  })
})
