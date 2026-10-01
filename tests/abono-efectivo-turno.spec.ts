import { test, expect, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loginAsOwner, ownerCreds } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'

// ============================================================================
// La UI de abono avisa ANTES de recibir efectivo sin turno abierto
// (AvisoEfectivoRequiereTurno en DebtPaymentModal y BatchPaymentModal).
//
// Lo que custodia: el cajero se entera en el modal — antes de agarrar la plata —
// y no con un error después de confirmar. Con efectivo y sin turno: aviso
// visible + confirmar deshabilitado + botón para abrir el turno ahí mismo. Con
// otro método: sin aviso y confirmable. La barrera real es el servidor
// (supabase/cobro-turno.sql, ver cobro-concurrente.spec.ts); esto es la UX.
//
// Fixtures por API (cliente + fiado numerado): el spec mide el modal, no la
// venta a fiado, que ya cubre fiado.spec.ts.
// ============================================================================

let owner: SupabaseClient
let OWNER_ID = ''
let SEDE = ''
const SUFFIX = Date.now().toString().slice(-6)
const CLIENTE = `E2E Aviso Turno ${SUFFIX}`
let CLIENTE_ID = ''
const ordenes: string[] = []

test.beforeAll(async () => {
  const o = await cliente(ownerCreds())
  owner = o.c; OWNER_ID = o.uid; SEDE = o.sede
  CLIENTE_ID = (await owner.from('customers').insert({ restaurant_id: SEDE, name: CLIENTE }).select('id').single()).data!.id as string
})

test.afterAll(async () => {
  const ids = ordenes.map((id) => `'${id}'`).join(',')
  psql(`begin;
    ${ids ? `delete from public.orders where id in (${ids});` : ''}
    delete from public.customers where id = '${CLIENTE_ID}';
    commit;`)
  expect(psql(`select count(*) from public.customers where id = '${CLIENTE_ID}';`), 'cliente residual del spec').toBe('0')
})

async function fiadoNumerado(total: number): Promise<number> {
  const { data, error } = await owner.from('orders').insert({
    restaurant_id: SEDE, type: 'takeaway', status: 'delivered', created_by: OWNER_ID,
    total, payment_status: 'pending', customer_id: CLIENTE_ID, customer_name: CLIENTE,
  }).select('id').single()
  if (error) throw error
  ordenes.push(data.id as string)
  const n = await owner.rpc('next_order_number', { p_restaurant_id: SEDE })
  if (n.error) throw n.error
  const up = await owner.from('orders').update({ order_number: n.data }).eq('id', data.id)
  if (up.error) throw up.error
  return n.data as number
}

async function sinTurno(): Promise<void> {
  const abierto = (await owner.from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (abierto) {
    const { error } = await owner.rpc('close_cash_shift', { p_shift_id: abierto.id, p_declarado: { cash: 0 } })
    if (error) throw new Error(`cerrar turno: ${error.message}`)
  }
}

async function abrirCartera(page: Page) {
  await loginAsOwner(page)
  await page.goto('/fiado')
  await page.getByTestId('customer-row').filter({ hasText: CLIENTE }).click()
  await expect(page.getByTestId('customer-detail')).toBeVisible()
}

const aviso = (page: Page) => page.getByTestId('efectivo-turno')

// No serial: cada test arma su estado (sinTurno) y un fallo no debe saltear al otro.
test.describe('Aviso de efectivo sin turno en los modales de abono', () => {
  test('abono simple: efectivo sin turno → aviso y bloqueado; transferencia → confirmable; "Abrir turno" lo destraba', async ({ page }) => {
    await sinTurno()
    const n = await fiadoNumerado(9000)
    await abrirCartera(page)
    await page.getByTestId('credit-row').filter({ has: page.getByText(`#${n}`, { exact: true }) })
      .getByTestId('abonar-btn').click()
    await expect(page.getByTestId('debt-payment-modal')).toBeVisible()

    // El monto es válido: lo único que puede bloquear es el turno.
    await page.getByTestId('debt-amount').fill('4000')
    await page.getByTestId('debt-method').selectOption('cash')
    await expect(aviso(page)).toHaveAttribute('data-estado', 'sin-turno')
    await expect(aviso(page)).toBeVisible()
    await expect(page.getByTestId('debt-submit')).toBeDisabled()

    // Contraste: mismo monto, otro método → sin aviso, confirmable.
    await page.getByTestId('debt-method').selectOption('transfer')
    await expect(aviso(page)).toHaveAttribute('data-estado', 'no-aplica')
    await expect(aviso(page)).toBeHidden()
    await expect(page.getByTestId('debt-submit')).toBeEnabled()

    // Vuelta a efectivo y apertura desde el aviso, sin salir del modal.
    await page.getByTestId('debt-method').selectOption('cash')
    await expect(page.getByTestId('debt-submit')).toBeDisabled()
    await page.getByTestId('efectivo-abrir-turno').click()
    await expect(page.getByRole('heading', { name: 'Abrir turno de caja' })).toBeVisible()
    await page.getByTestId('open-shift-amount').fill('0')
    await page.getByRole('button', { name: /Abrir turno de caja/ }).click()
    await expect(page.getByRole('heading', { name: 'Abrir turno de caja' })).toHaveCount(0)

    await expect(aviso(page)).toHaveAttribute('data-estado', 'ok')
    await expect(page.getByTestId('debt-submit')).toBeEnabled()
    await page.getByTestId('debt-submit').click()
    await expect(page.getByText(/Entró a caja/)).toBeVisible()
    expect(psql(`select count(*) from public.cash_movements m join public.cash_shifts s on s.id = m.shift_id
                  where s.restaurant_id = '${SEDE}' and s.closed_at is null and m.type = 'in' and m.amount = 4000;`)).toBe('1')
  })

  test('abono en lote: efectivo sin turno → aviso y bloqueado; transferencia → confirmable', async ({ page }) => {
    await sinTurno()
    await fiadoNumerado(6000)
    await abrirCartera(page)
    await page.getByTestId('credit-check-all').check()
    await page.getByTestId('abonar-seleccionados').click()
    await expect(page.getByTestId('batch-payment-modal')).toBeVisible()

    await page.getByTestId('batch-amount').fill('3000')
    await page.getByTestId('batch-method-cash').click()
    await expect(aviso(page)).toHaveAttribute('data-estado', 'sin-turno')
    await expect(page.getByTestId('efectivo-abrir-turno')).toBeVisible()
    await expect(page.getByTestId('batch-confirm')).toBeDisabled()

    await page.getByTestId('batch-method-transfer').click()
    await expect(aviso(page)).toBeHidden()
    await expect(page.getByTestId('batch-confirm')).toBeEnabled()
  })

  test('el turno se cierra en OTRA terminal con el modal abierto → el rechazo del servidor se ve con SU mensaje', async ({ page }) => {
    // El aviso lee el turno de la caché (useCashShift): si otra terminal cierra
    // mientras este modal está abierto, el botón sigue habilitado (medido: 3 s
    // después, data-estado="ok"). Ahí la barrera es el servidor, y lo que
    // importa es que el cajero lea POR QUÉ. Antes de src/lib/errorMessage.ts el
    // PostgrestError (no es instanceof Error) se mostraba como el genérico.
    const { data: abierto } = await owner.from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()
    if (!abierto) {
      const { error } = await owner.from('cash_shifts').insert({ restaurant_id: SEDE, opened_by: OWNER_ID, opening_amount: 0 })
      if (error) throw error
    }
    const n = await fiadoNumerado(9000)
    await abrirCartera(page)
    await page.getByTestId('credit-row').filter({ has: page.getByText(`#${n}`, { exact: true }) })
      .getByTestId('abonar-btn').click()
    await page.getByTestId('debt-amount').fill('4000')
    await page.getByTestId('debt-method').selectOption('cash')
    await expect(aviso(page)).toHaveAttribute('data-estado', 'ok')

    await sinTurno()   // "otra terminal"
    await page.getByTestId('debt-submit').click()

    await expect(page.getByText(/No hay un turno de caja abierto: para recibir efectivo/)).toBeVisible()
    await expect(page.getByText('Error al registrar el abono', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId('debt-payment-modal')).toBeVisible()   // no se cierra como si hubiera pasado
  })
})
