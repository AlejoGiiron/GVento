import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner, loginAsCashier } from './helpers/auth'
import { openShiftIfClosed, closeShiftIfOpen } from './helpers/shift'

// Producto compuesto seeded (Lab Coctel = 18.000) que descuenta 1 "Lab Vaso"
// (insumo con tracking) por venta. Permite verificar que el fiado SÍ baja stock.
const PRODUCT = 'Lab Coctel'
const INSUMO = 'Lab Vaso'

const SUFFIX = Date.now().toString().slice(-6)
const CLIENTE = `E2E Fiado ${SUFFIX}`
const CLIENTE_G = `E2E Grupo ${SUFFIX}`
const MESA = `Mesa Fiado ${SUFFIX}`

// Órdenes del cliente-grupo (compartidas entre los tests de agrupación).
let gN1 = 0
let gN2 = 0

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

// ── Helpers del maestro-detalle de Cartera ────────────────────────

// Selecciona un cliente en la lista de Cartera (panel izquierdo).
async function selectCustomer(page: Page, name: string) {
  await page.getByTestId('customer-row').filter({ hasText: name }).click()
  await expect(page.getByTestId('customer-detail')).toBeVisible()
}

// Fila de un fiado individual dentro del detalle, por número de venta. Ancla al
// texto EXACTO de la celda "#N" (evita que "#1" matchee "#10").
function creditRow(page: Page, orderNumber: number) {
  return page.getByTestId('credit-row').filter({ has: page.getByText(`#${orderNumber}`, { exact: true }) })
}

// Abre el modal de abono de un fiado (el cliente ya debe estar seleccionado).
async function openAbono(page: Page, orderNumber: number) {
  await creditRow(page, orderNumber).getByTestId('abonar-btn').click()
  await expect(page.getByTestId('debt-payment-modal')).toBeVisible()
}

// Salda por completo un fiado del cliente (por transferencia, aísla de caja).
async function saldarFiado(page: Page, customer: string, orderNumber: number) {
  await selectCustomer(page, customer)
  await openAbono(page, orderNumber)
  await page.getByTestId('debt-method').selectOption('transfer')
  await page.getByTestId('debt-amount-full').click()
  await page.getByTestId('debt-submit').click()
  await expect(page.getByTestId('debt-payment-modal')).toHaveCount(0)
}

// Lee los 3 KPIs de la cabecera de Cartera.
async function readKpis(page: Page) {
  return {
    porCobrar: parseCOP(await page.getByTestId('kpi-por-cobrar-value').innerText()),
    clientes: Number(await page.getByTestId('kpi-clientes-deuda-value').innerText()),
    fiados: Number(await page.getByTestId('kpi-fiados-abiertos-value').innerText()),
  }
}

// ── Suite ─────────────────────────────────────────────────────────

test.describe.serial('Fiado / Cartera', () => {
  test('setup: crear cliente', async ({ page }) => {
    await loginAsOwner(page)
    await createCustomer(page, CLIENTE)
  })

  test('vender a fiado: orden pending, sin pago, y el stock baja', async ({ page }) => {
    await loginAsOwner(page)

    const before = await readStock(page, INSUMO)

    const n = await sellOnFiado(page, CLIENTE)

    // La deuda aparece en el detalle del cliente: saldo = total, pagado = 0.
    await page.goto('/fiado')
    await selectCustomer(page, CLIENTE)
    const row = creditRow(page, n)
    await expect(row).toBeVisible()
    await expect(row).toContainText('Pendiente')
    const saldo = parseCOP(await row.getByTestId('credit-row-saldo').innerText())
    expect(saldo).toBe(18000)

    // El stock del insumo bajó en 1 (la mercancía salió, aunque no se pagó).
    const after = await readStock(page, INSUMO)
    expect(after).toBe(before - 1)
  })

  test('abono parcial → estado parcial y saldo correcto', async ({ page }) => {
    await loginAsOwner(page)
    const n = await sellOnFiado(page, CLIENTE)

    await page.goto('/fiado')
    await selectCustomer(page, CLIENTE)
    await openAbono(page, n)

    // Abono por transferencia (aísla de la caja) de 8.000 sobre saldo 18.000.
    await page.getByTestId('debt-method').selectOption('transfer')
    await page.getByTestId('debt-amount').fill('8000')
    await page.getByTestId('debt-submit').click()

    await expect(page.getByText(/Abono registrado · saldo/)).toBeVisible()
    await expect(page.getByTestId('debt-payment-modal')).toHaveCount(0)

    // La deuda ahora es parcial con saldo 10.000 (el detalle se refresca solo).
    const row = creditRow(page, n)
    await expect(row).toContainText('Parcial')
    expect(parseCOP(await row.getByTestId('credit-row-saldo').innerText())).toBe(10000)
  })

  test('saldar la deuda → el fiado sale del detalle (payment_status paid)', async ({ page }) => {
    await loginAsOwner(page)
    const n = await sellOnFiado(page, CLIENTE)

    await page.goto('/fiado')
    await selectCustomer(page, CLIENTE)
    await openAbono(page, n)

    // "Saldar" rellena el saldo completo → liquida la deuda.
    await page.getByTestId('debt-method').selectOption('transfer')
    await page.getByTestId('debt-amount-full').click()
    await page.getByTestId('debt-submit').click()

    await expect(page.getByText(/Deuda saldada/)).toBeVisible()

    // Ese fiado ya no aparece en el detalle (el cliente sigue con otras deudas
    // de tests previos, así que no desaparece de la lista — eso se prueba aparte).
    await expect(creditRow(page, n)).toHaveCount(0)
  })

  test('abono en efectivo con turno abierto entra a caja como ingreso', async ({ page }) => {
    await loginAsOwner(page)
    const n = await sellOnFiado(page, CLIENTE)

    // Garantizar turno abierto para que el efectivo entre al cuadre.
    await page.goto('/ventas')
    await openShiftIfClosed(page, 100000)

    await page.goto('/fiado')
    await selectCustomer(page, CLIENTE)
    await openAbono(page, n)
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
    await selectCustomer(page, CLIENTE)
    await openAbono(page, n)

    const saldo = parseCOP(await page.getByTestId('debt-saldo').innerText())
    await page.getByTestId('debt-amount').fill(String(saldo + 10000))

    // La UI muestra el error y deshabilita el botón (no se llega a la RPC).
    await expect(page.getByTestId('debt-amount-error')).toBeVisible()
    await expect(page.getByTestId('debt-submit')).toBeDisabled()
  })

  // ── Agrupación por cliente + KPIs (rediseño maestro-detalle) ─────

  test('agrupación + KPIs: 2 fiados de un cliente = 1 fila con saldo sumado', async ({ page }) => {
    await loginAsOwner(page)
    await createCustomer(page, CLIENTE_G)

    // Baseline de KPIs ANTES de crear las deudas de este cliente nuevo.
    await page.goto('/fiado')
    const base = await readKpis(page)

    gN1 = await sellOnFiado(page, CLIENTE_G)
    gN2 = await sellOnFiado(page, CLIENTE_G)

    await page.goto('/fiado')

    // El cliente aparece UNA sola vez en la lista, con el saldo CONSOLIDADO
    // (2 × 18.000 = 36.000) — la agrupación por customer_id es de presentación.
    const rowLoc = page.getByTestId('customer-row').filter({ hasText: CLIENTE_G })
    await expect(rowLoc).toHaveCount(1)
    expect(parseCOP(await rowLoc.getByTestId('customer-row-saldo').innerText())).toBe(36000)

    // KPIs subieron exactamente: +1 cliente con deuda, +2 fiados, +36.000.
    const after = await readKpis(page)
    expect(after.clientes).toBe(base.clientes + 1)
    expect(after.fiados).toBe(base.fiados + 2)
    expect(after.porCobrar).toBe(base.porCobrar + 36000)

    // Seleccionar el cliente muestra SUS 2 fiados individuales y el total.
    await selectCustomer(page, CLIENTE_G)
    await expect(creditRow(page, gN1)).toBeVisible()
    await expect(creditRow(page, gN2)).toBeVisible()
    expect(parseCOP(await page.getByTestId('detail-total').innerText())).toBe(36000)
  })

  test('abono parcial mantiene al cliente; saldar el último lo saca (KPIs bajan)', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/fiado')
    const base = await readKpis(page)   // con CLIENTE_G presente (2 fiados, 36.000)

    // (1) Abono PARCIAL sobre gN1 (transfer 8.000 sobre 18.000).
    await selectCustomer(page, CLIENTE_G)
    await openAbono(page, gN1)
    await page.getByTestId('debt-method').selectOption('transfer')
    await page.getByTestId('debt-amount').fill('8000')
    await page.getByTestId('debt-submit').click()
    await expect(page.getByText(/Abono registrado · saldo/)).toBeVisible()

    // El fiado bajó a 10.000 y el consolidado del cliente a 28.000; SIGUE en lista.
    // Aserciones con auto-retry: esperan a que el refetch de ['debts'] aterrice.
    await selectCustomer(page, CLIENTE_G)
    await expect(creditRow(page, gN1).getByTestId('credit-row-saldo')).toContainText('10.000')
    const rowLoc = page.getByTestId('customer-row').filter({ hasText: CLIENTE_G })
    await expect(rowLoc).toHaveCount(1)
    await expect(rowLoc.getByTestId('customer-row-saldo')).toContainText('28.000')

    // (2) Saldar AMBOS fiados → el cliente deja de deber.
    await saldarFiado(page, CLIENTE_G, gN1)   // resto 10.000
    await saldarFiado(page, CLIENTE_G, gN2)   // 18.000

    // Desaparece de la lista y el detalle se limpia; KPIs bajan −1 cliente / −2 fiados.
    await expect(page.getByTestId('customer-row').filter({ hasText: CLIENTE_G })).toHaveCount(0)
    await expect(page.getByTestId('customer-detail')).toHaveCount(0)
    const after = await readKpis(page)
    expect(after.clientes).toBe(base.clientes - 1)
    expect(after.fiados).toBe(base.fiados - 2)
  })

  test('historial: la venta a fiado muestra "Fiado" como método', async ({ page }) => {
    await loginAsOwner(page)
    const n = await sellOnFiado(page, CLIENTE)

    await page.goto('/historial')
    // Ancla al NOMBRE ACCESIBLE (que sí inserta espacios entre elementos):
    // filtrar por texto "#N" era ambiguo porque el textContent concatena los
    // spans SIN espacio (la fila de la orden #1 => "#102/07…" contiene "#10").
    // El nombre accesible es "#10 02/07…", así que "^#10 " no matchea "#1 02/07…".
    const row = page.getByRole('button', { name: new RegExp(`^#${n}\\s`) })
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

    // La deuda quedó pendiente, ligada al cliente (visible en su detalle).
    await page.goto('/fiado')
    await selectCustomer(page, CLIENTE)
    await expect(creditRow(page, n)).toBeVisible()

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

  test('limpieza: cerrar turno y desactivar clientes', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await loginAsOwner(page)

    await page.goto('/ventas')
    await closeShiftIfOpen(page)

    await page.goto('/fiado')
    await page.getByTestId('fiado-tab-customers').click()
    for (const name of [CLIENTE, CLIENTE_G]) {
      const cust = page.getByTestId('customer-row').filter({ hasText: name })
      if (await cust.count() > 0) {
        await cust.getByTestId('customer-deactivate').click()
        await expect(page.getByTestId('customer-row').filter({ hasText: name })).toHaveCount(0)
      }
    }

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
