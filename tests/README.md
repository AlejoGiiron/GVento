# Tests E2E (Playwright)

Pruebas end-to-end de los flujos críticos: gating RBAC, POS/carrito, venta en
espera y kanban de delivery.

## ⚠️ ADVERTENCIA: estos tests modifican datos reales

Los tests corren contra el **backend real de Supabase** que use el `.env` del
proyecto. No son inocuos:

- `closeShiftIfOpen` **cierra el turno de caja activo** (declarando 0).
- Los specs de **venta-espera** y **pos** pueden **crear datos de prueba**.
- **NO ejecutar contra el Supabase de producción** mientras haya operación real
  en curso: cerrarías la caja **en medio de una venta**.
- **Idealmente:** usar un **proyecto Supabase de testing separado** — apuntar
  `VITE_GVENTO_SUPABASE_URL` (y la anon key) del entorno a ese proyecto.
- **Mínimo:** correr solo en **horarios sin operación**.

## Requisitos

- El dev server de Vite (`pnpm dev` en `http://localhost:5173`). Playwright lo
  levanta solo (`webServer` en `playwright.config.ts`, con `reuseExistingServer`).
- El `.env` del proyecto con `VITE_GVENTO_SUPABASE_URL` y `VITE_GVENTO_SUPABASE_ANON_KEY`
  (los tests usan el backend real de Supabase contra la org de prueba).
- Dos cuentas de prueba: un **owner** y un **cajero** (ver abajo).
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

| Variable               | Cuenta              |
|------------------------|---------------------|
| `E2E_OWNER_EMAIL`      | owner de la org     |
| `E2E_OWNER_PASSWORD`   |                     |
| `E2E_CASHIER_EMAIL`    | cajero de la org    |
| `E2E_CASHIER_PASSWORD` |                     |

## Crear el usuario CAJERO de prueba en Supabase

El gating RBAC necesita una cuenta con rol **cajero** (sin acceso a Productos,
Reportes ni Configuración). La forma más fiel es crearla desde la propia app:

1. Entra como **owner** → **Configuración → Usuarios → Crear usuario**.
2. Completa nombre y correo (ej. `cajero.e2e@tudominio.com`), genera/copia la
   contraseña, y en **Rol** elige **cajero**.
3. Guarda esas credenciales en `.env.test` (`E2E_CASHIER_EMAIL` / `_PASSWORD`).

> La Edge Function `create-user` crea el usuario con email ya confirmado, así que
> puede iniciar sesión de inmediato. El rol RBAC (`role_id`) se asigna al crear.

Alternativa manual (SQL/Studio): crear el usuario en Auth, dejar que el trigger
`handle_new_user` cree el `profile`, y setear su `role_id` al id del rol `cajero`
de la organización (`select id from roles where name = 'cajero'`).

El **owner** ya existe (es la cuenta admin mapeada a `owner` en el seed de la
Fase ARQ).

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
