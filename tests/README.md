# Tests E2E (Playwright)

Pruebas end-to-end de los flujos críticos: gating RBAC, POS/carrito, venta en
espera y kanban de delivery.

## Laboratorio — dónde corren los tests: Supabase LOCAL en Docker

🔴 **La suite corre SOLO contra el Supabase local de Docker, nunca contra la nube**
(decidido el 2026-09-30). La nube cobra por **ingesta de logs** —el mes cerró en
2,58 GB contra 1 GB del plan— y cada corrida de la suite son cientos de requests
logueados. Que LAB esté aislada por RLS no cambia eso: en la nube LAB es una
organización dentro de la **misma** base que G-10, Salchimelo y Café Aroma, y el
medidor es el mismo.

**Mecanismo (qué lo impide y qué no):**
- `playwright.config.ts` carga `scripts/capturas/local.config` (versionado, sin
  secretos), **pisa** `process.env` con él y **aborta si la URL no es loopback**
  (allowlist `127.0.0.1` / `localhost` / `::1`). No lee `.env` ni `.env.test`.
  Auditado por mutación el 2026-09-30: con la URL apuntando a un host remoto, la
  suite aborta antes de abrir una sola conexión.
- Los specs **no** tienen cargadores propios de `.env` (se sacaron las 10 copias):
  lo que ven es lo que puso la config.
- **No impide** que un spec nuevo vuelva a leer `.env.test` a mano. La URL igual
  queda local (ningún cargador pisa lo ya definido), pero una clave que falte en
  `local.config` podría colarse. **No copies el viejo `loadEnv`.**

Dentro del stack local, el ambiente es la **organización `LAB`** que siembra
`supabase/lab-seed.sql`:

- **Sedes:** `Sede Lab Norte` y `Sede Lab Sur` (+ `Sede Lab Sin Cocina`).
- **Usuarios** (contraseña local `lab-local-2026`, ver `local.config`):
  `owner.test` (owner), `cajero.test` (cajero), `mozo.test` (mozo, gating negativo).
- **Datos mínimos** en Norte: categorías Lab Cocteles/Lab Insumos, productos
  Lab Cerveza/Lab Agua (simple, sin tracking), insumo Lab Vaso (con stock),
  compuesto Lab Coctel (receta: 1 Lab Vaso) y extra Lab Doble.

### Health check de organización

`tests/global-setup.ts` hace login real con `E2E_OWNER_EMAIL` y aborta si la
organización **no es `LAB`**. Complementa al guard de loopback: ese mira **a qué
base** se apunta; este, **con qué credenciales**.

### Qué queda fuera en local

- **`E2E_GCENTRO_HMAC_SECRET` no se define**: la función local `aplicar-estado`
  no tiene el secreto, así que los casos de `suscripcion-estado.spec.ts` que
  necesitan firma válida hacen skip.

## ⚠️ Los tests mutan el estado del laboratorio

- `closeShiftIfOpen` **cierra el turno de caja activo** (declarando 0).
- Varios specs crean datos de prueba. Los que usan mesa usan una **mesa fija por
  spec**, liberada en un `afterAll` con aserción (`tests/helpers/lab.ts`).
- En local esto es barato de deshacer: `pnpm e2e:preparar` reconstruye la base
  desde cero.

## ⚠️ Puerto dedicado — NO correr contra otra app

Los tests usan un **puerto dedicado de G-Vento: `5180`** (no el `5173` por defecto
de Vite). Playwright **siempre levanta su propio servidor de gvento ahí**
(`reuseExistingServer: false` + `--strictPort`), así nunca se conecta por accidente
a otra app que esté ocupando un puerto.

Esto importa porque **G-Mura y G-Vento pueden correr en paralelo**: G-Mura suele
ocupar el `5173`. Si los tests apuntaran a un puerto compartido con
`reuseExistingServer`, Playwright se conectaría a la app equivocada (login falla,
o peor, mutarías datos del proyecto incorrecto). Salvaguardas:

- **Puerto dedicado `5180` + `strictPort`**: si está ocupado, la corrida **falla
  ruidosamente** en vez de servir/conectarse a otra cosa.
- **Health check** (`tests/global-setup.ts`): antes de la suite verifica que el HTML
  servido contiene el marcador `G-Vento`; si no, **aborta**.

No hace falta tener un `pnpm dev` corriendo a mano: Playwright lo arranca en `5180`.

## Requisitos

- **Docker Desktop** corriendo y el **Supabase CLI** instalado.
- Navegadores de Playwright instalados una vez:

  ```bash
  npx playwright install chromium
  ```

## Montar / sembrar el laboratorio local

```bash
pnpm e2e:preparar     # levanta el stack (supabase start) si no está, aplica las
                      # migraciones en el orden verificado, crea las 3 cuentas de
                      # Auth y corre lab-seed.sql. Sin la vitrina de las capturas.
```

Es **destructivo sobre la base local** (la reconstruye desde cero) y solo sobre
ella: el script opera sobre el contenedor `supabase_db_gvento`. Re-correrlo es la
forma de volver a un laboratorio limpio.

Las credenciales **no** van en `.env.test`: viven en `scripts/capturas/local.config`
(versionado; no son secretas, existen solo dentro del contenedor). `.env.test`
queda sin uso para la suite.

## Correr los tests

```bash
pnpm test:e2e                 # todos
pnpm test:e2e tests/rbac.spec.ts        # un archivo
pnpm test:e2e --headed        # viendo el navegador
pnpm test:e2e --ui            # modo UI interactivo
```

Reporte HTML tras una corrida: `npx playwright show-report`.

## Notas

- `workers: 1` y `fullyParallel: false`: los flujos comparten backend; se corren
  en serie para evitar interferencias.
- El test "Cobrar exige turno abierto" es **determinista**: el helper
  `closeShiftIfOpen` (tests/helpers/shift.ts) cierra el turno si hubiera uno
  abierto, declarando 0, para que siempre corra en estado "sin turno". ⚠️ Esto
  cierra el turno REAL del backend; es intencional.
- Los tests dependen de que exista al menos **un producto activo** en el catálogo.
- Selectores estables usados: `data-testid` (`product-card`, `cart-total`,
  `close-shift-declared`), `title` (botones de espera), roles y textos visibles.
