import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner, ownerCreds } from './helpers/auth'
import { saveProductAndClose } from './helpers/product'
import { usuario, existe, PNG_1PX, type Usuario } from './helpers/storage'

// ============================================================================
// La foto de un producto, subida por la UI REAL (ProductModal → ImageUpload →
// useProductMutations.uploadImage → uploadProductImage) — no por una ruta
// armada a mano. Es la guarda del modo de fallo de
// supabase/product-images-policies.sql: si la ruta que arma la app y el alcance
// de la policy no coinciden, NINGÚN cliente puede subir fotos, y este spec lo
// dice. Tiene que pasar CON y SIN esa migración (la subida legítima no cambia).
//
// Recorre los tres caminos de escritura de la app:
//   · subir (producto sin foto → con foto),
//   · reemplazar (misma ruta `<sede>/<productId>.png`, upsert),
//   · quitar ("Eliminar imagen" → deleteProductImage, que se TRAGA el error:
//     por eso se verifica que el archivo desapareció de verdad, listando).
// ============================================================================

const BUCKET = 'product-images'
const SUFFIX = Date.now().toString().slice(-6)
const NOMBRE = `E2E Foto ${SUFFIX}`

let owner: Usuario
let productoId = ''

async function editar(page: Page) {
  await page.goto('/productos')
  await page.getByPlaceholder(/Buscar/).first().fill(NOMBRE)
  await page.getByTitle('Editar', { exact: true }).first().click()
  await expect(page.getByPlaceholder('Ej: Mojito Cubano')).toHaveValue(NOMBRE)
}

async function imageUrl(): Promise<string | null> {
  const { data, error } = await owner.c.from('products').select('image_url').eq('id', productoId).single()
  if (error) throw error
  return data!.image_url as string | null
}

test.beforeAll(async () => {
  owner = await usuario(ownerCreds())
  const cat = (await owner.c.from('categories').select('id').eq('restaurant_id', owner.sede).limit(1).single()).data!.id
  const { data, error } = await owner.c.from('products')
    .insert({ restaurant_id: owner.sede, category_id: cat, name: NOMBRE, price: 1000, kind: 'simple' })
    .select('id').single()
  if (error) throw error
  productoId = data!.id as string
})

test.afterAll(async () => {
  if (!productoId) return
  await owner.c.storage.from(BUCKET).remove([`${owner.sede}/${productoId}.png`])
  const { error } = await owner.c.from('products').update({ is_active: false, image_url: null }).eq('id', productoId)
  expect(error).toBeNull()
})

test.describe.serial('Foto de producto por la UI', () => {
  const ruta = () => `${owner.sede}/${productoId}.png`

  test('subir: la app guarda la foto en <sede activa>/<productId>.png', async ({ page }) => {
    await loginAsOwner(page)
    await editar(page)
    await page.locator('input[type="file"]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG_1PX })
    await saveProductAndClose(page)

    const url = await imageUrl()
    expect(url, 'la subida falló: el producto quedó sin foto').not.toBeNull()
    expect(url).toContain(`/${BUCKET}/${ruta()}`)
    expect(await existe(owner.c, BUCKET, ruta())).toBe(true)
  })

  test('reemplazar: misma ruta, archivo nuevo', async ({ page }) => {
    const antes = (await owner.c.storage.from(BUCKET).list(owner.sede, { search: `${productoId}.png` })).data?.[0]?.updated_at
    await loginAsOwner(page)
    await editar(page)
    await page.getByRole('button', { name: 'Cambiar' }).click()
    await page.locator('input[type="file"]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.concat([PNG_1PX, Buffer.from('v2')]) })
    await saveProductAndClose(page)

    expect(await imageUrl()).toContain(`/${BUCKET}/${ruta()}`)
    const despues = (await owner.c.storage.from(BUCKET).list(owner.sede, { search: `${productoId}.png` })).data?.[0]?.updated_at
    expect(despues, 'el archivo no se reemplazó').not.toBe(antes)
  })

  test('quitar y CANCELAR: la foto y el archivo siguen (nada se borra antes de guardar)', async ({ page }) => {
    const antes = await imageUrl()
    expect(antes, 'precondición: el producto tiene foto').not.toBeNull()
    await loginAsOwner(page)
    await editar(page)
    await page.getByTitle('Eliminar imagen').click()
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(page.getByPlaceholder('Ej: Mojito Cubano')).toHaveCount(0)

    expect(await imageUrl()).toBe(antes)
    expect(await existe(owner.c, BUCKET, ruta()), 'cancelar borró el archivo de Storage').toBe(true)
  })

  test('quitar: el producto queda sin foto Y el archivo se borra de verdad', async ({ page }) => {
    // El borrado en Storage se DEMORA 1,5 s y se guarda enseguida. Con el borrado
    // hecho al tocar "Eliminar" (antes del arreglo), el guardado caía SIEMPRE en
    // medio y guardaba la URL vieja apuntando a un archivo borrado; en la suite
    // pasaba solo a veces (fue un rojo intermitente el 2026-10-04).
    await page.route('**/storage/v1/object/product-images', async (r) => {
      if (r.request().method() === 'DELETE') await new Promise((ok) => setTimeout(ok, 1500))
      await r.continue()
    })
    await loginAsOwner(page)
    await editar(page)
    await page.getByTitle('Eliminar imagen').click()
    await saveProductAndClose(page)

    expect(await imageUrl()).toBeNull()
    // deleteProductImage se traga el error: sin esta línea, un borrado rechazado
    // por la RLS pasaría en silencio y dejaría el archivo huérfano.
    expect(await existe(owner.c, BUCKET, ruta()), 'el archivo quedó huérfano en Storage').toBe(false)
  })
})
