# Capturas de la landing comercial

Las 5 PNG de esta carpeta se generan con un script, no a mano. Los montos que
aparecen en ellas son los mismos que menciona el texto de la landing, así que se
siembran a propósito y se verifican contra la base antes de capturar.

**Todo corre contra un Supabase local en Docker.** No se toca la base de la nube
—donde viven G-10, Salchimelo y Café Aroma— ni siquiera para leer. No hay
ninguna credencial de producción en juego en ningún paso.

## Cómo correrlo

```bash
pnpm capturas:preparar   # levanta el Supabase local y lo siembra entero
pnpm capturas            # genera las 5 PNG
```

Salen en `capturas-landing/` a **3200 × 2000** (viewport 1600 × 1000 con
`deviceScaleFactor: 2`).

`capturas:preparar` hace, sobre una base en blanco: aplica los 39 archivos de
esquema de `supabase/` en orden, crea las cuentas de Auth del laboratorio, y
corre `lab-seed.sql` y `landing-seed.sql`. Tarda menos de un minuto (la primera
vez, más: el CLI de Supabase baja las imágenes de Docker).

### Requisitos

- Docker corriendo y el CLI de Supabase (`supabase --version`).
- Nada más. **No hace falta `.env`, ni `.env.test`, ni credenciales de la nube.**

Los puertos locales son **5433x** y no los 5432x por defecto, porque G-Mura
suele tener su propio stack local ocupando 54321-54324. Ver `supabase/config.toml`.
Studio local: http://127.0.0.1:54333

## Dónde salen los datos

Todo vive en una sede llamada **"Bar La Ronda"**, dentro de la organización
**LAB**, dentro del contenedor local. El sidebar muestra `restaurants.name`, no
la organización — por eso la captura dice "Bar La Ronda" y no delata que es un
laboratorio.

Aunque la base sea descartable, el guard de organización sigue puesto: el
`globalSetup` de la suite E2E hace login real y **aborta si las credenciales no
son de LAB**, y `capturas.config.ts` **pisa** las variables de entorno con las de
`.env.capturas` sin condiciones — si eso fuera un "si no está definido", un
`.env.test` presente bastaría para apuntar la corrida a la base compartida sin
que nadie se entere.

**"Marcela", "Wílmer Ospina", "Andrés" y "Valeria" son personajes.** El cliente
de fiado se siembra sin cédula y sin teléfono a propósito: la ficha los mostraría
si existieran, y no tienen por qué salir en una pieza de marketing.

## Las 5 capturas

| archivo | qué muestra | números |
|---|---|---|
| `apertura-caja.png` | Modal de apertura de turno | base 200.000 |
| `cuenta-mesa.png` | Cuenta abierta de la mesa 7 | 121.000 + 36.000 = **157.000** |
| `cobro-factura.png` | Cobro dividido de esa cuenta | Efectivo 80.000 + Tarjeta 77.000 |
| `fiado-cliente.png` | Ficha de fiado de Wílmer Ospina | saldo 154.000 · 62.000 de hoy |
| `cierre-turno.png` | Arqueo de cierre cuadrado | ventas 1.847.000 · esperado 962.000 · **Cuadre exacto** |

## Tres cosas que la UI no tiene, y qué se hizo en cambio

Si el texto de la landing dice otra cosa, **el texto es el que hay que ajustar**
— no hay captura posible del otro lado.

1. **No hay facturación electrónica ni CUFE.** `grep -rin "cufe|dian|factura
   electr" src/ supabase/` da cero: no falta el dato, falta el módulo.
   `cobro-factura.png` retrata el **pago mixto**, que sí existe. Una captura con
   un CUFE inventado sería publicidad de una función que el producto no tiene.

2. **"Datáfono" no es un método de pago.** Los cuatro son *Efectivo, Tarjeta,
   Transferencia y Nequi/QR* (`src/components/pos/PaymentSplitEditor.tsx`). La
   captura dice **Tarjeta**.

3. **No existe el concepto de "ronda".** El panel de la mesa lista los ítems
   planos, sin hora por línea ni separadores. Las dos rondas se siembran igual
   (con sus timestamps reales), y lo más cerca que llega la UI a distinguirlas
   es la marca **"En cocina"** sobre las tres líneas de la primera.

Con el mismo criterio: la ficha de fiado **no tiene** las etiquetas "consumo de
hoy" ni "último abono hace 11 días". Lo que muestra es *Total por cobrar* y la
tabla `Venta · Fecha · Total · Pagado · Saldo`; el consumo de hoy es la fila
fechada hoy (62.000), y el abono de hace 11 días vive en el historial dentro del
modal de abono.

## Por qué el orden de las capturas es raro

El modal de apertura **solo existe cuando no hay turno abierto**, y cobrar y
cerrar **exigen que sí lo haya**. Por eso `apertura-caja.png` se toma al final,
después de cerrar el turno de verdad (declarando 962.000, o sea cuadrado).

**Consecuencia: cada corrida consume el escenario.** Para volver a capturar,
`pnpm capturas:preparar` otra vez. Si te olvidás, el script aborta con el
mensaje exacto en vez de producir capturas vacías.

## La hora del turno

El escenario usa marcas de tiempo **relativas a `now()`** (turno abierto hace 6
horas, ronda 1 hace 95 minutos, ronda 2 hace 20). Nunca queda fechado en el
futuro, pero la píldora del header dice la hora en que se corrió menos seis. Si
querés una hora concreta en la captura, corré `pnpm capturas` a esa hora + 6 h, o
cambiá el intervalo en la sección 3.1 de `supabase/landing-seed.sql`.

## Dos cosas rotas del repo que aparecieron al montar la base

Ninguna se corrigió en el repo (R5: una migración aplicada no se edita). Las dos
están parcheadas **solo en el momento de aplicar**, dentro de
`scripts/capturas/preparar-local.mjs`:

1. **`supabase/cash-movements.sql:5` usa `create type if not exists`**, que
   **ningún Postgres acepta** — la sintaxis no existe en ninguna versión. O sea
   que ese archivo, tal como está en el repo, **no puede haber corrido nunca
   entero**. En producción el enum `movement_type` existe, así que se aplicó de
   otra forma (a mano, por partes). Es exactamente el agujero que describe
   CLAUDE.md → *"El estado de aplicación de una migración NO se declara"*: no hay
   ledger, así que el archivo y lo que realmente corrió pueden divergir sin que
   nadie se entere.

2. **`supabase/organization-subscription.sql` termina con una sección de
   verificación manual sin comentar**, con placeholders literales
   (`'<uuid de la org de ese usuario>'`). Corriendo el archivo entero, revienta.
   La migración real termina en la línea anterior a `-- ── (A) VERIFICACIÓN DEL
   TRIGGER`.

Y de paso: el array `ORDEN` de `preparar-local.mjs` es **el primer orden de
migraciones del repo verificado por ejecución** sobre una base vacía. Hasta ahora
ese orden solo existía en la cabeza de quien las fue aplicando.
