import { test, expect } from '@playwright/test'
import { ownerCreds, cashierCreds } from './helpers/auth'
import { usuario, otraCreds, subir, existe, type Usuario } from './helpers/storage'

// ============================================================================
// Bucket product-images (fotos de productos): quién puede subir, REEMPLAZAR y
// borrar, y dónde. La app sube con `upsert: true` a `<sede>/<productId>.<ext>`
// (uploadProductImage en supabase-helpers, llamado desde useProductMutations
// con profile.restaurant_id) y borra con deleteProductImage, desde
// ProductsPage, cuya ruta exige `productos.editar`
// (<ProtectedRoute permission="productos.editar" /> en App.tsx).
//
// Por qué existe (medido el 2026-09-30): las policies de prod ("… con permiso")
// piden bucket + has_permission('productos.editar') SIN carpeta. Mismo defecto
// de clase que restaurant-logos (R3), con más alcance: la foto se muestra desde
// una URL guardada, así que REEMPLAZAR el archivo cambia la foto que otro
// negocio ve en SU POS.
//
// Contrato (idéntico al de storage-logos):
//  (a) quien tiene productos.editar sube y REEMPLAZA la foto en SU sede.
//  (b) un usuario de OTRA organización con productos.editar NO puede subir,
//      reemplazar ni borrar en la carpeta de esta sede — y SÍ en la suya.
//  (c) un usuario SIN productos.editar (cajero) no puede, ni en su sede.
// ============================================================================

const BUCKET = 'product-images'
const FOTO = 'e2e-producto.png'   // nombre fijo: no pisa fotos reales del lab

let owner: Usuario
let cajero: Usuario
let otra: Usuario

test.beforeAll(async () => {
  owner = await usuario(ownerCreds())
  cajero = await usuario(cashierCreds())
  otra = await usuario(otraCreds())
  expect(otra.sede, 'otra.test tiene que estar en OTRA sede').not.toBe(owner.sede)
})

test.describe.serial('product-images', () => {
  test('(a) la foto de un producto se sube y se REEMPLAZA', async () => {
    const path = `${owner.sede}/${FOTO}`
    const r1 = await subir(owner.c, BUCKET, path)
    expect(r1.error, `1ª subida: ${r1.error?.message}`).toBeNull()
    const r2 = await subir(owner.c, BUCKET, path)
    expect(r2.error, `2ª subida (reemplazo): ${r2.error?.message}`).toBeNull()
  })

  test('(b) un usuario de OTRA organización no toca las fotos de esta sede', async () => {
    const ajena = `${owner.sede}/${FOTO}`
    const plantada = `${owner.sede}/intruso.png`

    expect((await subir(otra.c, BUCKET, plantada)).error, 'OTRA org pudo SUBIR a la carpeta de esta sede').not.toBeNull()
    expect(await existe(owner.c, BUCKET, plantada)).toBe(false)

    expect((await subir(otra.c, BUCKET, ajena)).error, 'OTRA org pudo REEMPLAZAR una foto de esta sede').not.toBeNull()

    await otra.c.storage.from(BUCKET).remove([ajena])
    expect(await existe(owner.c, BUCKET, ajena), 'OTRA org pudo BORRAR una foto de esta sede').toBe(true)

    // CONTRASTE: en SU propia carpeta sí puede las tres cosas.
    const propia = `${otra.sede}/${FOTO}`
    expect((await subir(otra.c, BUCKET, propia)).error).toBeNull()
    expect((await subir(otra.c, BUCKET, propia)).error).toBeNull()
    await otra.c.storage.from(BUCKET).remove([propia])
    expect(await existe(owner.c, BUCKET, propia)).toBe(false)
  })

  test('(c) un usuario SIN productos.editar (cajero) no sube, no reemplaza, no borra', async () => {
    expect(cajero.sede).toBe(owner.sede)
    const nueva = `${cajero.sede}/cajero.png`
    expect((await subir(cajero.c, BUCKET, nueva)).error, 'el cajero pudo SUBIR').not.toBeNull()
    expect(await existe(owner.c, BUCKET, nueva)).toBe(false)

    const foto = `${owner.sede}/${FOTO}`
    expect((await subir(cajero.c, BUCKET, foto)).error, 'el cajero pudo REEMPLAZAR una foto').not.toBeNull()
    await cajero.c.storage.from(BUCKET).remove([foto])
    expect(await existe(owner.c, BUCKET, foto), 'el cajero pudo BORRAR una foto').toBe(true)
  })

  test('limpieza: el owner borra lo que subió', async () => {
    const path = `${owner.sede}/${FOTO}`
    await owner.c.storage.from(BUCKET).remove([path])
    expect(await existe(owner.c, BUCKET, path), `quedó ${path}`).toBe(false)
  })
})
