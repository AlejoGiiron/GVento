# M1 — verificación en equipos reales (iPhone y Android)

La emulación de Playwright (`m-iphone` = WebKit, `m-android` = Chromium) es la red.
Esto es lo que **solo** se puede comprobar con el teléfono en la mano. Hacerlo **por
separado** en un iPhone (Safari) y en un Android (Chrome).

## Antes de empezar

- **Tiene que ser https.** Wake Lock, "Instalar" y el service worker no funcionan por
  `http://<ip-del-pc>`. Opción práctica: la vista previa de Vercel de la rama.
- La vista previa usa la base de la **nube**: necesita `supabase/pos-sale-lotes.sql`
  aplicado ahí, y conviene entrar con el usuario de caja de **LAB** (no con uno de un
  cliente). Cada prueba son ventas reales en LAB.
- Tener un turno abierto en la sede de LAB (desde el escritorio) y, para el punto 6,
  el QR de Nequi subido en Configuración.

## Lista (marcar en cada teléfono)

| # | Qué hacer | Qué tiene que pasar | iPhone | Android |
|---|---|---|---|---|
| 1 | Entrar con el usuario de caja | Cae directo en **Vender** (`/m`), sin el menú lateral del escritorio | ☐ | ☐ |
| 2 | **Instalar** | Android: aparece "Instalá Vender…" con botón **Instalar** → queda el ícono en la pantalla de inicio. iPhone: aparece UNA vez "Compartir → Agregar a inicio"; tras cerrarla y recargar, no vuelve | ☐ | ☐ |
| 3 | Abrir desde el ícono instalado | Abre sin barra del navegador, en **Vender**, con el nombre "Vender" | ☐ | ☐ |
| 4 | Dejar el teléfono quieto en Vender 2–3 min (más que el apagado automático) | La pantalla **no se apaga**. Si se apaga, tiene que haber una franja amarilla "La pantalla se puede apagar sola" (en iPhone instalado puede pasar según la versión de iOS: anotar versión) | ☐ | ☐ |
| 5 | Mirar el borde de abajo con el carrito lleno y en la pantalla de cobro | El botón verde **Cobrar** y los de **Efectivo / Nequi** quedan enteros **arriba** de la barra de inicio (iPhone) / de los botones del sistema (Android) | ☐ | ☐ |
| 6 | Efectivo → tocar "¿Con cuánto paga?" | Sale el teclado **numérico**, y el botón **Cobrar** queda **visible arriba del teclado** (no tapado) | ☐ | ☐ |
| 7 | Nequi con QR | El QR se ve grande y nítido; un teléfono de cliente lo escanea | ☐ | ☐ |
| 8 | Vender con poca luz (brillo bajo) | Se leen nombres, precios y el total sin esfuerzo; los botones se aciertan con el pulgar | ☐ | ☐ |
| 9 | **Dos o tres teléfonos a la vez**, mismo turno, cada uno con su usuario | Cada uno cobra sin trabarse; en **Mis ventas** cada uno ve SOLO lo suyo, y las cifras suman lo del arqueo | ☐ | ☐ |
| 10 | Modo avión justo al tocar **Cobrar**, volver a conectar y tocar de nuevo | Una sola venta (si la primera había entrado, dice "ya se había registrado") | ☐ | ☐ |
| 11 | Girar el teléfono | Sigue usable (el manifest pide vertical en la app instalada) | ☐ | ☐ |
| 12 | Menú → **Versión completa** | Abre el escritorio y no vuelve solo a Vender en esa pestaña | ☐ | ☐ |

**Anotar por teléfono:** modelo, versión de iOS/Android y del navegador. Si algo falla,
una captura y el número de punto.
