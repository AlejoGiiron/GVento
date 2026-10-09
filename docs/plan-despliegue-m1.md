# Plan de despliegue — aviso de versión, paso 2, config y M1

Escrito el 2026-10-04. Se sigue **al pie de la letra y en orden**. Cada paso es un release
chico que se diagnostica solo. **No se arranca un paso si el anterior no pasó su
verificación.**

## Reglas del plan (valen para todos los pasos)

- **Quién hace qué.** Los merges a `develop` y la suite los hago yo (Claude Code) y te aviso
  el commit. Los **releases** (`main`) y **todo el SQL** de producción los hacés vos. Yo no
  toco producción.
- **`develop` no se toca antes del Paso 1:** tiene que estar exactamente en `3fb4471`. Las ramas
  de documentación (`docs/post-release-1-10` y `docs/plan-despliegue-m1`) entran con el merge del
  **Paso 1b**, no antes.
- **Organizaciones, por UUID (R2), nunca por nombre:**
  - Café Aroma = `992420af-4484-4b69-8fbb-547a69c137af`
  - G-10 = `12b53bae-a4f7-4076-80f9-8f9288bd0567`

  Para confirmarlos una vez:
  ```sql
  select id, name from public.organizations
   where id in ('992420af-4484-4b69-8fbb-547a69c137af', '12b53bae-a4f7-4076-80f9-8f9288bd0567');
  ```
  Esperado: 2 filas, `Café Aroma` y `G-10`. Si no, pará.
- **Horario:** fuera del horario de G-10 y Salchimelo. Se decide con datos (Paso 0) y se
  confirma **justo antes** de cada paso con la consulta **Q-AHORA**.
- **SQL y frontend: el SQL va ANTES del frontend que lo necesita.** En la reversa es al
  revés: **primero el frontend (Vercel), después el SQL.**
- **Si una verificación no da lo esperado: NO sigas.** Pegame la salida.
- **Un `.sql` ya aplicado en producción no se vuelve a aplicar** (R5). Si la consulta
  "ANTES" de un paso dice que ya está, se salta la aplicación y se va directo a la
  verificación.
- **Rollback en Vercel (plan Hobby): solo vuelve al deploy INMEDIATAMENTE anterior.** Por
  eso los releases van de a uno y con tiempo entre medio. Después de un rollback, Vercel
  **deja de publicar sola** lo que se empuja a `main`, hasta que se toca **Undo Rollback**.

### Cómo sacar un `.sql` del repo sin que cambie (todos los pasos)

En **Git Bash**. Así el archivo sale **exacto** del commit, sin conversión de finales de
línea, y el md5 se puede comparar:

```bash
mkdir -p /c/Users/Alejandro/Documents/Proyectos/gvento-despliegue
cd /c/Users/Alejandro/Documents/Proyectos/gvento
git show <COMMIT>:<RUTA> > /c/Users/Alejandro/Documents/Proyectos/gvento-despliegue/<NOMBRE>.sql
md5sum /c/Users/Alejandro/Documents/Proyectos/gvento-despliegue/<NOMBRE>.sql
```

Después se abre **en VS Code**, Ctrl+A, Ctrl+C, y se pega en el SQL Editor de Supabase.
No uses `clip` ni la consola de PowerShell para copiar: pueden romper las tildes, y las
funciones tienen mensajes con tildes. Si eso pasara, la verificación por md5 de la función
lo detecta (da otro md5).

Los archivos **de la raíz** del repo (fuera de git: reversas y consultas) se usan tal cual,
con su md5:

```bash
cd /c/Users/Alejandro/Documents/Proyectos/gvento
md5sum <ARCHIVO>.sql
```

### Cómo se hace un release (pasos 1, 1b, 3 y 5)

En **Git Bash**, cuando yo te diga que `develop` está listo y en qué commit:

```bash
cd /c/Users/Alejandro/Documents/Proyectos/gvento
git checkout develop
git log -1 --format='%h %s' develop          # tiene que ser el commit que te pasé
git fetch origin
git diff --stat origin/main develop           # tiene que listar SOLO los archivos del paso
git push origin develop
git checkout main
git pull --ff-only origin main
git merge --no-ff develop -m "release: <título del paso>"
git push origin main
git rev-parse --short=7 HEAD                  # ← ESTA es la versión que va a mostrar la app
git checkout develop
```

Después: en Vercel, esperar a que el deploy de `main` diga **Ready**. Abrir en el navegador
**la dirección de producción + `/version.json`**. Tiene que mostrar
`{"version":"<los 7 caracteres de arriba>"}`.

### Cómo se hace el rollback de un frontend

Vercel → proyecto → **Overview** → en el recuadro *Production Deployment*, **Instant
Rollback** → elegir el deploy anterior → **Continue** → **Confirm Rollback**.
Luego, en el navegador, `/version.json` tiene que mostrar la versión del release anterior.
**Ojo:** después de esto, empujar a `main` ya no publica. Para volver a publicar: en el
mismo recuadro, **Undo Rollback**.

---

## Consultas que se repiten

**Q-AHORA** — ¿hay alguien vendiendo? (correr justo antes de cada paso)

```sql
select org.name as organizacion,
       count(o.id) as ventas_ultimos_30_min,
       (select count(*) from public.cash_shifts s join public.restaurants r2 on r2.id = s.restaurant_id
         where r2.organization_id = org.id and s.closed_at is null) as turnos_abiertos
  from public.organizations org
  left join public.restaurants r on r.organization_id = org.id
  left join public.orders o on o.restaurant_id = r.id and o.created_at > now() - interval '30 minutes'
 group by org.id, org.name
 order by org.name;
```

**Esperado:** `ventas_ultimos_30_min = 0` en **G-10** y en **Salchimelo**. Si alguna tiene
ventas: **no arranques**, están trabajando. `turnos_abiertos` es informativo: un turno puede
quedar abierto de la noche anterior.

**Q-FUNCIONES** — huella de las funciones de los pasos 2 y 4 (pasos 2, 3, 4 y 5)

```sql
select p.oid::regprocedure as funcion,
       md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g')) as md5,
       has_function_privilege('anon', p.oid, 'execute') as anon_ejecuta,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_ejecuta
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('add_order_items_with_extras', 'register_pos_sale', 'update_restaurant_config')
 order by 1;
```

El md5 es **normalizado**: no cambia por finales de línea ni espacios al final.

---

## Paso 0 — Elegir el horario (una vez)

**Q-HORARIO** — ventas por hora de Bogotá, últimos 30 días:

```sql
select org.name as organizacion,
       extract(hour from o.created_at at time zone 'America/Bogota')::int as hora_bogota,
       count(*) as ventas_30_dias
  from public.organizations org
  join public.restaurants r on r.organization_id = org.id
  join public.orders o on o.restaurant_id = r.id
 where o.created_at >= now() - interval '30 days'
 group by 1, 2
 order by 1, 2;
```

**Cómo leerlo:** buscá un tramo de **al menos 2 horas seguidas** en el que **G-10 y
Salchimelo** tengan 0 (o casi 0) ventas en 30 días. Las horas que no aparecen son 0. Ese es
el horario de todos los pasos. Como referencia: la fase 1 de D se aplicó el 1/10 a las 10:40
y el release fue a las 11:45, sin problemas. Igual, confirmalo con esta consulta.

---

## Paso 1 — Aviso de versión

- **Depende de:** nada. (Si ya lo hiciste hoy, saltá a **Verificación** y **Prueba**.)
- **Qué lleva:** `supabase/app-version.sql` y el frontend de `develop` = `3fb4471`.
- **Horario:** el del Paso 0. **Q-AHORA** antes.

**1.1 — ANTES** (¿ya está aplicado?):

```sql
select to_regclass('public.app_versiones') as tabla,
       to_regprocedure('public.marcar_version(text, text, text)') as rpc;
```

Esperado: `null | null`. Si sale `app_versiones | marcar_version(...)`, ya está aplicado: **no lo
apliques** e ir a 1.3.

**1.2 — Aplicar el SQL:**

```bash
git show 3fb4471:supabase/app-version.sql > /c/Users/Alejandro/Documents/Proyectos/gvento-despliegue/p1-app-version.sql
md5sum /c/Users/Alejandro/Documents/Proyectos/gvento-despliegue/p1-app-version.sql
```

md5 esperado: **`f86eecbe559626427b01a810e5529c5d`**. Si da otro, pará. Pegalo en el SQL
Editor y correlo. Tiene que terminar sin error.

**1.3 — Verificación del SQL:**

```sql
select to_regclass('public.app_versiones') is not null                                   as tabla,
       (select relrowsecurity from pg_class where oid = 'public.app_versiones'::regclass) as rls,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'app_versiones') as policies,
       has_table_privilege('anon', 'public.app_versiones', 'select')                      as anon_lee,
       has_table_privilege('authenticated', 'public.app_versiones', 'insert')             as auth_escribe,
       md5(regexp_replace(regexp_replace(pg_get_functiondef('public.marcar_version(text, text, text)'::regprocedure), E'\r','','g'), E'[ \t]+\n', E'\n','g')) as md5_rpc,
       has_function_privilege('anon', 'public.marcar_version(text, text, text)', 'execute')          as anon_ejecuta,
       has_function_privilege('authenticated', 'public.marcar_version(text, text, text)', 'execute') as auth_ejecuta;
```

Esperado, **exacto**: `t | t | 0 | f | f | 208a273b942d98a1f2af6ddf1682c7d8 | f | t`.

**1.4 — Release del frontend** (*Cómo se hace un release*), con estos datos:
- `git log -1 --format='%h %s' develop` → `3fb4471 merge: aviso de versión — id de equipo estable sin localStorage`
- `git diff --stat origin/main develop` → **17 archivos**, entre ellos `supabase/app-version.sql`,
  `src/components/layout/VersionBanner.tsx`, `src/hooks/useVersionCheck.ts`,
  `src/hooks/useMarcarVersion.ts`, `vercel.json`, `vite.config.ts`, `public/sw.js` y
  `src/components/products/ProductModal.tsx` (el arreglo de la foto). Si aparece algo de
  `pos-sale-lotes`, `movil` o `restaurant-config`, **pará**: `develop` no está donde debe.
- Título: `release: aviso de versión nueva`

**1.5 — Este release es el ÚLTIMO que necesita el mensaje de "recarguen".** El frontend
viejo no tiene aviso. Mandá a G-10, Salchimelo y Café Aroma: *"Recarguen la página en cada
equipo (Ctrl+Shift+R en el computador; en el celular, cerrar la pestaña y abrirla de
nuevo)."* Desde acá, el aviso lo hace la app sola.

**1.6 — Prueba en Café Aroma:**
1. **Antes** del release, dejá una pestaña de Café Aroma abierta en el escritorio.
2. Cuando el deploy esté *Ready*, abrí otra pestaña y entrá: abajo a la izquierda, debajo
   del menú, tiene que decir `v<los 7 caracteres del release>`.
3. Volvé a la pestaña vieja (cambiá de pestaña y regresá). La pestaña vieja **no tiene** el
   aviso (es anterior a esta versión): recargala a mano. Desde el próximo release, el aviso
   tiene que aparecer solo.
4. En el SQL Editor (**Q-VERSIONES**):
   ```sql
   select org.name as organizacion, p.full_name as usuario, v.version,
          (v.ultima_vez at time zone 'America/Bogota')::timestamp(0) as ultima_vez_bogota,
          left(v.equipo, 8) as equipo, left(v.user_agent, 60) as navegador
     from public.app_versiones v
     join public.profiles p on p.id = v.user_id
     left join public.restaurants r on r.id = v.restaurant_id
     left join public.organizations org on org.id = r.organization_id
    order by v.ultima_vez desc;
   ```
   Esperado: una fila de Café Aroma con tu usuario y la versión del release.

**1.7 — Reversa:**
1. Frontend: *Cómo se hace el rollback* (vuelve a `04273f3`, "release: cierre de turno en el servidor…").
2. Después, el SQL: `app-version-revertir.sql` (raíz), md5 **`8a4d128d593702ec0a253f7c4a7faa5a`**.
   Esperado: una fila `antes | <filas>` y al final `revertido`. Re-aplicarla falla sin
   cambiar nada (probado en Docker).

---

## Paso 1b — El aviso también cuando falla un módulo diferido

- **Depende de:** Paso 1 (es un cambio sobre el aviso).
- **Qué lleva:** solo frontend, rama `fix/version-modulo` (`b2d4e79`). **Sin SQL.**
- **Horario:** el del Paso 0, **otro día o al menos 1 hora después del Paso 1** (así el
  rollback de Hobby vuelve al Paso 1 y no más atrás). **Q-AHORA** antes.

**1b.1 — Merges** (los hago yo), en este orden: `fix/version-modulo`, `docs/post-release-1-10`
y `docs/plan-despliegue-m1` → `develop`. Suite completa y te paso el commit. Simulado el
2026-10-04: los tres entran sin conflictos.

**1b.2 — Release**, con estos datos:
- `git diff --stat origin/main develop` → **10 archivos**:
  - código: `src/hooks/useVersionCheck.ts` y `tests/aviso-version.spec.ts`;
  - documentación: `docs/DEUDAS.md`, `docs/gvento-plan-cierre.md` y `docs/plan-despliegue-m1.md`;
  - `supabase/close-cash-shift.sql`: **solo comentarios del encabezado** (líneas 26–45, fuera de
    las funciones). Ya está aplicada: **no se vuelve a correr**, y las funciones de prod no
    cambian;
  - `supabase/diag/` (4 consultas de diagnóstico de solo lectura): **no se aplican**.
- Título: `release: aviso de versión también si falla la carga de un módulo`

**1b.3 — Verificación:** `/version.json` con la versión nueva. Es el primer release con
aviso: **las pestañas abiertas desde el Paso 1 tienen que mostrar "Hay una versión nueva —
Recargar"** al volver a primer plano (o dentro de 5 minutos).

**1b.4 — Prueba en Café Aroma:**
1. Antes del release, dejá una pestaña de Café Aroma abierta.
2. Después del release, volvé a esa pestaña: aparece **"Hay una versión nueva"** con
   **Recargar**. Tocalo: el aviso se va y la versión de abajo a la izquierda cambia.
3. Reportes → **Exportar Excel**: tiene que descargar el archivo.

**1b.5 — Reversa:** solo el frontend (*Cómo se hace el rollback*). No hay SQL.

---

## Paso 2 — SQL del paso 2 (`pos-sale-lotes.sql`)

- **Depende de:** Paso 1 (no técnicamente, pero así cada release queda aislado).
- **Qué lleva:** solo SQL. **Es compatible con el frontend que está en producción** (medido
  en Docker: las llamadas viejas de 2 argumentos caen en la función nueva; 77/77 specs del
  frontend viejo en verde).
- **Horario:** el del Paso 0. **Q-AHORA** antes.

**2.1 — ANTES** (¿es la versión de prod que conozco?):

```sql
select p.oid::regprocedure as funcion,
       md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g')) as md5
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('add_order_items_with_extras', 'register_pos_sale')
 order by 1;
```

Esperado: **una sola fila**, `add_order_items_with_extras(uuid,jsonb)` con md5
**`5a7f25c53fc38a2326dd5f6ca455588a`**.
- Si el md5 es otro: **pará**. La reversa vuelve a ese texto exacto, así que no devolvería prod
  a como está.
- Si ya aparece `register_pos_sale`: ya está aplicado. No lo apliques; ir a 2.3.

**2.2 — Aplicar:**

```bash
git show e91c850:supabase/pos-sale-lotes.sql > /c/Users/Alejandro/Documents/Proyectos/gvento-despliegue/p2-pos-sale-lotes.sql
md5sum /c/Users/Alejandro/Documents/Proyectos/gvento-despliegue/p2-pos-sale-lotes.sql
```

md5 esperado: **`ac43ad79bc637799fc194f7ebaff839b`**. Pegarlo y correrlo. Tiene que terminar
sin error.

**2.3 — Verificación:** **Q-FUNCIONES**. Esperado, **exacto**, 2 filas:

| funcion | md5 | anon_ejecuta | auth_ejecuta |
|---|---|---|---|
| `add_order_items_with_extras(uuid,jsonb,uuid)` | `e2e6ec81b743d9afc900c793b9910ff3` | f | t |
| `register_pos_sale(uuid,jsonb,jsonb,jsonb)` | `23e946e81c11f9486b04f9d53432e933` | f | t |

🔴 **Si aparece además `add_order_items_with_extras(uuid,jsonb)`**, quedaron las dos
versiones y el frontend actual falla (`PGRST203`). Pegame la salida.

Y la tabla de tandas:

```sql
select (select relrowsecurity from pg_class where oid = 'public.order_item_lotes'::regclass) as rls,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'order_item_lotes') as policies,
       has_table_privilege('authenticated', 'public.order_item_lotes', 'select') as auth_lee,
       has_table_privilege('anon', 'public.order_item_lotes', 'select') as anon_lee;
```

Esperado: `t | 0 | f | f`.

**2.4 — Prueba en Café Aroma** (con el frontend de producción, que todavía es el viejo):
1. Abrí turno si no hay.
2. POS: una venta en efectivo con 2 productos. Tiene que salir con número.
3. Mesas: abrí una mesa, agregá 2 productos, después 1 más (dos tandas), y cobrala.
4. Comprobación (**Q-CAFE-MESA**):
   ```sql
   select o.order_number, o.status::text as estado, o.total,
          coalesce((select sum(i.qty * i.unit_price) from public.order_items i where i.order_id = o.id), 0)
        + coalesce((select sum(e.qty * e.unit_price) from public.order_item_extras e join public.order_items i on i.id = e.order_item_id where i.order_id = o.id), 0)
        - coalesce(o.discount_amount, 0) as total_de_las_lineas,
          (select count(*) from public.order_item_lotes l where l.order_id = o.id) as tandas_con_clave
     from public.orders o
     join public.restaurants r on r.id = o.restaurant_id
    where r.organization_id = '992420af-4484-4b69-8fbb-547a69c137af' and o.table_id is not null and o.created_at > now() - interval '2 hours'
    order by o.created_at desc
    limit 5;
   ```
   Esperado para la mesa de la prueba: `total = total_de_las_lineas` y `tandas_con_clave = 0`.
   El frontend viejo no manda clave de tanda; que sea 0 es lo correcto en este paso.

**2.5 — Reversa** (solo mientras el frontend de producción sea ANTERIOR al Paso 3):
`pos-sale-lotes-revertir.sql` (raíz), md5 **`da7da00c364c2b6df3dda5fc63565043`**.
Deja `add_order_items_with_extras(uuid,jsonb)` con el md5 de prod `5a7f25c5…`; si no da, hace
rollback solo. Muestra cuántas tandas se pierden: son claves, no plata. Si el Paso 3 ya está
en producción: **primero** el rollback del frontend, **después** este archivo.

---

## Paso 3 — Frontend del paso 2

- **Depende de:** Paso 2 aplicado y verificado (el frontend llama a `register_pos_sale`).
- **Qué lleva:** solo frontend: `feat/pos-sale-lotes` (`e91c850`) → `develop`.
- **Horario:** el del Paso 0. **Q-AHORA** antes. Otro día o ≥ 1 h después del último release.

**3.1 — Merge** (lo hago yo): `feat/pos-sale-lotes` → `develop`, suite completa, te paso el commit.
*Hecho el 2026-10-07: `9731272` (`merge: paso 2 — venta del POS en una transacción y tandas de
Mesas sin duplicar`). El release trae 15 archivos.*
Hay **un conflicto esperado en `docs/DEUDAS.md`** (simulado: un bloque, dos entradas nuevas en el
mismo lugar). Se resuelve conservando las dos. Ningún archivo de código entra en conflicto.

**3.2 — Release**, con estos datos:
- `git diff --stat origin/main develop` → **15 archivos**, entre ellos
  `src/hooks/useSaleCheckout.ts`, `src/hooks/useAgregarTanda.ts`, `src/pages/POSPage.tsx`,
  `src/pages/TablesPage.tsx`, `src/lib/uuid.ts`, `supabase/pos-sale-lotes.sql` (ya aplicado en
  el Paso 2: **no se vuelve a correr**) y `tests/pos-sale-lotes.spec.ts`. Nada de `movil` ni
  `restaurant-config`.
- Título: `release: venta del POS en una transacción y tandas de Mesas sin duplicar`

**3.3 — Verificación:** `/version.json` nuevo y **Q-FUNCIONES** igual que en 2.3 (el release
no toca la base).

**3.4 — Prueba en Café Aroma** (después de tocar **Recargar** en el aviso):
1. POS: una venta en efectivo y una en Nequi.
2. **Q-CAFE-POS**:
   ```sql
   select o.order_number, (o.created_at at time zone 'America/Bogota')::timestamp(0) as hora_bogota,
          o.total, sum(p.amount) as pagado,
          bool_and(p.created_at = o.created_at) as orden_y_pago_en_la_misma_transaccion
     from public.orders o
     join public.restaurants r on r.id = o.restaurant_id
     join public.payments p on p.order_id = o.id
    where r.organization_id = '992420af-4484-4b69-8fbb-547a69c137af' and o.table_id is null and o.created_at > now() - interval '2 hours'
    group by o.id
    order by o.created_at desc
    limit 5;
   ```
   Esperado: las 2 ventas nuevas con `orden_y_pago_en_la_misma_transaccion = t`. Eso solo pasa
   con `register_pos_sale`; las ventas del Paso 2, hechas con el frontend viejo, dan `f`. Medido
   en Docker: 345 `t` con el camino nuevo y 2 `f` con llamadas separadas.
3. Mesas: abrí una mesa, agregá 1 producto, después 2 más, y cobrala. En **Q-CAFE-MESA**:
   `total = total_de_las_lineas` y `tandas_con_clave = 2`.

**3.5 — Reversa:** el rollback del frontend (vuelve al Paso 1b). El SQL del Paso 2 **se
queda**: el frontend anterior funciona con él.

---

## Paso 4 — SQL de la config (`restaurant-config-rpc.sql`)

- **Depende de:** nada técnico (la función es nueva y nadie la llama todavía). Va antes del
  Paso 4b (la vista previa la usa) y del Paso 5.
- **Qué lleva:** solo SQL. Compatible con el frontend de producción, que no la llama.
- **Horario:** el del Paso 0. **Q-AHORA** antes.

**4.1 — ANTES, a quién le cambia el permiso de guardar la configuración.** Hasta ahora
decidía la RLS (rol viejo `admin` o permiso `sedes.gestionar`); con la función, decide el
permiso `config.acceder`.

```sql
select org.name as organizacion, p.full_name, p.role as rol_viejo, r.name as rol,
       (p.role = 'admin' or r.permissions ? 'sedes.gestionar' or r.permissions ? '*') as podia_antes,
       (r.permissions ? 'config.acceder' or r.permissions ? '*')                      as puede_ahora
  from public.profiles p
  join public.organizations org on org.id = p.organization_id
  left join public.roles r on r.id = p.role_id
 where p.is_active
   and (p.role = 'admin' or r.permissions ? 'sedes.gestionar' or r.permissions ? '*')
    is distinct from (r.permissions ? 'config.acceder' or r.permissions ? '*')
 order by 1, 2;
```

- **0 filas:** no le cambia a nadie. Seguí.
- **Con filas:** pará y pegámelas. `podia_antes = t, puede_ahora = f` es alguien que hoy guarda
  la config y dejaría de poder. `f / t` es alguien que pasaría a poder.

**4.2 — Línea base de "config pisada"** (antes de cambiar nada): correr
`config-pisado-senales.sql` (raíz), md5 **`55d559f62d20efe0834b0f08a31a62e3`**, y guardar la
salida. Bloque 1: `🔴` = hubo un QR y la config lo perdió. Bloque 2: lo que tiene hoy cada sede.

**4.3 — ANTES:**

```sql
select to_regprocedure('public.update_restaurant_config(jsonb)') as funcion;
```

Esperado: `null`. Si no es null, ya está aplicado: no lo apliques; ir a 4.5.

**4.4 — Aplicar:**

```bash
git show 11c14b2:supabase/restaurant-config-rpc.sql > /c/Users/Alejandro/Documents/Proyectos/gvento-despliegue/p4-restaurant-config-rpc.sql
md5sum /c/Users/Alejandro/Documents/Proyectos/gvento-despliegue/p4-restaurant-config-rpc.sql
```

md5 esperado: **`5e5e32cbece43c5269d8f878249f5299`**. Pegarlo y correrlo.

**4.5 — Verificación:** **Q-FUNCIONES**. Esperado: las 2 filas del Paso 2 **más**
`update_restaurant_config(jsonb)` con md5 **`63be67138bff54b73ffa1cd9d21b31c2`**, `f`, `t`.

**Las claves que la función acepta** (lista cerrada; cualquier otra se rechaza sin guardar
nada). Cada pantalla tiene un E2E que guarda **por la función**: verifica el POST con
exactamente esas claves, que ningún PATCH a `restaurants` lleve `config`, y el valor en la base.

| clave | pantalla | test |
|---|---|---|
| `slug` | Configuración → Restaurante | `config-guardar.spec.ts` › *Restaurante: el slug se guarda por la RPC (el nombre va por columnas, sin config)* |
| `nequi_qr_url` | Configuración → Caja → QR de Nequi | `config-guardar.spec.ts` › *QR de Nequi: subir el archivo guarda nequi_qr_url por la RPC* |
| `cash_out_reasons`, `payment_methods` | Configuración → Caja | `config-guardar.spec.ts` › *Caja: motivos y métodos se guardan por la RPC* |
| `kitchen_pin`, `kitchen_stations`, `kds_timers` | Configuración → Cocina | `config-guardar.spec.ts` › *Cocina: PIN, estaciones y semáforo se guardan por la RPC* |
| `default_delivery_time` | Configuración → Delivery | `config-guardar.spec.ts` › *Delivery: el tiempo por defecto se guarda por la RPC* |
| `notifications` | Configuración → Notificaciones | `config-guardar.spec.ts` › *Notificaciones: los sonidos se guardan por la RPC* |
| `pos_movil` | Configuración → POS móvil | `config-pos-movil.spec.ts` › *fijar, ordenar y guardar: queda pos_movil por id y en orden; el resto de la config no se toca* |

Que la lista del SQL y la del código (`CLAVES_CONFIG`) sean la misma lo vigila
`config-merge.spec.ts` › *CONTRATO: cada clave de CLAVES_CONFIG (TS) la acepta la RPC (allowlist
del SQL)*. Una clave que esté en el tipo y no en la lista ni siquiera compila.

**4.6 — Prueba en Café Aroma** (con el frontend del Paso 3, que todavía NO usa la función):
Configuración → **Caja** → **Guardar**: tiene que decir "Cambios guardados". Comprueba que el
camino viejo sigue andando.

**4.7 — Reversa:** `config-rpc-revertir.sql` (raíz), md5 **`e63444b6cd6e040aad254bf1fdd7d412`**.
Solo mientras el frontend de producción sea ANTERIOR al Paso 5; si no, primero el rollback del
frontend. No toca ninguna config.

---

## Paso 4c — Avisar a quien usa G-Vento desde un celular (antes del Paso 5)

- **Depende de:** Paso 1. `app_versiones` registra cada equipo desde ese release. **Correr lo
  más cerca posible del Paso 5:** un equipo que no abrió la app desde el Paso 1 no aparece.
- **Por qué:** desde el Paso 5, un dueño o cajero que abre G-Vento en un celular cae en
  **Vender** (`/m`). Si trabaja con Mesas o Reportes desde el celular, tiene que elegir
  **Versión completa** una vez en ese teléfono.

```sql
select org.name as organizacion, p.full_name as usuario, p.role::text as rol_viejo,
       count(*) as equipos_celular,
       max((v.ultima_vez at time zone 'America/Bogota')::timestamp(0)) as ultima_vez_bogota,
       max(left(v.user_agent, 70)) as un_navegador
  from public.app_versiones v
  join public.profiles p on p.id = v.user_id
  join public.organizations org on org.id = p.organization_id
 where p.is_active
   and p.role in ('admin', 'cashier')
   and v.user_agent ~ '(iPhone|iPod|Android.*Mobile)'
 group by org.name, p.full_name, p.role
 order by 1, 2;
```

**Cómo leerlo:** cada fila es un dueño (`admin`) o cajero (`cashier`) que abrió G-Vento desde un
celular. Los mozos no aparecen: a ellos no se les cambia nada. Probado en Docker: aparecen el
cajero y el dueño vistos desde iPhone y Android, y quedan afuera el mozo y el Chrome de
escritorio.

**Ojo, no es exactamente el mismo criterio que la app.** La consulta mira el navegador
(`user_agent`); la app mira la pantalla (táctil y lado corto < 600 px). Coinciden en celulares
comunes. Dos casos a saber:
- un plegable **abierto** dice "Android … Mobile", pero la app lo trata como tablet;
- un iPad se presenta como Mac: no aparece, y la app tampoco lo manda a `/m`.

**Qué hacer con cada fila:** avisarle antes del Paso 5, por ejemplo así: *"Desde el <fecha>,
G-Vento en el celular abre directo la pantalla de vender. Si usás Mesas o Reportes desde el
celular, tocá Menú → Versión completa: queda elegido en ese teléfono. Para volver a la pantalla
de vender, en el menú de la izquierda: Usar la versión para celular."*

---

## Paso 4b — Prueba en equipos reales con la vista previa de M1

- **Depende de:** Pasos 2 y 4 aplicados en producción. La vista previa vende con
  `register_pos_sale` y guarda la config con `update_restaurant_config`.
- **Con:** Café Aroma (la demo). Lista completa: `docs/m1-verificacion-equipos.md`.

**4b.1 — ¿La vista previa usa la base de producción?** Vercel → proyecto → **Settings** →
**Environment Variables**: `VITE_GVENTO_SUPABASE_URL` y `VITE_GVENTO_SUPABASE_ANON_KEY`
tienen que tener marcado **Preview**, con los **mismos valores** que Production. Si solo
tienen Production, la vista previa se construye sin base y no deja entrar. Para arreglarlo:
editar cada una, marcar Preview, guardar, y en Deployments → la vista previa de
`feat/m1-pos-movil` → ⋮ → **Redeploy**.

**4b.2 — Qué versión es la vista previa:**

```bash
cd /c/Users/Alejandro/Documents/Proyectos/gvento
git fetch origin
git rev-parse --short=7 origin/feat/m1-pos-movil
```

**4b.3 — Comprobar contra la base que escribe en producción:** entrá a la vista previa con
el usuario de Café Aroma y corré:

```sql
select p.full_name, v.version, (v.ultima_vez at time zone 'America/Bogota')::timestamp(0) as ultima_vez_bogota,
       left(v.user_agent, 60) as navegador
  from public.app_versiones v join public.profiles p on p.id = v.user_id
 where v.version = '<los 7 caracteres de 4b.2>';
```

Esperado: tu fila. Si no aparece, la vista previa **no** está escribiendo en producción
(revisá 4b.1).

**4b.4 — Si pide iniciar sesión en Vercel** (protección de vistas previas, activada por
defecto):
- **Lo simple:** iniciar sesión en Vercel en el navegador de ese teléfono.
- **Sin cuenta en el teléfono:** Vercel → Deployments → la vista previa → **Share** →
  **Anyone with the link** → copiar el enlace y abrirlo en el teléfono. En Hobby hay **un
  solo** enlace compartible por cuenta. Al terminar: **Share** → **Only people with access**.
- 🔴 **iPhone, app instalada:** la app agregada a la pantalla de inicio tiene **sus propias
  cookies**, separadas de Safari. Aunque Safari ya haya pasado la protección, la app
  instalada puede volver a pedir el inicio de sesión de Vercel. No está medido; anotarlo en
  el punto 3 de la lista. Si bloquea la prueba de instalación: Vercel → Settings →
  **Deployment Protection** → desactivar **Vercel Authentication**, probar, y **volver a
  activarla**. Mientras esté desactivada, la URL de la vista previa es pública, aunque igual
  hay que iniciar sesión en G-Vento.

**4b.5 — Antes de vender:** el usuario de Café Aroma tiene que ser de caja o dueño en el rol
viejo:

```sql
select p.full_name, p.role::text as rol_viejo
  from public.profiles p
 where p.organization_id = '992420af-4484-4b69-8fbb-547a69c137af' and p.is_active;
```

`rol_viejo` = `cashier` o `admin`. Y **el turno se abre antes**, desde el escritorio (o en el
teléfono: Menú → Versión completa → Ventas → abrir turno). `/m` no abre turnos.

**4b.6 — Resultado:** la lista de `docs/m1-verificacion-equipos.md`, un iPhone y un Android.
Pasame lo que falle (número de punto, modelo, versión de iOS/Android, captura). **El Paso 5 no
se hace hasta que la lista pase.**

---

## Paso 5 — M1 + fiado en `/m` (B) + frontend de la config

- **Depende de:** Paso 3 en producción, Paso 4 aplicado y Paso 4b aprobado.
- **Qué lleva** (decidido el 2026-10-08: sale **con B incluido**, para que G-10 lo vea completo
  y dé su opinión antes de crear los usuarios de los bartenders): `feat/m1-fiado` → `develop`.
  `feat/m1-fiado` contiene `prep/paso-5` (M1 + config + textos en "tú") y encima B: fiado en
  `/m`, cambio de rol en Usuarios, un id de venta por carrito con el método real en el aviso, y
  el login que distingue "sin conexión" (con tope de 15 s). **Un SQL, primero y solo: 5.0.**
- **Horario:** el del Paso 0. **Q-AHORA** antes. Otro día o ≥ 1 h después del último release.

**5.0 — SQL: `supabase/pos-sale-metodo-real.sql`. Va PRIMERO, SOLO, y se verifica ANTES del
frontend.** Hace que `register_pos_sale` devuelva el método real de la venta (también cuando ya
existía) con la función nueva `_venta_pos_respuesta`, y pasa dos de sus mensajes a "tú". Es
compatible con el frontend en producción (lee solo las claves de siempre), así que si algo sale
mal aquí, se revierte sin tocar el frontend.
- **Archivo:** el de `feat/m1-fiado`. md5 con finales LF: **`8568598b85d05c542f82613b3ef091df`**
  (`tr -d '\r' < supabase/pos-sale-metodo-real.sql | md5sum`).
- **Antes de correrlo — Q-METODO:**
  ```sql
  select p.oid::regprocedure as funcion,
         md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g')) as md5,
         has_function_privilege('anon', p.oid, 'execute') as anon_ejecuta,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_ejecuta
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('register_pos_sale', '_venta_pos_respuesta')
   order by 1;
  ```
  Esperado, **exacto**, 1 fila: `register_pos_sale(uuid,jsonb,jsonb,jsonb)` ·
  `23e946e81c11f9486b04f9d53432e933` · f · t. 🔴 **Si el md5 es otro, NO lo corras:** en
  producción hay otra versión y el archivo la pisaría. Pégame la salida.
- **Correr** el archivo completo en el SQL Editor (trae su `begin`/`commit`).
- **Después — Q-METODO otra vez.** Esperado, **exacto**, 2 filas:

  | funcion | md5 | anon_ejecuta | auth_ejecuta |
  |---|---|---|---|
  | `_venta_pos_respuesta(uuid,boolean)` | `e4fb984b02c176d6f877d5fbdf2f1c9d` | f | **f** |
  | `register_pos_sale(uuid,jsonb,jsonb,jsonb)` | `5c0e0d9eee8b2ad8fb5ecba549ab9d32` | f | t |

  `auth_ejecuta = f` en `_venta_pos_respuesta` es a propósito: la app no la llama, solo
  `register_pos_sale`. (Medido en Docker el 2026-10-08; el "antes" se midió cargando la reversa
  dentro de un `rollback` y dio el `23e946e8…` de producción.)
- **Reversa:** `pos-sale-metodo-revertir.sql` (fuera de git, en la raíz; md5
  **`07e82409e7d3191ad39bb780fca8e5f3`**). Deja `register_pos_sale` en `23e946e8…` y borra
  `_venta_pos_respuesta`. El frontend del Paso 3 y el de este paso funcionan con o sin ella (sin
  ella, el aviso de "ya quedó registrada" no nombra el método).
- 🔴 **No re-aplicar `pos-sale-lotes.sql` después:** devolvería `register_pos_sale` a la versión
  sin método real (R5). Si pasara, se arregla corriendo otra vez `pos-sale-metodo-real.sql`.

**5.1 — Merge** (lo hago yo): la rama del release es **`feat/m1-fiado`** (contiene
`prep/paso-5`). Es fast-forward desde `origin/develop` = `9731272`, así que `develop` avanza sin
merge nuevo:

```bash
git fetch origin
git checkout develop
git log -1 --format='%h' develop                          # tiene que ser 9731272 (si no, avísame)
git merge-base --is-ancestor develop origin/feat/m1-fiado && echo FF   # tiene que decir FF
git merge --ff-only origin/feat/m1-fiado
git log -1 --format='%h %s' develop                       # el commit de feat/m1-fiado que te paso
```

**5.2 — Release**, con estos datos:
- `git diff --stat origin/main develop` → **77 archivos** (45 nuevos, 32 modificados): los 60 de
  `prep/paso-5` y lo que agrega B (30 archivos, de los que 14 son nuevos y 3 entran recién al
  release: `src/pages/POSPage.tsx`, `src/hooks/useUsers.ts`, `tests/helpers/proxy-reenvio.ts`).
  **SQL en el diff:** `supabase/pos-sale-metodo-real.sql` (se corre en el 5.0) y
  `supabase/restaurant-config-rpc.sql` (ya aplicado en el Paso 4: **no se vuelve a correr**).
  `supabase/pos-sale-lotes.sql` **no cambia** (`git diff --quiet origin/develop develop --
  supabase/pos-sale-lotes.sql && echo sin cambios`).
  - **M1 (`/m`):** `src/pages/movil/` (2), `src/components/movil/` (5), `src/hooks/usePosMovil.ts`,
    `src/hooks/useDispositivoMovil.ts`, `src/hooks/useConfigExtras.ts`, `src/lib/posMovil.ts` (+ test),
    `public/movil/` (manifest con nombre "G-Vento", `icono.svg` fuente y los 4 PNG que genera
    `scripts/iconos-movil.mjs`; los vigila `src/lib/iconosMovil.test.ts`).
  - **Identidad por ruta:** `src/lib/identidadRutas.ts` (+ test), `vite.config.ts` (genera
    `movil.html` y `cocina.html` en el build: **no están en el repo**, por eso no aparecen),
    `vercel.json` (rewrites `/m` y `/m/*` → `movil.html`, `/cocina` → `cocina.html`, el resto →
    `index.html`), `tsconfig.node.json`, `index.html` (**sin** manifest; viewport-fit=cover).
  - **Login:** `src/pages/LoginPage.tsx`, `src/pages/login.css`; ruta `/m/login` en `src/App.tsx`.
  - **Config:** `supabase/restaurant-config-rpc.sql` (ya aplicado en el Paso 4: **no se vuelve a
    correr**), `src/lib/restaurantConfig.ts`, `src/hooks/useRestaurantConfig.ts`,
    `src/components/config/SeccionPosMovil.tsx`, `src/pages/ConfigPage.tsx`,
    `src/types/database.types.ts`.
  - **Resto del escritorio:** `src/components/ProtectedRoute.tsx`, `src/contexts/AuthContext.tsx`,
    `src/components/layout/AppLayout.tsx`, `src/components/layout/VersionBanner.tsx`,
    `src/components/pos/ItemConfigModal.tsx`, `src/hooks/useSaleCheckout.ts`,
    `src/hooks/useAgregarTanda.ts`.
  - **Tests y herramientas:** `playwright.config.ts`, `package.json` y `pnpm-lock.yaml` (Playwright
    1.63.0), 11 specs/helpers, `scripts/capturas/preparar-local.mjs`.
  - **Docs:** `CLAUDE.md`, `docs/DEUDAS.md`, `docs/m1-verificacion-equipos.md`,
    `docs/plan-despliegue-m1.md`.
  - **B (fiado en `/m` y lo que vino con él):** `src/components/movil/ClienteFiadoMovil.tsx`,
    `src/lib/clientesFiado.ts`, `src/lib/metodoVenta.ts`, `src/lib/falloLogin.ts`,
    `src/lib/rolLegacy.ts` (cada uno con su test), `src/hooks/useUsers.ts`, `src/pages/POSPage.tsx`,
    `supabase/pos-sale-metodo-real.sql`, `scripts/buscar-voseo.mjs`, y los specs
    `m-fiado`, `usuarios-cambio-rol`, `login-sin-conexion` (+ `pos-sale-lotes`, `m-pos-movil`,
    `helpers/proxy-reenvio`).
  - Nada de `pos-sale-lotes.sql` (entró en el Paso 3).
- **Lo que este release cambia en el ESCRITORIO** (si algo del escritorio falla después del
  Paso 5, está acá):
  - **Login (`/login`):** se ve **igual** (comparado píxel a píxel: vacío, con datos y con error).
    Cambia por dentro: el correo usa `autocomplete="username"` (contraseñas guardadas) y el ojo
    tiene nombre accesible. En anchos de celular (< 768 px) se ve la versión móvil.
  - **`ProtectedRoute`:** en un **celular**, el dueño y el cajero van a `/m` (con carga completa de
    página). Sin sesión dentro de `/m` se va a `/m/login`; desde cualquier otra ruta, a `/login`
    como siempre. En computador y tablet no cambia nada.
  - **Menú lateral:** el botón **Usar la versión para celular**, solo en un equipo que eligió
    "Versión completa".
  - **Configuración:** **todo** guardado pasa por `update_restaurant_config` (por eso el Paso 4
    va antes), y aparece la sección **POS móvil**.
  - **Modal de extras:** misma apariencia, lógica compartida con `/m`.
  - **Reintento de cobro y de tandas:** el usuario entra en la clave.
  - **`index.html` sin manifest:** desde una página del escritorio el navegador ya **no** ofrece
    "Instalar G-Vento Cocina KDS" (antes lo ofrecía en cualquier página, por error). Ver 5.6.
  - **Aviso de versión:** igual en el escritorio; en `/m` lo muestra el caparazón.
  - **Textos en "tú", sin voseo** (2026-10-08): en el escritorio solo cambia el aviso de usuario
    desactivado al iniciar sesión: "Contacta al administrador" (decía "Contactá"). Los demás
    cambios de texto son de `/m`.
  - **Login, errores (B):** "Credenciales incorrectas" solo si el servidor lo dice; sin red, 5xx o
    sin respuesta en **15 s**: "No hay conexión con el servidor. Revisa el wifi e intenta de
    nuevo." y el botón vuelve a quedar disponible; otro rechazo: "No se pudo iniciar sesión".
  - **POS, reintento (B):** cambiar el método en el reintento (también a fiado) ya no crea otra
    venta; si la primera había entrado, el aviso dice **"Esta venta ya quedó registrada como
    <método>. No se cobró dos veces."** con el método real, y el detalle de la venta también.
  - **Configuración → Usuarios (B):** cambiar el rol escribe el rol nuevo y el viejo juntos, y la
    fila muestra el rol guardado al instante. Un rol personalizado da `waiter` (no cobra).
- Título: `release: POS móvil (/m) con fiado, login en el celular y configuración fusionada en el servidor`

**5.3 — Verificación:** `/version.json` nuevo y **Q-FUNCIONES** igual que en 4.5, **salvo**
`register_pos_sale`, que después del 5.0 tiene md5 **`5c0e0d9eee8b2ad8fb5ecba549ab9d32`** (y Q-METODO
del 5.0, sin cambios: 2 filas). El service
worker (`public/sw.js`) va primero a la red en todo lo del mismo origen: con **Recargar**,
cada equipo toma la versión nueva, también la app instalada.

Y que cada ruta reciba su documento (Git Bash; reemplazá `<dominio>` por la dirección de
producción):

```bash
for r in /m /m/login /cocina /ventas; do printf '%-10s ' "$r"; curl -s "https://<dominio>$r" | grep -o 'rel="manifest" href="[^"]*"' || echo '(sin manifest)'; done
```

Esperado, **exacto**:

```
/m         rel="manifest" href="/movil/manifest.webmanifest"
/m/login   rel="manifest" href="/movil/manifest.webmanifest"
/cocina    rel="manifest" href="/manifest.json"
/ventas    (sin manifest)
```

**5.4 — Prueba en Café Aroma:**
1. Escritorio: Configuración → **POS móvil** → fijar 2 productos → **Guardar**.
   **Q-CAFE-CONFIG**:
   ```sql
   select r.name as sede, r.config -> 'pos_movil' as pos_movil, r.config ->> 'nequi_qr_url' as qr,
          r.config -> 'payment_methods' as metodos,
          (r.updated_at at time zone 'America/Bogota')::timestamp(0) as modificada_bogota
     from public.restaurants r
    where r.organization_id = '992420af-4484-4b69-8fbb-547a69c137af';
   ```
   Esperado: `pos_movil` con los 2 ids en orden. `qr` y `metodos` **iguales** a antes de guardar
   (no se pisan).
2. Configuración → **Caja** → Guardar → "Cambios guardados".
3. Celular: entrar con el usuario de caja → cae en **Vender**; los 2 fijados arriba con
   estrella; una venta en efectivo y una en Nequi; **Mis ventas** las muestra.
4. **Q-CAFE-POS**: las ventas del celular con `orden_y_pago_en_la_misma_transaccion = t`.
5. Celular: Menú → **Versión completa** → cae en el escritorio. Cerrar la pestaña y abrir G-Vento
   de nuevo en ese teléfono: **sigue en el escritorio**. En el menú lateral, **Usar la versión
   para celular** → vuelve a Vender, y al reabrir sigue en Vender.

**5.4b — Venta fiada desde `/m` con `demo@demo.com`** (el usuario de las pruebas de B):
1. Celular: entrar a `/m` con `demo@demo.com` → un producto → **Cobrar** → **Fiado** → buscar o
   crear un cliente de prueba → **Fiar $… a …**. La venta exitosa dice "Fiado a …"; en **Mis
   ventas** aparece en amarillo "Fiado · cliente" y **no** suma al efectivo.
2. **Q-FIADO-DEMO** (solo lectura):
   ```sql
   select o.order_number, o.type, o.total, o.payment_status,
          coalesce(c.name, o.customer_name) as cliente,
          (select count(*) from public.payments p where p.order_id = o.id) as pagos,
          (o.created_at at time zone 'America/Bogota')::timestamp(0) as hora_bogota
     from public.orders o
     join auth.users u on u.id = o.created_by
     left join public.customers c on c.id = o.customer_id
    where u.email = 'demo@demo.com' and o.customer_id is not null
    order by o.created_at desc
    limit 3;
   ```
   Esperado en la primera fila: la venta de recién, `type` = `takeaway`, `payment_status` =
   `pending`, el cliente que elegiste y **`pagos` = 0** (la deuda es la orden; los abonos se
   registran en el escritorio).
3. Escritorio, con el dueño de esa organización: **Fiado** muestra la deuda de ese cliente.

**5.5 — Reversa:** el rollback del frontend (vuelve al Paso 3). Los SQL de los Pasos 2 y 4 **se
quedan**: el frontend del Paso 3 funciona con los dos. El del **5.0 también puede quedarse** (el
frontend del Paso 3 lee solo las claves de siempre); se revierte con `pos-sale-metodo-revertir.sql`
solo si el problema es el propio `register_pos_sale`. El rollback también devuelve el
`vercel.json` anterior (todo a `index.html`).

**5.6 — Apps ya instaladas: quién tiene que reinstalar**
- **Tablets de Cocina (KDS) ya instaladas: NADA.** Su manifest es `/manifest.json` (`start_url`
  `/cocina`, sin `id`: su identidad es `/cocina`), y `/cocina` lo sigue sirviendo igual (ahora desde
  `cocina.html`). Abren y se actualizan como siempre.
- **Quien "instaló" el POS de escritorio como app: NADA obligatorio.** Lo que instaló en realidad
  fue la app de **Cocina** (antes cualquier página ofrecía ese manifest): su ícono abre `/cocina`
  hoy y lo seguirá haciendo. Si quiere el POS como app en un computador: Chrome → menú ⋮ →
  **Guardar y compartir** → **Crear acceso directo…** → marcar *Abrir como ventana*, desde
  `/ventas`.
- **Quien agregó `/m` a la pantalla de inicio durante las pruebas de la vista previa:** ese
  ícono apunta a la **vista previa**, no a producción. Borrarlo y agregar el de producción.
- **El POS móvil en producción:** nadie lo tiene instalado todavía (no existía); se instala desde
  `/m` después de este paso (mensaje para G-10 aparte).

---

## Hotfix — Mesas cerraba sin cobrar con la copia vieja (`hotfix/mesa-total-cero`)

- **Por qué no espera al Paso 9:** el pre-flight de Mesas (2026-10-09) encontró en producción mesas
  cerradas como pagadas sin filas en `payments` (G-10: 20, $613.800; Salchimelo: 18, $419.000). El
  cobro de mesa trabaja sobre la copia de la orden tomada al tocar "Cobrar"; si otro equipo agrega
  una tanda o cierra la mesa mientras tanto, cobrar con esa copia deja consumo sin cobrar.
- **Qué lleva:** solo frontend, desde `develop` (`fab23b0`). **Nada de SQL.** Antes de escribir, la
  pantalla relee la orden (`getOrdenFresca`) y decide con `src/lib/mesaFresca.ts`:
  - **Cobrar:** no cobra si la orden ya no está abierta, si cambió desde que se abrió el modal
    ("La mesa cambió desde que abriste el cobro…"), o si va a cerrar en $0 con líneas que el
    descuento no cubre ("La mesa tiene consumo por $X sin cobrar…").
  - **"Cerrar mesa" (sin consumo):** no la cancela si ya tiene ítems o ya no está abierta.
  - **Agregar ítems:** no agrega a una orden que ya se cobró o se cerró.
  - Si la relectura falla (sin red), no se escribe nada.
- **Qué NO cierra:** entre releer y escribir queda una ventana de milisegundos (dos equipos en el
  mismo instante). La cierra el servidor en el Paso 9 (`close_table_sale` y la guarda de
  `add_order_items_with_extras`). Tampoco corrige las ventas que ya quedaron mal: para medirlas,
  `supabase/diag/mesas-sin-pagos.sql` (en `feat/mesas-servidor`).
- **Pruebas:** `tests/mesa-total-cero.spec.ts` (los dos equipos: uno agrega una tanda con el cobro del
  otro abierto, con cortesía y con descuento parcial; "Cerrar mesa" sobre una mesa a la que otro le
  acaba de agregar; la tanda con el selector abierto y la mesa ya cobrada; el total guardado en 0;
  y los contrastes). Contra el código SIN el arreglo, los 5 casos reproducen el daño en la base.

**H.1 — Merge** (`develop` = `fab23b0`, el hotfix sale de ahí: fast-forward):
```bash
git fetch origin
git checkout develop
git merge-base --is-ancestor develop hotfix/mesa-total-cero && echo FF   # tiene que decir FF
git merge --ff-only hotfix/mesa-total-cero
```
**H.2 — Release.** Título: `release: Mesas relee la orden antes de cobrar, cerrar o agregar`.

**H.3 — Verificación** con `owner.test` en LAB (producción), dos pestañas: en la A abrir una mesa,
agregar un producto y tocar "Cobrar" (dejar el modal abierto); en la B agregar otro producto a la
misma mesa; en la A confirmar: tiene que decir "La mesa cambió desde que abriste el cobro" y la mesa
sigue abierta con los dos productos. Cerrar el modal, volver a "Cobrar" y cobrar: "Venta #N".

**H.4 — Reversa:** rollback del frontend (vuelve al release del Paso 5). No hay SQL que revertir.

---

## Hotfix combinado del 13/10 — `hotfix/mesa-total-cero` + `hotfix/mesa-pegada` (`hotfix/mesas-13-10`)

**Reemplaza a H.1 y H.2:** el hotfix de arriba no sale solo, sale en esta rama junto con el de mesas
pegadas. Martes 13/10, con G-10 y Salchimelo cerrados. Si la suite no estaba verde antes de las
12:30, pasa al miércoles 14/10 a las 7:00.

- **Qué lleva, además de lo de arriba:** solo frontend, **nada de SQL**.
  - **Mesa pegada** ("Ocupada" o "Pide cuenta" sin cuenta viva): la tarjeta dice "Sin cuenta abierta ·
    tócala para liberarla", y el panel trae el botón **Liberar mesa**. Antes de liberar, relee en la
    base que no haya una cuenta abierta.
  - **"Pide cuenta"** solo cambia una mesa que sigue ocupada. Si otro equipo ya la cobró, avisa.
  - **"Abrir mesa"** primero ocupa la mesa, y solo si sigue libre. Así no nacen huérfanas ni se abre
    dos veces la misma mesa.
  - **Si falla la carga de las cuentas, no ofrece liberar** (fail-closed).
  - **Varias cuentas vivas en una mesa** (MESA 12 de Salchimelo): aviso en la tarjeta ("2 cuentas
    abiertas") y en el panel, con la lista. Las cuentas salen siempre en el mismo orden: la más
    antigua primero, y es la que se muestra.
- **Pruebas:** `tests/mesa-pegada.spec.ts` (9 casos), además de `tests/mesa-total-cero.spec.ts`.
  Mutantes de las dos mejoras: 6 de 6 muertos.
- **Lo que NO arregla:** los datos que ya quedaron mal (las mesas se limpian con SQL aparte) y la
  ventana de milisegundos entre releer y escribir, que cierra el servidor en el Paso 9.

**HC.1 — Merge** (`develop` = `fab23b0`; la rama sale de ahí, así que es fast-forward):
```bash
git fetch origin
git checkout develop
git merge-base --is-ancestor origin/develop hotfix/mesas-13-10 && echo FF   # tiene que decir FF
git merge --ff-only hotfix/mesas-13-10
```
**HC.2 — Release.** Título: `release: Mesas relee la orden antes de cobrar y no deja mesas pegadas`.

**HC.3 — Verificación en producción con `demo@demo.com`**, en dos pestañas del escritorio (A y B),
cada escenario desde una mesa libre. En esa organización `demo@demo.com` es el dueño de **Café
Aroma**, así que:
- se usa una mesa propia de prueba: en Mesas → Configurar, "Nueva mesa" → **"PRUEBA HOTFIX"**;
- el escenario 2 hace una venta real: necesita un turno abierto y al final la venta se anula
  desde Historial con el motivo "prueba hotfix 13/10".

**Escenario 1 — mesa pegada simulada.** Como ya no se puede pegar una mesa desde la app, se pega
con SQL, **por UUID**:
```sql
-- Q-MESA-PRUEBA (solo lectura): el UUID de la mesa de prueba.
select t.id, t.name, t.status::text
  from public.tables t
  join public.profiles p on p.restaurant_id = t.restaurant_id
  join auth.users u on u.id = p.id
 where u.email = 'demo@demo.com' and t.name = 'PRUEBA HOTFIX';
-- Esperado: UNA fila, status 'free'. Copia el id.

-- PEGAR (escribe UNA fila): pega el id en la línea marcada.
update public.tables t set status = 'waiting_bill'
 where t.id = 'PEGA-AQUI-EL-ID'::uuid          -- con el texto de ejemplo FALLA a propósito
   and t.status = 'free'
   and not exists (select 1 from public.orders o
                    where o.table_id = t.id and o.status in ('pending', 'preparing', 'ready'))
returning t.id, t.name, t.status;
-- Esperado: UNA fila con 'waiting_bill'. Cero filas = la mesa no estaba libre o tenía
-- cuenta: no sigas, revisa.
```
En la pestaña A, tocar el botón de actualizar (↻). La tarjeta dice "Pide cuenta" y **"Sin cuenta abierta · tócala
para liberarla"**. Al tocarla, el panel dice "Esta mesa no tiene una cuenta abierta". Tocar **Liberar
mesa**, aceptar, y debe salir "Mesa PRUEBA HOTFIX liberada", con la tarjeta en "Libre".

**Escenario 2 — dos pestañas cobrando la misma mesa.**
- En A, abrir PRUEBA HOTFIX, agregar el producto más barato y tocar "Cobrar".
- En B, tocar el botón de actualizar (↻), abrir la misma mesa y tocar "Cobrar".
- En A, cobrar en efectivo: debe salir "Venta #N".
- En B, confirmar el cobro. Tiene que decir **"Esta mesa ya no está abierta: la cobró o la cerró otro
  equipo. Actualiza la pantalla."**, y no se cobra dos veces.
- Q-COBRO-UNA-VEZ (solo lectura):
  ```sql
  select o.order_number, o.status::text, o.total,
         (select count(*) from public.payments p where p.order_id = o.id) as pagos
    from public.orders o
    join public.tables t on t.id = o.table_id
   where t.id = 'PEGA-AQUI-EL-ID'::uuid
   order by o.created_at desc limit 1;
  ```
  Esperado: `delivered`, el total del producto y **`pagos` = 1**.
- Después, anular esa venta desde Historial.

**Escenario 3 — abrir la misma mesa desde dos pestañas.**
- A y B con la mesa libre en pantalla (tocar el botón de actualizar (↻) en las dos).
- En A, tocar la mesa → "Abrir mesa": debe salir "Mesa PRUEBA HOTFIX abierta".
- En B, sin actualizar, tocar la mesa → "Abrir mesa". Tiene que decir **"PRUEBA HOTFIX ya no está
  libre: otro equipo la abrió"**.
- Q-UNA-CUENTA (solo lectura):
  ```sql
  select count(*) as cuentas_vivas from public.orders
   where table_id = 'PEGA-AQUI-EL-ID'::uuid and status in ('pending', 'preparing', 'ready');
  ```
  Esperado: **1**. Con el código viejo eran 2.
- Al final, en A: "Cerrar mesa" (sin consumo). Después, en Configurar, "Eliminar mesa" sobre "PRUEBA HOTFIX".

**HC.4 — Reversa:** rollback del frontend (vuelve al release del Paso 5). No hay SQL que revertir.

---

## Release chico — Cocina, Mesas y Delivery se recargan solas (`feat/cocina-refresco`)

- **Por qué:** Realtime no entrega nada en producción (la publicación `supabase_realtime` está vacía,
  medido el 2026-10-09). Cocina solo mostraba una comanda nueva si alguien tocaba "Actualizar", y su
  indicador decía "En línea" igual (el canal informa `SUBSCRIBED` aunque no llegue nada).
- **Qué lleva:** solo frontend, **nada de SQL**. Rebasada el 2026-10-13 sobre el hotfix combinado
  (`develop` = `09945b2`): entra por fast-forward.
  - **Cocina:** recarga cada 30 s y al volver a la pestaña. El indicador dice "Se actualiza cada 30 s
    · HH:MM:SS" (la hora de la última carga); "En línea" solo si llegó un evento real de Realtime en
    los últimos 2 minutos.
  - **Mesas y Delivery:** recargan cada 45 s mientras la pestaña está visible y al volver a ella.
    **Pausadas con cualquier modal abierto** (el cobro, el selector de productos, abrir mesa,
    configurar, abrir turno; en Delivery, asignar repartidor y repartidores): una recarga de fondo no
    cambia ni cierra lo que el usuario está haciendo. El modal de cobro, además, guarda su copia de
    la mesa (la misma que el Paso 10).
- **Pruebas:** `tests/recarga-pantallas.spec.ts` (comanda nueva en Cocina sin tocar nada en ≤ 35 s;
  al volver a la pestaña; Mesas y Delivery reciben lo de otro equipo; con el cobro o el selector
  abiertos, la recarga no los cierra ni los cambia). Mutantes: 7 de 7 muertos.

**R.1 — Merge** (después del hotfix combinado, `develop` = `09945b2`; sale el martes 13/10, con
los locales cerrados):
```bash
git fetch origin
git checkout develop
git merge-base --is-ancestor origin/develop feat/cocina-refresco && echo FF   # tiene que decir FF
git merge --ff-only feat/cocina-refresco
```
**R.2 — Release.** Título: `release: Cocina, Mesas y Delivery se actualizan solas`.

**R.3 — Verificación en producción con `demo@demo.com` en Café Aroma** (demo), en dos pestañas del
escritorio (A y B).

**Antes: encender la cocina.** Café Aroma nació **sin cocina** (`uses_kitchen = false` en
`onboard-org-paso1.sql`, y todos sus productos con `routes_to_kitchen = false` en
`demo-seed-cafeteria.sql`). Así, Cocina no aparece en el menú y ninguna comanda llega. Primero se
anota cómo está hoy, para dejarlo igual al final:
```sql
-- Q-COCINA-AROMA (solo lectura)
select r.name as sede, r.uses_kitchen,
       (select count(*) from public.products p where p.restaurant_id = r.id and p.routes_to_kitchen) as productos_a_cocina
  from public.restaurants r
 where r.organization_id = '992420af-4484-4b69-8fbb-547a69c137af';
```
- Si `uses_kitchen` = `false`: Configuración → Cocina → encender **"Esta sede usa cocina"**.
- Si `productos_a_cocina` = 0: Productos → editar uno (el más barato) → encender **"Va a cocina"**.
- Mesas → Configurar → "Nueva mesa" → **"PRUEBA COCINA"**.

⚠️ **El POS (escritorio y `/m`) NO envía a cocina**, en ninguna versión: `register_pos_sale` deja
las líneas con `sent_to_kitchen = false` y el KDS solo muestra órdenes con al menos una línea
enviada. Una venta del POS **no** aparece en Cocina, y no es una falla (verificado en local el
2026-10-13 con `976c2ec` y con `ee59708`). La prueba se hace **solo desde Mesas**, con el botón
**"Cocina (1)"** (con número). Si dice "Cocina" sin número, debajo dice por qué (desde
`fix/cocina-avisos`).

**1 — La comanda aparece sola en ≤ 35 s, y el indicador no dice "En línea" falso.**
- En A: abrir **Cocina** (si pide PIN, el de Configuración → Cocina) y no tocarla más.
- El indicador tiene que decir **"Se actualiza cada 30 s · HH:MM:SS"**. **No** puede decir "En línea":
  Realtime no publica nada en producción, así que no hay eventos reales.
- En B: Mesas → "PRUEBA COCINA" → "Abrir mesa" → "Agregar ítems" → el producto que va a cocina →
  **"Cocina (1)"**. Anotar la hora.
- En A, sin tocar nada: la comanda aparece **en ≤ 35 s**, y la hora del indicador avanza.

**2 — Una recarga de fondo no cierra ni cambia la ventana de cobro de Mesas** (necesita un turno
abierto).
- En A: Mesas → "PRUEBA COCINA" → **"Cobrar"**. Anotar el total y dejar la ventana abierta.
- En B: agregar otro producto a la misma mesa.
- En A: esperar **60 s** sin tocar (la recarga es cada 45 s). La ventana de cobro **sigue abierta, con
  el mismo total y lo que se había escrito**.
- En A, confirmar el cobro: tiene que decir **"La mesa cambió desde que abriste el cobro…"** (el
  hotfix). Cerrar la ventana, volver a "Cobrar" (ahora con los dos productos) y cobrar: "Venta #N".
- Contraste, sin ventana abierta: en B agregar algo más. En A, con el mapa a la vista, el total de
  la tarjeta se actualiza solo en ≤ 50 s.

**Al final, dejarlo como estaba:**
- anular desde Historial la venta de prueba (motivo "prueba cocina-refresco 13/10");
- en Configurar, "Eliminar mesa" sobre "PRUEBA COCINA";
- apagar "Va a cocina" y "Esta sede usa cocina" **solo si estaban apagados** en Q-COCINA-AROMA.

**R.4 — Reversa:** rollback del frontend (vuelve al hotfix combinado, `09945b2`). No hay SQL.

---

## Paso propio — el arqueo cuenta los abonos de fiado (`arqueo-abonos.sql`)

Diseño: [`docs/diseno-arqueo-abonos.md`](diseno-arqueo-abonos.md). Rama `feat/arqueo-abonos`.

- **Qué lleva:** el SQL (`supabase/arqueo-abonos.sql`) y el frontend del cierre, que van **en la
  misma ventana, SQL primero**: con el SQL y el frontend viejo, la pantalla muestra el esperado sin
  abonos y el servidor congela el esperado con abonos (los dos lados de R1 #6 divergen) hasta que
  entra el frontend. Al revés (frontend primero) la pantalla consultaría una columna que todavía no
  existe cada 5 s.
- **Mejor con los turnos cerrados:** un turno abierto durante la migración cierra con la regla nueva,
  pero sus abonos de antes no tienen `shift_id` y no entran a su esperado (como hoy).

**AA.1 — Pre-flight, justo antes:** `supabase/diag/arqueo-abonos-preflight.sql`. Consulta 1:
`close_cash_shift` `433e2d781efb73df033b58d549dc3d5b`, `register_debt_payment`
`f90d210f8f69c53ba809440933f0d29c`, `register_debt_payments_batch` `d6d090a2df4e0589d4b279ad3b4742f8`
y la columna `no existe`. Consulta 2: los turnos abiertos.

**AA.2 — Correr `supabase/arqueo-abonos.sql`** (md5 con finales LF **`f6ae954940e3078176c1dd392cafaef1`**).
Si la precondición falla, aborta sin cambiar nada; re-aplicarlo también aborta.

**AA.3 — Verificación:** la consulta 1 del pre-flight otra vez. Esperado (medido en Docker el
2026-10-09): `close_cash_shift` `a395c0a1f04cf6405c461887f508115f`, `register_debt_payment`
`e75fd428dc199fa4f92b72040c5bd9fa`, `register_debt_payments_batch` `e9c9743ce3d37d3194515eca343ea750`,
y `debt_payments.shift_id | uuid`.

**AA.4 — Frontend:** `feat/arqueo-abonos` → `develop` por **fast-forward**. Rebasada el 2026-10-13
sobre `develop` = `c3a00c5` (hotfix combinado, cocina-refresco y `fix/cocina-avisos` ya publicados).
El rebase solo chocó en este plan (secciones y filas agregadas en el mismo lugar, conservadas todas;
el calendario viejo del 9/10 se descartó). El código y el SQL del arqueo no cambiaron. Título:
`release: el arqueo cuenta los abonos de fiado por método`.

**AA.5 — Prueba en producción** con `owner.test` en LAB: turno abierto, un abono de fiado por Nequi,
y en "Cerrar turno" el renglón de Nequi dice "incluye abonos $…" y su esperado lo suma.

**AA.6 — Reversa:** `arqueo-abonos-revertir.sql` (fuera de git, en la raíz; md5
`b6ebb3fb43b4214899930b9e6aeb80a0`): devuelve las tres funciones exactas a `433e2d78…`, `f90d210f…`
y `d6d090a2…` (probado en Docker). **Deja** `debt_payments.shift_id` (tiene datos; las funciones
viejas no la llenan). Con el frontend nuevo en producción, primero el rollback del frontend.
🔴 No re-aplicar después `close-cash-shift.sql` ni `cobro-turno.sql` (R5).

---

## Paso 6 — Fase 2 de D (cerrar el UPDATE directo de `cash_shifts`)

- **Depende de:** Paso 1 (para ver qué versión tiene cada equipo) y de que **G-10 cierre por el
  servidor**. No depende de los Pasos 2 a 5.
- **Qué lleva:** solo SQL.
- **Horario:** el del Paso 0, con **ningún turno abierto en G-10 ni en Salchimelo** (columna
  `turnos_abiertos` de **Q-AHORA** = 0 para las dos). Si alguien cierra con un equipo viejo
  justo después, no podría cerrar hasta recargar.

**6.1 — Precheck:** `fase2-precheck.sql` (raíz), md5 **`2bfbb69b524de2bc4dc648c81a309d1f`**.
- **Control** (léelo primero): bloque 1, todo cierre "antes del release" = `camino viejo`. Si
  no, la consulta no sirve: pará.
- **Condición para seguir:** en el bloque 2, **todos los cierres de G-10 posteriores al release
  del Paso 1** salen `servidor`. Si hay alguno `camino viejo` posterior al Paso 1, la columna
  `cerro` dice quién: ese equipo tiene el JS viejo. Que recargue; repetir otro día.

**6.2 — Versiones de G-10** (por UUID de la organización):

```sql
select p.full_name as usuario, p.role::text as rol, v.version,
       (v.ultima_vez at time zone 'America/Bogota')::timestamp(0) as ultima_vez_bogota, left(v.equipo, 8) as equipo
  from public.profiles p
  left join public.app_versiones v on v.user_id = p.id
 where p.organization_id = '12b53bae-a4f7-4076-80f9-8f9288bd0567' and p.is_active
 order by p.full_name, v.ultima_vez desc;
```

Esperado: **cada** usuario que cierra turno (en particular **valeria sanchez**) con al menos un
equipo con versión del Paso 1 o posterior, visto después de ese release. Un usuario con
`version` vacía no cargó ninguna versión con aviso: su equipo puede seguir con el JS viejo.

**6.3 — ANTES:**

```sql
select (select count(*) from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'cash_shifts'
           and grantee in ('anon', 'authenticated') and privilege_type = 'UPDATE') as grants_update,
       exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cash_shifts'
                and policyname = 'cash_shifts: cajero/admin cierra turno') as policy_cierre;
```

Esperado: `2 | t`. Si da `0 | f`, ya está aplicada: no la apliques.

**6.4 — Aplicar:** `fase2-aplicar.sql` (raíz), md5 **`d66e82313f1e7abfa428cdb22e10ccdd`**.

**6.5 — Verificación:** la consulta de 6.3. Esperado: **`0 | f`**.

**6.6 — Prueba en Café Aroma:** abrir turno → una venta en efectivo → **cerrar turno**. Tiene
que cerrar sin error. Si dice "Error al cerrar el turno": recargar (Ctrl+Shift+R) y volver a
cerrar. Si sigue, reversa.

**6.7 — Reversa:** `fase2-revertir.sql` (raíz), md5 **`034ec0a4a314d3294951a710255a9431`**. No hay
frontend involucrado. Reabre el UPDATE directo (el camino viejo): es para una emergencia con un
equipo que no puede recargar, no para un "Error al cerrar", que se arregla recargando.
Esperado: verifica la policy contra el hash de prod y hace rollback si no da; después,
6.3 da `2 | t`.

---

## Pasos 7 en adelante — "Mesas en el servidor" (ESQUEMA: se completa al construir cada uno)

Orden decidido el 2026-10-07 (y ajustado ese día): fiado en `/m` (M1.1, B) → permisos de cobro
(A) → Mesas en el servidor → diseño de cuentas abiertas. El 2026-10-08 se decidió que **B sale
dentro del Paso 5** (fila 11). Mismas reglas: SQL antes del frontend, cada SQL compatible
con el frontend de producción, reversa con el mismo método. Los md5, verificaciones y pruebas de
cada paso se escriben cuando el paso esté construido y probado en Docker.

| paso | qué | tipo | depende de |
|---|---|---|---|
| 7 | **Permisos de cobro** (A): `pos.vender` y `mesas.cobrar` dejan de ser inertes; el servidor deja de mirar el rol viejo. Incluye la migración de unión para las organizaciones existentes, con pre-flight de quién gana y quién pierde (nadie pierde). | SQL (+ catálogo) | Paso 5 |
| 7b | Frontend de permisos: quién va a `/m` pasa a ser `pos.vender`; rol de sistema "bartender". | frontend | 7 |
| 8 | `close_table_sale` + quién cobró (el pago registra al usuario desde el servidor). Cierra H2. | SQL | 7 |
| 8b | Mesas cobra con `close_table_sale`. | frontend | 8 |
| 9 | Quitar ítem de mesa devolviendo stock (cierra H3 y el 3.5) + cerrar mesa sin consumo en una RPC. | SQL | 8 |
| 9b | Mesas usa las dos RPC. | frontend | 9 |
| 10 | Archivar mesas (`archived_at` + RPC de eliminar). | SQL + frontend | 9b |
| 11 | ~~Fiado en `/m` (M1.1, B)~~ → **entra en el Paso 5** (decidido el 2026-10-08): ver 5.0 y 5.1. | — | — |

## Calendario de releases (actualizado el 2026-10-13)

Los martes G-10 y Salchimelo no abren: los pasos con SQL van ese día.

| fecha | release | rama | cómo entra a `develop` |
|---|---|---|---|
| mar 13/10 | hotfix combinado de Mesas (HC) | `hotfix/mesas-13-10` | fast-forward desde `fab23b0` (si la suite no está verde a las 12:30: mié 14/10, 7:00) |
| mar 13/10 (adelantado; HC ya salió: `main` = `976c2ec`) | Cocina, Mesas y Delivery se recargan solas | `feat/cocina-refresco` | rebasada sobre el hotfix combinado (`09945b2`), suite completa y fast-forward (si la suite no está verde a las 18:00: mié 14/10, 7:00) |
| mar 13/10 (adelantado; R y `fix/cocina-avisos` ya salieron: `develop` = `c3a00c5`) | el arqueo cuenta los abonos de fiado (AA) | `feat/arqueo-abonos` | rebasada sobre `develop` (`c3a00c5`), suite completa y fast-forward; SQL antes del frontend (AA.1–AA.4) |
| un martes después del arqueo | Paso 6, fase 2 de D | — | parte de la versión de `close_cash_shift` que deja el arqueo (`a395c0a1…`), no de la de hoy |
| martes siguientes | Pasos 7-8 (permisos de cobro, A) y después 9-10 (Mesas en el servidor) | `feat/a-permisos`, `feat/mesas-servidor` | se fija al llegar |
| al final | Realtime | `feat/realtime` | después del paquete de Mesas |

## Resumen

| paso | qué | SQL | frontend | reversa |
|---|---|---|---|---|
| 0 | elegir horario | — | — | — |
| 1 | aviso de versión | `app-version.sql` @ `3fb4471` (`f86eecbe…`) | develop `3fb4471` | rollback + `app-version-revertir.sql` (`8a4d128d…`) |
| 1b | aviso si falla un módulo + docs | — | `fix/version-modulo`, `docs/post-release-1-10`, `docs/plan-despliegue-m1` | rollback |
| 2 | SQL del paso 2 | `pos-sale-lotes.sql` @ `e91c850` (`ac43ad79…`) | — | `pos-sale-lotes-revertir.sql` (`da7da00c…`), solo antes del 3 |
| 3 | frontend del paso 2 | — | `feat/pos-sale-lotes` | rollback |
| 4 | SQL de la config | `restaurant-config-rpc.sql` @ `11c14b2` (`5e5e32cb…`) | — | `config-rpc-revertir.sql` (`e63444b6…`), solo antes del 5 |
| 4c | avisar a quien usa celular | — (consulta) | — | — |
| 4b | equipos reales | — | vista previa de `feat/m1-pos-movil` | — |
| 5 | M1 + config | — | `feat/m1-pos-movil` | rollback |
| H | hotfix: Mesas relee la orden antes de cobrar, cerrar o agregar | — | sale dentro de HC | — |
| HC | hotfix combinado: relee la orden + mesas pegadas + varias cuentas vivas | — | `hotfix/mesas-13-10` | rollback |
| R | Cocina, Mesas y Delivery se recargan solas | — | `feat/cocina-refresco` | rollback (vuelve al hotfix combinado) |
| AA | el arqueo cuenta los abonos de fiado | `arqueo-abonos.sql` (`f6ae9549…`), pre-flight justo antes | `feat/arqueo-abonos` | `arqueo-abonos-revertir.sql` (`b6ebb3fb…`) + rollback |
| 6 | fase 2 de D | `fase2-aplicar.sql` (`d66e8231…`) | — | `fase2-revertir.sql` (`034ec0a4…`) |
