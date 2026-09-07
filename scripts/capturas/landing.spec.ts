import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { loginAsOwner } from '../../tests/helpers/auth'

/**
 * G-Vento — capturas de pantalla para la landing comercial.
 *
 * Genera las 5 PNG de ./capturas-landing/ a partir del escenario que monta
 * `pnpm capturas:preparar` en el Supabase LOCAL de Docker. Este archivo SOLO
 * navega y dispara capturas: no escribe en la base.
 *
 *   pnpm capturas:preparar     # una vez, o cada vez que quieras re-capturar
 *   pnpm capturas              # esto
 *
 * ── POR QUÉ NO SIEMBRA ──────────────────────────────────────────────────────
 * Dos datos del escenario (la hora de la segunda ronda y el abono de hace 11
 * días) no se pueden producir desde la UI: `created_at` lo pone la base. Sembrar
 * desde un spec exigiría privilegios de escritura directa, y mezclarlos con la
 * sesión que saca las fotos borronea quién puede tocar qué. Acá la sesión es la
 * de un usuario normal, acotada por RLS; el poder de escribir vive en el .sql y
 * en preparar-local.mjs, que se leen antes de correr.
 *
 * ── ORDEN DE LAS CAPTURAS (no es arbitrario) ────────────────────────────────
 * El modal de apertura de turno SOLO existe cuando no hay turno abierto, y
 * cobrar/cerrar exigen que sí lo haya. Así que la apertura se captura AL FINAL,
 * después de cerrar el turno de verdad. Consecuencia: cada corrida consume el
 * escenario. Volvé a aplicar landing-seed.sql antes de la siguiente — el guard
 * de abajo te lo dice si te olvidás, en vez de producir capturas vacías.
 */

const OUT = 'capturas-landing'

// El escenario que tiene que estar sembrado. Si algo de esto no aparece, no se
// captura nada: una captura con el número equivocado es peor que ninguna.
const SEDE = 'Bar La Ronda'
const CAJERA = 'Marcela'
const MESA = 'Mesa 7'
const CLIENTE = 'Wílmer Ospina'

const MESA_TOTAL = '157.000'
const EFECTIVO = '80000'
const TARJETA = '77000'
const DECLARADO_EFECTIVO = '962000'
const DECLARADO_TARJETA = '700000'
const DECLARADO_TRANSFER = '285000'
const DECLARADO_NEQUI = '100000'

/**
 * Deja la página lista para fotografiarse:
 *  - sin animaciones ni transiciones (una captura a mitad de un fade sale sucia)
 *  - sin banner de suscripción
 *  - sin caret ni anillo de foco (el spec pide "sin foco visible en ningún campo")
 * Se re-aplica después de cada navegación: addStyleTag muere con el documento.
 */
async function prepararUI(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      *:focus, *:focus-visible { outline: none !important; box-shadow: none !important; }
      [data-testid="subscription-banner"] { display: none !important; }
      /* react-hot-toast: un toast a medio salir arruina la toma */
      [class*="go2072408551"], [role="status"] { display: none !important; }
    `,
  })
}

/** Quita el foco del elemento activo — si no, el input queda con borde verde. */
async function desenfocar(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.mouse.move(0, 0)
}

/**
 * Captura con el deviceScaleFactor del contexto (scale: 'device' → 3200×2000).
 * Con el default ('css') la captura saldría a 1600×1000 y el dsf 2 no serviría
 * de nada, que es justo lo que el pedido quería evitar.
 */
async function capturar(page: Page, nombre: string): Promise<void> {
  await desenfocar(page)
  await page.screenshot({ path: `${OUT}/${nombre}`, scale: 'device' })
}

test.describe.configure({ mode: 'serial' })

test('capturas de la landing', async ({ page }) => {
  mkdirSync(OUT, { recursive: true })

  // El comprobante de cierre se auto-imprime al confirmar. window.print()
  // bloquea el navegador headless; se neutraliza ANTES de cargar la app.
  await page.addInitScript(() => {
    window.print = () => {}
  })

  await loginAsOwner(page)
  await prepararUI(page)

  // ── Guard fail-closed: ¿está sembrado el escenario? ──────────────────────
  // No alcanza con que la suite corra contra LAB (eso ya lo verificó
  // global-setup): hay que estar en la SEDE de vitrina, con el turno abierto.
  // Si no, se aborta con la instrucción exacta en vez de fotografiar otra cosa.
  const brand = page.getByTestId('sidebar-brand-name')
  await expect(brand, `La sede activa no es "${SEDE}". Aplicá supabase/landing-seed.sql (deja a owner.test parado en esa sede).`)
    .toHaveText(SEDE)
  await expect(page.getByText(CAJERA, { exact: true }).first(),
    `El header no muestra a "${CAJERA}". Aplicá supabase/landing-seed.sql.`).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cerrar turno', exact: true }),
    'No hay turno abierto. Aplicá supabase/landing-seed.sql antes de capturar.').toBeVisible()

  // ══════════════════════════════════════════════════════════════════════════
  // 2) cuenta-mesa.png — la cuenta abierta de la mesa 7
  //
  // La UI no agrupa por rondas: son 4 líneas planas. Las 3 de la primera ronda
  // salen marcadas "En cocina" (sent_to_kitchen), que es lo más cerca que llega
  // el producto hoy a distinguir una tanda de otra.
  // ══════════════════════════════════════════════════════════════════════════
  await page.goto('/mesas')
  await prepararUI(page)
  await page.getByRole('button', { name: new RegExp(`${MESA}\\b`) }).click()

  // Esperar el DATO, no un tiempo: las 4 líneas y el total ya renderizados.
  await expect(page.getByTestId('table-item')).toHaveCount(4)
  await expect(page.getByText(MESA_TOTAL).first()).toBeVisible()
  await capturar(page, 'cuenta-mesa.png')

  // ══════════════════════════════════════════════════════════════════════════
  // 3) cobro-factura.png — cobro mixto de esa misma cuenta
  //
  // Sin CUFE ni factura electrónica: G-Vento no tiene ese módulo (grep de
  // "cufe|dian|factura electr" en src/ y supabase/ da cero). Lo que sí existe
  // —y es lo que se retrata— es el pago dividido entre métodos.
  //
  // "Datáfono" tampoco existe como método: los cuatro son Efectivo, Tarjeta,
  // Transferencia y Nequi/QR. La captura dice "Tarjeta".
  //
  // NO se confirma el cobro: la captura es la pantalla de cobro, y dejar la
  // mesa abierta mantiene el escenario intacto para el resto de la corrida.
  // ══════════════════════════════════════════════════════════════════════════
  await page.getByRole('button', { name: 'Cobrar', exact: true }).click()
  await expect(page.getByTestId('checkout-total')).toBeVisible()

  await page.getByTestId('pay-split-toggle').click()
  await page.getByTestId('pay-line-method-0').selectOption('cash')
  await page.getByTestId('pay-line-amount-0').fill(EFECTIVO)
  await page.getByTestId('pay-add-method').click()
  await page.getByTestId('pay-line-method-1').selectOption('card')
  await page.getByTestId('pay-line-amount-1').fill(TARJETA)

  // El botón se habilita solo cuando las partes suman el total: es la señal de
  // que 80.000 + 77.000 = 157.000 cuadró de verdad, no una espera arbitraria.
  await expect(page.getByTestId('checkout-confirm')).toBeEnabled()
  await capturar(page, 'cobro-factura.png')

  await page.keyboard.press('Escape')

  // ══════════════════════════════════════════════════════════════════════════
  // 4) fiado-cliente.png — ficha de Wílmer Ospina
  //
  // La ficha real muestra: total adeudado, N° de fiados abiertos y la tabla
  // Venta/Fecha/Total/Pagado/Saldo. No tiene "consumo de hoy" ni "hace 11
  // días" como etiquetas: el consumo de hoy es la fila fechada hoy (62.000) y
  // el abono de hace 11 días vive en el historial del modal de abono.
  // ══════════════════════════════════════════════════════════════════════════
  await page.goto('/fiado')
  await prepararUI(page)
  await page.getByRole('button', { name: new RegExp(CLIENTE) }).click()
  await expect(page.getByTestId('customer-detail')).toBeVisible()
  await expect(page.getByTestId('detail-total')).toContainText('154.000')
  await expect(page.getByTestId('credit-row')).toHaveCount(2)
  await capturar(page, 'fiado-cliente.png')

  // ══════════════════════════════════════════════════════════════════════════
  // 5) cierre-turno.png — arqueo cuadrado
  //
  // Se declaran los CUATRO métodos, no solo el efectivo: si los otros tres
  // quedan en blanco, el modal los cuenta como 0 y la fila de totales muestra
  // una diferencia negativa en rojo. La captura pedía "Diferencia 0".
  // ══════════════════════════════════════════════════════════════════════════
  await page.goto('/ventas')
  await prepararUI(page)
  await page.getByRole('button', { name: 'Cerrar turno', exact: true }).click()
  await expect(page.getByText('Cerrar turno de caja')).toBeVisible()

  await page.getByTestId('close-shift-declared').fill(DECLARADO_EFECTIVO)
  await page.getByTestId('pay-declared-card').fill(DECLARADO_TARJETA)
  await page.getByTestId('pay-declared-transfer').fill(DECLARADO_TRANSFER)
  await page.getByTestId('pay-declared-nequi').fill(DECLARADO_NEQUI)

  await expect(page.getByText('El monto declarado coincide exactamente')).toBeVisible()
  await capturar(page, 'cierre-turno.png')

  // ══════════════════════════════════════════════════════════════════════════
  // 1) apertura-caja.png — modal de apertura con la base de 200.000
  //
  // Va al final por construcción: el modal solo aparece SIN turno abierto, así
  // que primero hay que cerrar el que veníamos de fotografiar. Se cierra con
  // 962.000 declarados, o sea cuadrado — no deja un descuadre en el historial.
  //
  // El modal de apertura pide UN solo campo (el efectivo inicial): no tiene
  // dónde decir "abierto por Marcela". Eso lo aporta el header, que muestra a
  // la usuaria de la sesión, y el turno que se cierra acá quedó registrado en
  // el historial como "Abrió Marcela".
  // ══════════════════════════════════════════════════════════════════════════
  await page.getByRole('button', { name: 'Confirmar cierre' }).click()

  const abrirTurno = page.getByRole('button', { name: 'Abrir turno' })
  await expect(abrirTurno).toBeVisible({ timeout: 30_000 })
  await abrirTurno.click()

  // Por rol, no por texto: "Abrir turno de caja" es a la vez el <h2> y el
  // botón de submit ("Abrir turno de caja →"), y getByText matchea los dos.
  await expect(page.getByRole('heading', { name: 'Abrir turno de caja' })).toBeVisible()
  await page.getByTestId('open-shift-amount').fill('200000')
  await expect(page.getByTestId('open-shift-amount')).toHaveValue('200.000')
  await capturar(page, 'apertura-caja.png')

  // Se deja SIN confirmar a propósito: el escenario ya está consumido y volver
  // a abrir un turno solo agregaría ruido a la próxima corrida del seed.
})
