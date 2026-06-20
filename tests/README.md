# Tests E2E (Playwright)

Pruebas end-to-end de los flujos críticos: gating RBAC, POS/carrito, venta en
espera y kanban de delivery.

## Laboratorio (org LAB) — dónde corren los tests

El ambiente de pruebas es la **organización `LAB`**, NO un proyecto Supabase
separado. Vive en el **mismo** Supabase que la app, aislado de los datos reales
(org `G-10`) por la arquitectura multi-tenant: LAB tiene sus propias sedes,
roles, usuarios y catálogo.

- **Sedes:** `Sede Lab Norte` y `Sede Lab Sur`.
- **Usuarios de prueba** (sede activa = Norte):
  - `owner.test@gvento.com` → rol `owner` (acceso a Norte y Sur).
  - `cajero.test@gvento.com` → rol `cajero` (acceso solo a Norte).
- **Datos mínimos** en Norte: categorías Lab Cocteles/Lab Insumos, productos
  Lab Cerveza/Lab Agua (simple, sin tracking), insumo Lab Vaso (con stock),
  compuesto Lab Coctel (receta: 1 Lab Vaso) y extra Lab Doble; mesas y
  `store_sequences` en 0.

La semilla está en **`supabase/lab-seed.sql`** (idempotente: se puede re-aplicar
sin duplicar). **Ventaja de usar una org en vez de un proyecto separado:** cada
migración nueva se aplica a la misma BD, así que **LAB siempre está al día** con
el esquema; no hay que mantener un segundo proyecto sincronizado.

### Credenciales del laboratorio

Las credenciales de `owner.test` / `cajero.test` van en `.env.test`
(`E2E_OWNER_*` / `E2E_CASHIER_*`). Ver "Credenciales (NO hardcodear)" abajo.

### Health check de organización (seguridad de datos)

`tests/global-setup.ts` hace, antes de la suite, **login real con
`E2E_OWNER_EMAIL`** y consulta su organización. Si **no es `LAB`** → **aborta**
con un error claro:

> `PELIGRO: las credenciales de prueba no son del laboratorio (org actual: X).`

Esto evita correr la suite contra datos reales (org `G-10`) por un `.env.test`
mal configurado.

## ⚠️ ADVERTENCIA: estos tests modifican datos del backend

Los tests corren contra el **backend real de Supabase** que use el `.env` del
proyecto. No son inocuos:

- `closeShiftIfOpen` **cierra el turno de caja activo** (declarando 0).
- Los specs de **venta-espera** y **pos** pueden **crear datos de prueba**.
- **NO ejecutar nunca contra datos reales (org `G-10`)**: el health check de
  organización lo bloquea, pero la regla sigue siendo correr **solo con
  credenciales de la org `LAB`**.
- Producción quedó **limpia** (los usuarios de prueba fueron eliminados de ahí);
  toda la verificación E2E se hace en **LAB**.

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

- El `.env` del proyecto con `VITE_GVENTO_SUPABASE_URL` y `VITE_GVENTO_SUPABASE_ANON_KEY`
  (los tests usan el backend real de Supabase, contra la org **LAB**). El health
  check de `global-setup.ts` también los lee para verificar la organización.
- Las dos cuentas de prueba de la org LAB: **owner.test** y **cajero.test**
  (ver "Laboratorio" arriba).
- Navegadores de Playwright instalados una vez:

  ```bash
  npx playwright install chromium
  ```

## Credenciales (NO hardcodear)

Las credenciales se leen de variables de entorno, nunca van en el código:

```bash
cp .env.test.example .env.test
# editar .env.test con cuentas reales de prueba
```

`.env.test` está en `.gitignore`. Variables:

| Variable               | Cuenta (org LAB)              |
|------------------------|-------------------------------|
| `E2E_OWNER_EMAIL`      | `owner.test@gvento.com`       |
| `E2E_OWNER_PASSWORD`   |                               |
| `E2E_CASHIER_EMAIL`    | `cajero.test@gvento.com`      |
| `E2E_CASHIER_PASSWORD` |                               |

## Montar / sembrar el laboratorio

Las cuentas auth `owner.test@gvento.com` y `cajero.test@gvento.com` **ya existen
en Auth**. Lo que faltaba eran sus `profiles` y el resto del ecosistema LAB, que
crea la semilla:

1. Aplica **`supabase/lab-seed.sql`** (Dashboard → SQL Editor). Es idempotente:
   crea (o reconcilia) la org LAB, sus 2 sedes, los 4 roles de sistema, los
   profiles de `owner.test`/`cajero.test`, sus `user_stores`, y los datos mínimos
   de Sede Lab Norte. Al final imprime una verificación.
2. Pon las contraseñas de ambas cuentas en `.env.test` (`E2E_OWNER_PASSWORD` /
   `E2E_CASHIER_PASSWORD`). Si no recuerdas las contraseñas, resetéalas desde
   Supabase Auth.
3. Corre la suite: el health check de `global-setup.ts` confirma que las
   credenciales son de la org `LAB` antes de empezar.

> Si alguna vez necesitas cuentas de prueba nuevas, créalas en Auth (o desde la
> app) y vuelve a ejecutar `lab-seed.sql` adaptando los UUIDs de la cabecera.

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
