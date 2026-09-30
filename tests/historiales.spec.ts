import { test, expect } from '@playwright/test'
import { loginAsOwner, loginAsCashier, loginAsWaiter, hasWaiterCreds } from './helpers/auth'
import { openShiftIfClosed, closeShiftIfOpen } from './helpers/shift'

// Historial de turnos (cuadre persistido de F1) + historial de gastos (egresos).
// Selectores por TEXTO/testid, montos distintivos por corrida (no .first() ciego).

// Montos distintivos por corrida para localizar la fila sin ambigüedad.
const SUFFIX = Date.now().toString().slice(-6)
const OPENING = 130000 + (Date.now() % 9000)   // apertura única
const EGRESO = 12000 + (Date.now() % 3000)      // egreso único
const EXPECTED = OPENING - EGRESO               // sin ventas ni ingresos
const DECLARED = EXPECTED - 5000                // diferencia fija: −5000 → faltante
const REASON = `E2E gasto ${SUFFIX}`            // motivo custom distintivo
const COMENTARIO = `E2E cierre ${SUFFIX} — faltaron 5.000, los repone Ana`
const DECL_NEQUI = 7000 + (Date.now() % 900)    // declarado en Nequi, único

// Formato de miles es-CO ("134.567") — substring presente en la celda COP,
// evita el símbolo/espacio de la moneda.
const cop = (n: number) => new Intl.NumberFormat('es-CO').format(n)

// Registra un egreso conocido en el turno abierto. Usa "Otro" + motivo custom:
// SIEMPRE disponible (no depende de config.cash_out_reasons, que puede estar
// vacío) y así el motivo es distintivo y localizable.
async function registrarEgreso(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Movimientos' }).click()
  await expect(page.getByText('Movimientos manuales', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Egreso', exact: true }).click()
  await page.getByTestId('movement-reason-out').selectOption({ label: 'Otro' })
  await page.getByTestId('movement-reason-custom').fill(REASON)
  await page.getByTestId('movement-amount').fill(String(EGRESO))
  await page.getByTestId('movement-submit').click()
  await expect(page.getByText(REASON)).toBeVisible()
  await page.getByTestId('movements-close').click()
}

test.describe.serial('Historiales de turnos y gastos', () => {
  test('turno cerrado aparece en el historial con su cuadre (diferencia faltante)', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')

    // Estado limpio → abrir con apertura conocida → egreso conocido → cerrar
    // declarando por debajo del esperado (diferencia = −5000 faltante).
    await closeShiftIfOpen(page)
    await openShiftIfClosed(page, OPENING)
    await registrarEgreso(page)

    await page.getByRole('button', { name: 'Cerrar turno', exact: true }).click()
    await expect(page.getByText('Cerrar turno de caja')).toBeVisible()
    await page.getByTestId('close-shift-declared').fill(String(DECLARED))
    // Declarado en un método NO-efectivo + comentario: es lo que el detalle
    // tiene que devolver después, y sin esto el turno no ejercería el arqueo
    // multi-método ni el comentario (las dos mitades del pedido del cliente).
    await page.getByTestId('pay-declared-nequi').fill(String(DECL_NEQUI))
    await page.getByTestId('close-shift-comment').fill(COMENTARIO)
    await page.getByRole('button', { name: 'Confirmar cierre' }).click()
    await expect(page.getByText('Sin turno')).toBeVisible({ timeout: 15_000 })

    // Historial de turnos: la fila del turno recién cerrado (localizada por su
    // apertura única) muestra el cuadre PERSISTIDO.
    await page.goto('/historial-turnos')
    // Se filtra por la CELDA de apertura (`shift-opening`), no por el texto de
    // la fila entera: el textContent de la fila concatena los <span> SIN
    // separador, así que un `hasText` suelto puede matchear a caballo de dos
    // celdas. Misma clase de defecto que la colisión #14/#141 de
    // anular-venta.spec.ts — acá no había estallado porque los montos son
    // aleatorios y no un correlativo que crece.
    const row = page.getByTestId('shift-history-row')
      .filter({ has: page.getByTestId('shift-opening').filter({ hasText: cop(OPENING) }) })
      .first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.getByTestId('shift-declared')).toContainText(cop(DECLARED))
    await expect(row.getByTestId('shift-expected')).toContainText(cop(EXPECTED))
    await expect(row.getByTestId('shift-diff')).toContainText('faltante')
  })

  test('el detalle del turno muestra el arqueo y el comentario, sin reimprimir', async ({ page }) => {
    // EL PEDIDO DEL CLIENTE: ver todo el arqueo y el comentario en pantalla. Se
    // afirma contra lo que se DECLARÓ en el test anterior, no contra lo que la
    // modal calcule: si la pantalla derivara distinto que el comprobante, acá
    // se ve.
    await loginAsOwner(page)
    await page.goto('/historial-turnos')

    const row = page.getByTestId('shift-history-row')
      .filter({ has: page.getByTestId('shift-opening').filter({ hasText: cop(OPENING) }) })
      .first()
    await expect(row).toBeVisible({ timeout: 15_000 })

    // "Ver detalle" está SIEMPRE habilitado — es la diferencia con reimprimir.
    const verDetalle = row.getByTestId('shift-detail-btn')
    await expect(verDetalle).toBeEnabled()
    await verDetalle.click()

    const modal = page.getByTestId('shift-detail-modal')
    await expect(modal).toBeVisible()

    // Apertura, cuadre de efectivo y diferencia: lo declarado, no otra cosa.
    await expect(modal.getByTestId('detail-opening')).toContainText(cop(OPENING))
    await expect(modal.getByTestId('detail-expected')).toContainText(cop(EXPECTED))
    await expect(modal.getByTestId('detail-declared')).toContainText(cop(DECLARED))
    await expect(modal.getByTestId('detail-difference')).toContainText(cop(5000))

    // El egreso del turno, releído por shift_id.
    await expect(modal.getByTestId('detail-mov-out')).toContainText(cop(EGRESO))

    // El arqueo por método trae lo declarado en Nequi.
    await expect(modal.getByTestId('detail-arqueo-nequi')).toContainText(cop(DECL_NEQUI))

    // Y el comentario, que era la otra mitad del pedido.
    await expect(modal.getByTestId('detail-comment')).toContainText(COMENTARIO)

    // Con snapshot, reimprimir se ofrece habilitado DENTRO de la modal.
    await expect(modal.getByTestId('shift-reprint')).toBeEnabled()

    // Contraste: este turno SÍ tiene arqueo, así que el aviso NO aparece. Sin
    // este negativo, un aviso que se mostrara siempre pasaría desapercibido.
    await expect(modal.getByTestId('detail-sin-arqueo')).toHaveCount(0)
  })

  test('el egreso aparece en el historial de gastos y suma al total', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/historial-gastos')

    const row = page.getByTestId('expense-row').filter({ hasText: REASON })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.getByTestId('expense-reason')).toHaveText(REASON)
    await expect(row.getByTestId('expense-amount')).toContainText(cop(EGRESO))

    // El total del período INCLUYE el egreso. Primero la señal POSITIVA de que
    // cargó (aria-busy=false): antes esto era `not.toHaveText(/^\$?\s*0$/)`,
    // una ausencia que se cumple con CUALQUIER texto distinto de "$0" —incluido
    // el "…" de carga—. Después, el valor: al menos el egreso de este spec.
    const total = page.getByTestId('expenses-total')
    await expect(total).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 })
    const monto = Number((await total.innerText()).replace(/[^\d]/g, ''))
    expect(monto).toBeGreaterThanOrEqual(EGRESO)
  })

  test('gating positivo: el cajero ve Turnos y Gastos', async ({ page }) => {
    await loginAsCashier(page)
    await page.goto('/ventas')

    // Nav visible (el cajero tiene caja.cerrar + caja.movimientos).
    await expect(page.getByRole('link', { name: 'Turnos' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Gastos' })).toBeVisible()

    // Las páginas cargan (no redirige por permiso).
    await page.goto('/historial-turnos')
    await expect(page.getByText('Historial de turnos')).toBeVisible()
    await page.goto('/historial-gastos')
    await expect(page.getByText('Historial de gastos')).toBeVisible()
  })

  test('gating negativo: el mozo NO ve Turnos ni Gastos', async ({ page }) => {
    test.skip(!hasWaiterCreds(), 'Requiere mozo.test (lo siembra pnpm e2e:preparar; E2E_WAITER_* en scripts/capturas/local.config)')
    await loginAsWaiter(page)
    await page.goto('/ventas')

    // Señal POSITIVA de "permisos cargados": un enlace CON permiso que este rol
    // SÍ tiene (Cocina, cocina.acceder; Lab Norte usa cocina). Mientras el rol carga, can() da false y TODO enlace con
    // permiso está ausente — las ausencias de abajo pasaban por la carga. Ventas y
    // Mesas no sirven de señal: no tienen permiso, se ven siempre (R3, 2026-09-30).
    await expect(page.getByRole('link', { name: 'Cocina' })).toBeVisible({ timeout: 15_000 })
    // El mozo no tiene caja.* → nav oculto.
    await expect(page.getByRole('link', { name: 'Turnos' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Gastos' })).toHaveCount(0)

    // Navegar por URL redirige (ProtectedRoute por permiso).
    await page.goto('/historial-turnos')
    await expect(page).toHaveURL(/\/ventas/, { timeout: 15_000 })
  })
})
