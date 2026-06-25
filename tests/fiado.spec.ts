import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner, loginAsCashier } from './helpers/auth'
import { openShiftIfClosed, closeShiftIfOpen } from './helpers/shift'

// Producto compuesto seeded (Lab Coctel = 18.000) que descuenta 1 "Lab Vaso"
// (insumo con tracking) por venta. Permite verificar que el fiado SÍ baja stock.
const PRODUCT = 'Lab Coctel'
const INSUMO = 'Lab Vaso'

const SUFFIX = Date.now().toString().slice(-6)
const CLIENTE = `E2E Fiado ${SUFFIX}`
const MESA = `Mesa Fiado ${SUFFIX}`

// "$ 18.000" → 18000
const parseCOP = (text: string): number => Number(text.replace(/[^\d]/g, ''))

// ── Helpers ───────────────────────────────────────────────────────

async function createCustomer(page: Page, name: string) {
  await page.goto('/fiado')
  await page.getByTestId('fiado-tab-customers').click()
  await page.getByTestId('new-customer-btn').click()
  await page.getByTestId('customer-name').fill(name)
  await page.getByTestId('customer-save').click()
  await expect(page.getByTestId('customer-form-modal')).toHaveCount(0)
  await expect(page.getByTestId('customer-row').filter({ hasText: name })).toBeVisible()
}

// Vende 1 PRODUCT a fiado al cliente dado. Devuelve el número de venta.
// Requiere turno abierto (la app exige turno para "Cobrar", aunque el fiado no
// toque caja). Maneja el ItemConfigModal del extra del compuesto.
async function sellOnFiado(page: Page, customer: string): Promise<number> {
  await page.goto('/ventas')
  await openShiftIfClosed(page, 0)

  await page.getByTestId('product-card').filter({ hasText: PRODUCT }).first().click()
  // Lab Coctel tiene un extra → confirma el modal de configuración sin extras.
  await expect(page.getByTestId('item-config-modal')).toBeVisible()
  await page.getByTestId('item-config-confirm').click()

  await page.getByRole('button', { name: 'Cobrar' }).click()
  await page.getByTestId('pay-method-fiado').click()
  await page.getByTestId('customer-search').fill(customer)
  await page.getByTestId('customer-option').filter({ hasText: customer }).first().click()
  await page.getByTestId('checkout-continue').click()

  const banner = page.getByText(/Venta #\d+ registrada/)
  await expect(banner).toBeVisible({ timeout: 15_000 })
  return Number((await banner.innerText()).match(/#(\d+)/)![1])
}

// Lee el stock de un insumo desde Inventario → Niveles.
async function readStock(page: Page, name: string): Promise<number> {
  await page.goto('/inventario')
  await page.getByTestId('inventory-tab-levels').click()
  await page.getByPlaceholder('Buscar insumo...').fill(name)
  const row = page.getByTestId('stock-level-row').filter({ hasText: name })
  await expect(row).toBeVisible()
  return Number(await row.getByTestId('stock-level-qty').innerText())
}

// Localiza la fila de deuda de una venta por su número.
function debtRow(page: Page, orderNumber: number) {
  return page.getByTestId('debt-row').filter({ hasText: `#${orderNumber}` })
}

// ── Suite ─────────────────────────────────────────────────────────

test.describe.serial('Fiado / Cuentas por cobrar', () => {
  test('setup: crear cliente', async ({ page }) => {
    await loginAsOwner(page)
    await createCustomer(page, CLIENTE)
  })

  test('vender a fiado: orden pending, sin pago, y el stock baja', async ({ page }) => {
    await loginAsOwner(page)

    const before = await readStock(page, INSUMO)

    const n = await sellOnFiado(page, CLIENTE)

    // La deuda aparece pendiente: saldo = total, abonado = 0 (no entró pago).
    await page.goto('/fiado')
    const row = debtRow(page, n)
    await expect(row).toBeVisible()
    await expect(row).toContainText('Pendiente')
    await expect(row).toContainText(CLIENTE)
    const saldo = parseCOP(await row.getByTestId('debt-row-saldo').innerText())
    expect(saldo).toBe(18000)

    // El stock del insumo bajó en 1 (la mercancía salió, aunque no se pagó).
    const after = await readStock(page, INSUMO)
    expect(after).toBe(before - 1)
  })

  test('abono parcial → estado parcial y saldo correcto', async ({ page }) => {
    await loginAsOwner(page)
    const n = await sellOnFiado(page, CLIENTE)

    await page.goto('/fiado')
    await debtRow(page, n).click()
    await expect(page.getByTestId('debt-payment-modal')).toBeVisible()

    // Abono por transferencia (aísla de la caja) de 8.000 sobre saldo 18.000.
    await page.getByTestId('debt-method').selectOption('transfer')
    await page.getByTestId('debt-amount').fill('8000')
    await page.getByTestId('debt-submit').click()

    await expect(page.getByText(/Abono registrado · saldo/)).toBeVisible()
    await expect(page.getByTestId('debt-payment-modal')).toHaveCount(0)

    // La deuda ahora es parcial con saldo 10.000.
    const row = debtRow(page, n)
    await expect(row).toContainText('Parcial')
    expect(parseCOP(await row.getByTestId('debt-row-saldo').innerText())).toBe(10000)
  })

  test('saldar la deuda → estado paid y sale de cuentas por cobrar', async ({ page }) => {
    await loginAsOwner(page)
    const n = await sellOnFiado(page, CLIENTE)

    await page.goto('/fiado')
    await debtRow(page, n).click()
    await expect(page.getByTestId('debt-payment-modal')).toBeVisible()

    // "Saldar" rellena el saldo completo → liquida la deuda.
    await page.getByTestId('debt-method').selectOption('transfer')
    await page.getByTestId('debt-amount-full').click()
    await page.getByTestId('debt-submit').click()

    await expect(page.getByText(/Deuda saldada/)).toBeVisible()

    // Ya no aparece en cuentas por cobrar (payment_status pasó a 'paid').
    await expect(debtRow(page, n)).toHaveCount(0)
  })

  test('abono en efectivo con turno abierto entra a caja como ingreso', async ({ page }) => {
    await loginAsOwner(page)
    const n = await sellOnFiado(page, CLIENTE)

    // Garantizar turno abierto para que el efectivo entre al cuadre.
    await page.goto('/ventas')
    await openShiftIfClosed(page, 100000)

    await page.goto('/fiado')
    await debtRow(page, n).click()
    await page.getByTestId('debt-method').selectOption('cash')
    await page.getByTestId('debt-amount').fill('5000')
    await page.getByTestId('debt-submit').click()

    // El abono entró a la caja (mensaje inequívoco).
    await expect(page.getByText(/Entró a caja|Ingreso de caja/)).toBeVisible()

    // El ingreso "Abono de <cliente>" aparece en los movimientos del turno.
    await page.goto('/ventas')
    await page.getByRole('button', { name: 'Movimientos' }).click()
    await expect(page.getByText(`Abono de ${CLIENTE}`).first()).toBeVisible()
  })

  test('abono que excede el saldo: bloqueado en la UI', async ({ page }) => {
    await loginAsOwner(page)
    const n = await sellOnFiado(page, CLIENTE)

    await page.goto('/fiado')
    await debtRow(page, n).click()
    await expect(page.getByTestId('debt-payment-modal')).toBeVisible()

    const saldo = parseCOP(await page.getByTestId('debt-saldo').innerText())
    await page.getByTestId('debt-amount').fill(String(saldo + 10000))

    // La UI muestra el error y deshabilita el botón (no se llega a la RPC).
    await expect(page.getByTestId('debt-amount-error')).toBeVisible()
    await expect(page.getByTestId('debt-submit')).toBeDisabled()
  })

  test('historial: la venta a fiado muestra "Fiado" como método', async ({ page }) => {
    await loginAsOwner(page)
    const n = await sellOnFiado(page, CLIENTE)

    await page.goto('/historial')
    const row = page.getByTestId('sale-row').filter({ hasText: `#${n}` })
    await expect(row).toBeVisible()
    await expect(row.getByTestId('sale-row-method')).toContainText('Fiado')
  })

  test('vender a fiado desde una MESA: pending, mesa liberada y SIN doble descuento de stock', async ({ page }) => {
    await loginAsOwner(page)

    // Cobrar una mesa exige turno abierto (aunque el fiado no toque caja).
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)

    // Stock del insumo ANTES de cualquier cosa.
    const before = await readStock(page, INSUMO)

    // Crear una mesa dedicada (evita colisión con mesas seeded ocupadas).
    await page.goto('/mesas')
    await page.getByRole('button', { name: 'Configurar' }).click()
    await page.getByPlaceholder('Mesa 1').fill(MESA)
    await page.getByRole('button', { name: 'Crear mesa' }).click()
    await expect(page.getByText(MESA)).toBeVisible()

    // Abrir la mesa.
    await page.goto('/mesas')
    await page.getByRole('button', { name: new RegExp(MESA) }).click()
    await page.getByRole('button', { name: 'Abrir mesa' }).click()

    // Agregar 1 Lab Coctel a la mesa → AQUÍ se descuenta el stock del insumo.
    await page.getByRole('button', { name: new RegExp(MESA) }).click()
    await page.getByRole('button', { name: 'Agregar ítems' }).click()
    await page.getByRole('button').filter({ has: page.getByText(PRODUCT, { exact: true }) }).first().click()
    await expect(page.getByTestId('item-config-modal')).toBeVisible()
    await page.getByTestId('item-config-confirm').click()
    await page.getByRole('button', { name: 'Agregar a la mesa' }).click()

    // CLAVE de sincronía: el picker se cierra SOLO tras commitear
    // addOrderItemsWithExtras (alta atómica + descuento de stock). Esperar ese
    // cierre y que el panel ya no diga "Sin ítems" evita que readStock navegue y
    // aborte la RPC en vuelo (si no, el ítem no se inserta y el stock no baja).
    await expect(page.getByRole('button', { name: 'Agregar a la mesa' })).toHaveCount(0)
    await expect(page.getByText('Sin ítems — agrega productos')).toHaveCount(0)

    // El stock bajó EXACTAMENTE 1 al agregar el ítem (etapa b).
    const afterAdd = await readStock(page, INSUMO)
    expect(afterAdd).toBe(before - 1)

    // Cerrar la mesa a FIADO.
    await page.goto('/mesas')
    await page.getByRole('button', { name: new RegExp(MESA) }).click()
    await page.getByRole('button', { name: 'Cobrar' }).click()
    await page.getByTestId('pay-method-fiado').click()
    await page.getByTestId('customer-search').fill(CLIENTE)
    await page.getByTestId('customer-option').filter({ hasText: CLIENTE }).first().click()
    await page.getByTestId('checkout-continue').click()
    const banner = page.getByText(/Venta #\d+ registrada/)
    await expect(banner).toBeVisible({ timeout: 15_000 })
    const n = Number((await banner.innerText()).match(/#(\d+)/)![1])

    // CLAVE — garantía anti doble-descuento: cerrar a fiado NO vuelve a tocar
    // stock. El stock sigue en (before - 1), NO en (before - 2).
    const afterClose = await readStock(page, INSUMO)
    expect(afterClose).toBe(afterAdd)
    expect(afterClose).toBe(before - 1)

    // La deuda quedó pendiente, ligada al cliente.
    await page.goto('/fiado')
    const row = debtRow(page, n)
    await expect(row).toBeVisible()
    await expect(row).toContainText(CLIENTE)

    // La mesa quedó LIBERADA: al hacer click pide abrir (mesa libre).
    await page.goto('/mesas')
    await page.getByRole('button', { name: new RegExp(MESA) }).click()
    await expect(page.getByRole('button', { name: 'Abrir mesa' })).toBeVisible()
  })

  test('gating: el cajero TAMBIÉN puede operar fiado (decisión de producto)', async ({ page }) => {
    await loginAsCashier(page)
    // El cajero ve la entrada de Fiado en el sidebar...
    await expect(page.getByRole('link', { name: 'Fiado' })).toBeVisible()
    // ...y el método "Fiado" aparece en el cobro del POS.
    await page.getByTestId('product-card').filter({ hasText: PRODUCT }).first().click()
    await expect(page.getByTestId('item-config-modal')).toBeVisible()
    await page.getByTestId('item-config-confirm').click()
    await openShiftIfClosed(page, 0)
    await page.getByRole('button', { name: 'Cobrar' }).click()
    await expect(page.getByTestId('pay-method-fiado')).toBeVisible()
    // Nota: el gating NEGATIVO (un rol sin fiado.gestionar) no es testeable con
    // los usuarios del lab (owner y cajero ambos lo tienen).
  })

  test('limpieza: cerrar turno y desactivar cliente', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await loginAsOwner(page)

    await page.goto('/ventas')
    await closeShiftIfOpen(page)

    await page.goto('/fiado')
    await page.getByTestId('fiado-tab-customers').click()
    await page.getByTestId('customer-row').filter({ hasText: CLIENTE }).getByTestId('customer-deactivate').click()
    await expect(page.getByTestId('customer-row').filter({ hasText: CLIENTE })).toHaveCount(0)

    // Borrado best-effort de la mesa creada (la orden a fiado quedó 'delivered'
    // y la mesa libre, así que no debería estar bloqueada). No se hard-assertea:
    // el borrado puede depender de residuos del estado compartido del lab.
    await page.goto('/mesas')
    await page.getByRole('button', { name: 'Configurar' }).click()
    const del = page.locator('div')
      .filter({ has: page.getByText(MESA, { exact: true }) })
      .filter({ has: page.getByTitle('Eliminar mesa') })
      .last()
      .getByTitle('Eliminar mesa')
    if (await del.count() > 0) await del.click()
  })
})
