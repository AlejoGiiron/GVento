# M1 — verificación en equipos reales (iPhone y Android)

La emulación de Playwright (`m-iphone` = WebKit, `m-android` = Chromium) es la red.
Esto es lo que **solo** se puede comprobar con el teléfono en la mano. Hacerlo **por
separado** en un iPhone (Safari) y en un Android (Chrome).

## Antes de empezar

- **Tiene que ser https.** Wake Lock, "Instalar" y el service worker no funcionan por
  `http://<ip-del-pc>`. Se usa la vista previa de Vercel de la rama.
- La vista previa usa la base que digan las variables de entorno de **Preview** en
  Vercel. Si son las de producción, necesita aplicados ahí:
  - `supabase/pos-sale-lotes.sql` → para cobrar en `/m`;
  - `supabase/restaurant-config-rpc.sql` → para **guardar cualquier cosa en
    Configuración** (incluidos los fijados y el QR). Sin él, `/m` vende igual, pero
    guardar en Configuración desde la vista previa falla.
- Se prueba con **Café Aroma** (la demo). El usuario tiene que ser de caja o dueño en el
  rol viejo (`profiles.role` = `cashier` o `admin`); un mozo no entra a `/m`.
- **El turno se abre antes**, desde el escritorio (o desde el celular: Menú → Versión
  completa → Ventas → abrir turno). `/m` no abre ni cierra turnos; sin turno muestra
  "Sin turno" y no deja cobrar. El turno es de la sede: lo comparten todos los teléfonos.
- Para el punto 7, el QR de Nequi subido en Configuración.
- **iPhone instalado y la protección de Vercel:** en iPhone, la app agregada a la
  pantalla de inicio tiene sus PROPIAS cookies, separadas de Safari. Si la vista previa
  pide iniciar sesión en Vercel, puede volver a pedirlo dentro de la app instalada. Si
  pasa, anotarlo en el punto 3 (no es un fallo de G-Vento).

## Lista (marcar en cada teléfono)

| # | Qué hacer | Qué tiene que pasar | iPhone | Android |
|---|---|---|---|---|
| 1 | Entrar con el usuario de caja | Cae directo en **Vender** (`/m`), sin el menú lateral del escritorio | ☐ | ☐ |
| 2 | **Instalar** | Android: aparece "Instalá Vender…" con botón **Instalar** → queda el ícono en la pantalla de inicio. iPhone: aparece UNA vez "Compartir → Agregar a inicio"; tras cerrarla y recargar, no vuelve | ☐ | ☐ |
| 3 | Abrir desde el ícono instalado | Abre sin barra del navegador, en **Vender**, con el nombre "Vender" — **nunca** "Cocina KDS". 🔴 Si lo agregaste ANTES del arreglo del 2026-10-05, borrá ese ícono y agregalo de nuevo desde `/m`: el teléfono guardó el manifest viejo y no lo actualiza solo | ☐ | ☐ |
| 4 | Dejar el teléfono quieto en Vender 2–3 min (más que el apagado automático) | La pantalla **no se apaga**. Si se apaga, tiene que haber una franja amarilla "La pantalla se puede apagar sola" (en iPhone instalado puede pasar según la versión de iOS: anotar versión) | ☐ | ☐ |
| 5 | Mirar el borde de abajo con el carrito lleno y en la pantalla de cobro | El botón verde **Cobrar** y los de **Efectivo / Nequi** quedan enteros, se tocan, y **no los tapa nada**: ni la barra de inicio (iPhone), ni los botones del sistema (Android), ni **nuestra barra inferior** (Vender / Mis ventas / Menú), ni los avisos. Revisar en: carrito, cobro en efectivo, cobro en Nequi, extras y venta exitosa | ☐ | ☐ |
| 6 | Efectivo → tocar "¿Con cuánto paga?" | Sale el teclado **numérico**, y el botón **Cobrar** queda **visible arriba del teclado** (no tapado) | ☐ | ☐ |
| 7 | Nequi con QR | El QR se ve grande y nítido; un teléfono de cliente lo escanea | ☐ | ☐ |
| 8 | Vender con poca luz (brillo bajo) | Se leen nombres, precios y el total sin esfuerzo; los botones se aciertan con el pulgar | ☐ | ☐ |
| 9 | **Dos o tres teléfonos a la vez**, mismo turno, cada uno con su usuario | Cada uno cobra sin trabarse; en **Mis ventas** cada uno ve SOLO lo suyo, y las cifras suman lo del arqueo | ☐ | ☐ |
| 10 | Modo avión justo al tocar **Cobrar**, volver a conectar y tocar de nuevo | Una sola venta (si la primera había entrado, dice "ya se había registrado") | ☐ | ☐ |
| 11 | Girar el teléfono | Sigue usable (el manifest pide vertical en la app instalada) | ☐ | ☐ |
| 12 | Menú → **Versión completa** | Abre el escritorio y no vuelve solo a Vender en esa pestaña | ☐ | ☐ |
| 13 | Tocar un producto con **extras** | Sube una hoja oscura desde abajo; los + / − se aciertan con el pulgar; **Agregar** queda arriba de la barra de inicio; el extra aparece en el carrito, y después en la venta (Historial, desde el escritorio) | ☐ | ☐ |
| 14 | **Login** con la sesión cerrada (Menú → Cerrar sesión) | Sin zoom al tocar los campos; el correo abre el teclado de correo, sin mayúscula inicial; el teléfono **ofrece la contraseña guardada** (iCloud / Google) y la completa; el ojo muestra y oculta la clave; con el teclado abierto, **Ingresar** se ve y se toca; con datos malos, el error se lee completo; al entrar cae en **Vender** | ☐ | ☐ |
| 15 | **App instalada**: Menú → **Cerrar sesión** | El login aparece **dentro de la app**, sin barra del navegador ni hoja de Safari (es `/m/login`); al entrar vuelve a **Vender** sin salir de la app. Repetirlo cerrando la app con la sesión vencida (o borrando los datos del sitio): al abrirla, el login también sale dentro de la app | ☐ | ☐ |

**Anotar por teléfono:** modelo, versión de iOS/Android y del navegador. Si algo falla,
una captura y el número de punto.
