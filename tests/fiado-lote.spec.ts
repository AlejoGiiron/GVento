import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { openShiftIfClosed, closeShiftIfOpen } from './helpers/shift'

/**
 * Pago de VARIAS ventas a fiado con un solo monto, repartido FIFO.
 *
 * 🔴 ESTE SPEC ES EL ÚNICO MECANISMO QUE MANTIENE SINCRONIZADOS LOS DOS LADOS
 * DEL REPARTO (R1). El cálculo vive duplicado a propósito:
 *
 *    src/lib/splitFifo.ts                → la previsualización que ve el cajero
 *    supabase/fiado-abono-lote.sql       → lo que efectivamente se persiste
 *
 * Nada en el sistema los compara. Si divergen, el cajero confirma un reparto y
 * la base guarda otro: sin excepción, sin test unitario rojo, sin nada que
 * avise. El caso "lo previsualizado es lo que quedó en la BD" NO ES OPCIONAL —
 * si se borra, este contrato queda sin vigilancia.
 *
 * Los tests unitarios de splitFifo prueban el lado TS contra sí mismo; las
 * pruebas SQL del lote prueban el lado SQL contra sí mismo. Solo este spec
 * prueba que ambos dicen LO MISMO.
 */

const PRODUCT = 'Lab Coctel'
const SUFFIX = Date.now().toString().slice(-6)
const CLIENTE = `E2E Lote ${SUFFIX}`
const CLIENTE_B = `E2E LoteB ${SUFFIX}`

const parseCOP = (t: string): number => Number(t.replace(/[^\d]/g, ''))

async function createCustomer(page: Page, name: string) {
  await page.goto('/fiado')
  await page.getByTestId('fiado-tab-customers').click()
  await page.getByTestId('new-customer-btn').click()
  await page.getByTestId('customer-name').fill(name)
  await page.getByTestId('customer-save').click()
  await expect(page.getByTestId('customer-form-modal')).toHaveCount(0)
}

/** Vende 1 PRODUCT a fiado. Devuelve el número de venta. */
async function sellOnFiado(page: Page, customer: string): Promise<number> {
  await page.goto('/ventas')
  await openShiftIfClosed(page, 0)
  await page.getByTestId('product-card').filter({ hasText: PRODUCT }).first().click()
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

async function selectCustomer(page: Page, name: string) {
  await page.goto('/fiado')
  await page.getByTestId('customer-row').filter({ hasText: name }).click()
  await expect(page.getByTestId('customer-detail')).toBeVisible()
}

const creditRow = (page: Page, n: number) =>
  page.getByTestId('credit-row').filter({ has: page.getByText(`#${n}`, { exact: true }) })

/** Marca el checkbox de una venta dentro del detalle. */
async function check(page: Page, n: number) {
  await creditRow(page, n).getByTestId('credit-check').check()
}

let n1 = 0   // la MÁS VIEJA
let n2 = 0
let n3 = 0   // la más nueva

test.describe.serial('Fiado — pago de varias ventas (lote FIFO)', () => {
  test('setup: cliente con 3 fiados de 18.000 cada uno', async ({ page }) => {
    await loginAsOwner(page)
    await createCustomer(page, CLIENTE)
    n1 = await sellOnFiado(page, CLIENTE)
    n2 = await sellOnFiado(page, CLIENTE)
    n3 = await sellOnFiado(page, CLIENTE)
    expect(n1).toBeLessThan(n2)
    expect(n2).toBeLessThan(n3)
  })

  test('la lista del detalle va de la MÁS VIEJA a la más nueva (el orden que se cobra)', async ({ page }) => {
    // Si la tabla mostrara otro orden, el cajero leería una previsualización que
    // no se corresponde con la lista que tiene delante. La RPC ordena por
    // created_at y la UI también: es lo que hace que lo previsualizado se
    // entienda.
    await loginAsOwner(page)
    await selectCustomer(page, CLIENTE)
    const numeros = await page.getByTestId('credit-row').allInnerTexts()
    const orden = numeros.map((t) => Number(t.match(/#(\d+)/)![1]))
    expect(orden).toEqual([...orden].sort((a, b) => a - b))
  })

  test('la barra de lote aparece solo con algo marcado, y suma los saldos', async ({ page }) => {
    await loginAsOwner(page)
    await selectCustomer(page, CLIENTE)

    // Contraste: sin selección NO hay barra. Sin este negativo, una barra
    // siempre visible pasaría el positivo de abajo.
    await expect(page.getByTestId('batch-bar')).toHaveCount(0)

    await check(page, n1)
    await check(page, n2)
    await expect(page.getByTestId('batch-bar')).toBeVisible()
    await expect(page.getByTestId('abonar-seleccionados')).toContainText('(2)')
    expect(parseCOP(await page.getByTestId('batch-bar-saldo').innerText())).toBe(36_000)
  })

  test('sobrepago: la UI lo bloquea con el motivo a la vista', async ({ page }) => {
    await loginAsOwner(page)
    await selectCustomer(page, CLIENTE)
    await check(page, n1)
    await page.getByTestId('abonar-seleccionados').click()
    await expect(page.getByTestId('batch-payment-modal')).toBeVisible()

    // 18.000 de saldo, se intentan 25.000.
    await page.getByTestId('batch-amount').fill('25000')
    await expect(page.getByTestId('batch-excede')).toBeVisible()
    await expect(page.getByTestId('batch-excede')).toContainText('no da vuelto')
    await expect(page.getByTestId('batch-confirm')).toBeDisabled()

    // Contraste: con el monto exacto se habilita. Sin esto, un botón siempre
    // deshabilitado pasaría la aserción de arriba.
    await page.getByTestId('batch-amount').fill('18000')
    await expect(page.getByTestId('batch-excede')).toHaveCount(0)
    await expect(page.getByTestId('batch-confirm')).toBeEnabled()
  })

  test('🔴 CONTRATO: lo que muestra la PREVISUALIZACIÓN es lo que queda en la BD', async ({ page }) => {
    // ── El caso que no se puede borrar. Lee el reparto de la pantalla ANTES de
    // confirmar, y después verifica fila por fila contra el detalle, que sale de
    // la base. Si splitFifo (TS) y el loop de la RPC (SQL) divergen, acá se ve.
    await loginAsOwner(page)
    await selectCustomer(page, CLIENTE)
    await check(page, n1)
    await check(page, n2)
    await check(page, n3)
    await page.getByTestId('abonar-seleccionados').click()

    // 45.000 sobre 3 deudas de 18.000: salda las dos primeras y deja la tercera
    // con 9.000 abonados y 9.000 pendientes.
    await page.getByTestId('batch-amount').fill('45000')
    await page.getByTestId('batch-method-transfer').click()   // aísla de caja

    const filas = page.getByTestId('batch-preview-row')
    await expect(filas).toHaveCount(3)

    // Fotografía de lo que el cajero está por confirmar.
    const previsualizado = await filas.allInnerTexts()
    const esperado = previsualizado.map((t) => ({
      numero: Number(t.match(/#(\d+)/)![1]),
      saldada: t.includes('saldado'),
      quedan: t.includes('quedan') ? parseCOP(t.split('quedan')[1]) : 0,
    }))

    // La previsualización tiene que respetar FIFO por sí misma.
    expect(esperado.map((e) => e.numero)).toEqual([n1, n2, n3])
    expect(esperado[0].saldada).toBe(true)
    expect(esperado[1].saldada).toBe(true)
    expect(esperado[2].saldada).toBe(false)
    expect(esperado[2].quedan).toBe(9_000)

    await page.getByTestId('batch-confirm').click()
    await expect(page.getByTestId('batch-payment-modal')).toHaveCount(0)

    // ── LA COMPARACIÓN. El detalle se relee de la BD.
    await selectCustomer(page, CLIENTE)
    for (const e of esperado) {
      if (e.saldada) {
        // Saldada ⇒ sale de Cartera (getDebts solo trae pending/partial).
        await expect(creditRow(page, e.numero)).toHaveCount(0)
      } else {
        const saldoEnBD = parseCOP(
          await creditRow(page, e.numero).getByTestId('credit-row-saldo').innerText(),
        )
        expect(saldoEnBD).toBe(e.quedan)
      }
    }

    // Y el total del cliente es el único saldo que sobrevive.
    expect(parseCOP(await page.getByTestId('detail-total').innerText())).toBe(9_000)
  })

  test('cambiar de cliente LIMPIA la selección', async ({ page }) => {
    // Es la guarda de la UI contra armar un lote de dos clientes: la RPC lo
    // rechaza entero ("no son del mismo cliente"), y el cajero no entendería
    // por qué si los checkboxes hubieran quedado marcados de antes.
    await loginAsOwner(page)
    await createCustomer(page, CLIENTE_B)
    await sellOnFiado(page, CLIENTE_B)

    await selectCustomer(page, CLIENTE)
    await check(page, n3)
    await expect(page.getByTestId('batch-bar')).toBeVisible()

    await selectCustomer(page, CLIENTE_B)
    await expect(page.getByTestId('batch-bar')).toHaveCount(0)

    // Y al volver, tampoco quedó nada marcado.
    await selectCustomer(page, CLIENTE)
    await expect(page.getByTestId('batch-bar')).toHaveCount(0)
  })

  test('en efectivo con turno abierto: UN solo ingreso de caja por el total', async ({ page }) => {
    // El punto del diseño: el cajero recibió UN billete, así que la caja tiene
    // que mostrar UNA entrada. Con un movimiento por orden la suma daría igual
    // pero la lista mentiría sobre lo que pasó en el mostrador.
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 100000)

    await selectCustomer(page, CLIENTE)
    await page.getByTestId('credit-check-all').check()
    const saldo = parseCOP(await page.getByTestId('batch-bar-saldo').innerText())
    await page.getByTestId('abonar-seleccionados').click()
    await page.getByTestId('batch-amount').fill(String(saldo))
    await page.getByTestId('batch-method-cash').click()
    await page.getByTestId('batch-confirm').click()
    await expect(page.getByTestId('batch-payment-modal')).toHaveCount(0)
    await expect(page.getByText(/Entró a caja/)).toBeVisible()

    // UNA sola línea en los movimientos del turno, por el total del lote.
    await page.goto('/ventas')
    await page.getByRole('button', { name: 'Movimientos' }).click()
    await expect(page.getByText(`Abono de ${CLIENTE}`, { exact: false })).toHaveCount(1)
  })

  test('limpieza: saldar lo que quede y cerrar turno', async ({ page }) => {
    await loginAsOwner(page)
    for (const cliente of [CLIENTE, CLIENTE_B]) {
      await page.goto('/fiado')
      const fila = page.getByTestId('customer-row').filter({ hasText: cliente })
      if ((await fila.count()) === 0) continue
      await fila.click()
      await expect(page.getByTestId('customer-detail')).toBeVisible()
      if ((await page.getByTestId('credit-row').count()) === 0) continue
      await page.getByTestId('credit-check-all').check()
      await page.getByTestId('abonar-seleccionados').click()
      const saldo = parseCOP(await page.getByTestId('batch-saldo-total').innerText())
      await page.getByTestId('batch-amount').fill(String(saldo))
      await page.getByTestId('batch-method-transfer').click()
      await page.getByTestId('batch-confirm').click()
      await expect(page.getByTestId('batch-payment-modal')).toHaveCount(0)
    }
    await page.goto('/ventas')
    await closeShiftIfOpen(page)
  })
})
