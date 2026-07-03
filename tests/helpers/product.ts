import { type Page, expect } from '@playwright/test'

/**
 * Hace clic en "Crear producto" / "Guardar cambios" del ProductModal y ESPERA a
 * que el modal CIERRE antes de retornar.
 *
 * Por qué: `handleSubmit` es async — guarda el producto y LUEGO reconcilia
 * receta/extras (product_components / product_extras). El modal solo cierra
 * (onClose) cuando TODO completó. Si el test avanza/navega antes (p. ej. al ver
 * el producto ya en la grilla), la navegación **aborta el reconcile en vuelo** y
 * la receta/extras no se persisten → fallos flaky aguas abajo.
 *
 * Señal de cierre robusta: el input de nombre (placeholder "Ej: Mojito Cubano")
 * es exclusivo del modal y desaparece SOLO al cerrar. No se usa el texto del
 * botón porque cambia a "Guardando..." durante el guardado.
 */
export async function saveProductAndClose(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(Crear producto|Guardar cambios)$/ }).click()
  await expect(page.getByPlaceholder('Ej: Mojito Cubano')).toHaveCount(0, { timeout: 15_000 })
}
