# G-Vento · Pedidos en línea — plan de trabajo

*10/10/2026 · Piloto: Salchimelo · Diseño aprobado: lienzo "G-Vento · Pedidos en línea" (8 pantallas)*

## Qué es

Un portal público por negocio (`pedir.gvento.online/<negocio>`) donde el cliente arma su pedido, pone sus datos y su ubicación, y **paga completo con Factus Pay**. El pedido pagado entra solo a Domicilios en G-Vento, el negocio lo prepara y lo asigna, y el domiciliario lo entrega desde su usuario en el celular. El objetivo es sacar la toma de pedidos de WhatsApp.

## Decisiones tomadas

| tema | decisión |
|---|---|
| Cliente | Sin registro. Pide como invitado; casilla "Recordar mis datos en este celular" (solo en su teléfono). El negocio lo reconoce por celular, solo internamente. |
| Pago | Completo y por adelantado con Factus Pay (Bre-B: Nequi, Bancolombia, Daviplata y demás bancos). El cliente copia la llave Bre-B en la app de su banco, o usa el QR desde otro celular. Monto exacto, mínimo $1.000. Cada negocio con su propia cuenta Factus Pay (confirmado). Costo: $800 + IVA por recaudo y $800 + IVA por retiro; el retiro llega al instante. |
| Aceptación | Pagado = entra directo a "En preparación". Si no se entrega, el negocio le devuelve la plata a su cliente. |
| Envío | Tarifa fija o por distancia (rangos de km en línea recta). |
| Zona | Zona de cobertura dibujada en el mapa (o radio). Fuera de zona no deja pagar. Lo valida el servidor. |
| Horario | Recibe pedidos solo con turno abierto y dentro del horario; botón "Pausar pedidos". |
| Precios | Mismos productos y stock del POS; precio a domicilio opcional por producto. |
| Promociones | Combo a precio fijo, precio especial, % de descuento y envío gratis desde un monto, con fechas. |
| Domiciliario | Usuario propio: sus domicilios activos, ruta ordenada (abre Google Maps), WhatsApp y llamada al cliente, "Entregado". |
| Factura electrónica | No, por ahora. |
| Cierre de caja | Los pagos en línea aparecen aparte ("Pago en línea"), fuera del efectivo. |

## Reglas que no se negocian

1. **El portal es la primera parte pública de G-Vento.** Antes de abrirlo, el rol público (`anon`) no puede escribir en ninguna tabla. Hoy puede en 29.
2. **El precio, el envío, la zona y las promociones los calcula el servidor.** El navegador solo dice qué quiere el cliente.
3. **Un pedido solo existe para el negocio cuando el pago está confirmado** por un webhook firmado. Antes de eso no descuenta stock ni suena en Domicilios.
4. **Todo es idempotente:** crear el pedido, confirmar el pago y cada cambio de estado se pueden repetir sin duplicar nada (lo que aprendimos con los reenvíos de Chromium).
5. **Las credenciales de Factus Pay de cada negocio** se guardan en el servidor (Vault) y nunca llegan al navegador. Al conectar, el dueño escribe su correo y contraseña de Factus Pay una sola vez: el servidor obtiene el token (no vence, pero cada nueva autenticación revoca el anterior) y descarta la contraseña. Si el token deja de servir, la configuración muestra "Reconectar". G-Vento le da al negocio una URL y una llave de aviso para pegar en su panel de Factus Pay.

## Fases

| fase | qué incluye | SQL en prod | sesiones | depende de |
|---|---|---|---|---|
| **P0 · Prerrequisitos** | **P0.1** Factus Pay: documentación, sandbox, modelo multi-negocio, webhooks, devoluciones (Alejandro). **P0.2** Cerrar escrituras de `anon` en las 29 tablas, junto con el Paso 11 del plan de Mesas (un solo barrido, R3), con un test que lo vigile. **P0.3** Dominio `pedir.gvento.online` en Vercel, entrada `pedido.html` (como `/m` y `/cocina`), Edge Function para el webhook, Vault para secretos. | sí (P0.2) | 2–3 | Mesas Paso 10 |
| **P1 · Datos y configuración** | Ubicación de la sede; configuración del portal (link, color, horario, pausa, zona, envío, mínimo, tiempo); producto publicado + precio a domicilio; RPC de configuración (patrón `update_restaurant_config`). Pantallas 4 y 5 sin promociones. Permiso `pedidos_online.gestionar`. | sí | 2 | P0.2, A (permisos) |
| **P2 · Portal del cliente** | Lectura pública por RPC (`portal_catalogo(slug)`: solo lo publicado); menú, carrito, checkout, ubicación + pin, zona, "Recordar mis datos"; RPC `portal_cotizar` (precios, envío y zona desde el servidor); pantalla fuera de zona; protección anti-abuso (límite por IP y Turnstile). Pantallas 1, 2 y 2b. | sí | 3 | P1 |
| **P3 · Pago** | `portal_crear_pedido` idempotente ("esperando pago") → recaudo en Factus Pay con `reference_code` = id del pedido, `expiration` ≈ 15 min; pantalla de pago (2c) con la llave Bre-B para copiar, QR descargable, "Esperando tu pago…" que consulta sola y "Generar nueva llave" si vence (misma referencia y monto). Webhook de Factus (solo avisa "paid", con llave en la URL): se compara la llave en tiempo constante y **se confirma consultando el recaudo a Factus** (estado `paid` y monto exacto) antes de `portal_confirmar_pago` (pagado, descuenta stock, crea el domicilio, registra el pago en línea en el turno). Idempotente por `reference_code`; responde 200 solo después de guardar. Consulta de respaldo si el aviso no llega (6 reintentos). Seguimiento con link no adivinable (pantalla 3). | sí | 2–3 | P0.1, P2 |
| **P4 · Recepción en G-Vento** | Domicilios: tarjetas "EN LÍNEA · PAGADO", aviso sonoro hasta que se abre, refresco automático (o Realtime), imprimir comanda, asignar domiciliario, estados que ve el cliente. Cierre de caja con "Pago en línea" aparte (R1 con el arreglo de abonos). Pantalla 6. | sí | 2 | P3, refresco de Cocina/Mesas/Delivery |
| **P5 · Domiciliario** | Rol "domiciliario" (solo sus domicilios); "Mis domicilios" dentro de `/m`; ruta ordenada por cercanía y link a Google Maps con paradas; WhatsApp con mensaje prellenado y llamada; "Entregado" y "Cobré y entregué" (contra entrega). Pantalla 7. | sí | 2 | P4, A |
| **P6 · Promociones** | Combo, precio especial, %, envío gratis; vigencia por fechas y días; aplicadas solo en el servidor; se ven en el portal y en la pantalla 5. | sí | 1–2 | P2 |
| **P7 · Piloto Salchimelo** | Política de datos (Ley 1581) y términos; cuenta Factus Pay de Salchimelo (su trámite); carga del catálogo, zona y precios; QR y link para su WhatsApp e Instagram; capacitación; 2 semanas de piloto con seguimiento. | — | 1 | P0–P5 (P6 opcional) |

**Total estimado:** 15 a 18 sesiones de Claude Code, más tu revisión y los pasos en producción.

**Cómo se publica:** igual que hasta ahora. Una cosa por día, en la ventana de 7:00 a 14:00, el SQL los martes (G-10 y Salchimelo no abren), pre-flight antes y verificación con `demo@demo.com`. El portal sale apagado: se prende por negocio desde Configuración cuando el piloto esté listo.

## P2 · cómo se publica el servidor (partes 1 y 2, 2026-10-15)

Nada de esto lo ve un cliente hasta que exista la pantalla del portal y un negocio lo publique.

1. **SQL (un martes, después de P1):** consultas 1 y 2 de `supabase/diag/portal-publico-preflight.sql`
   → `supabase/portal-publico.sql` → consultas 1 y 3. Reversa: `portal-publico-revertir.sql` (raíz,
   fuera de git), después de borrar la función.
2. **Secretos de la función** (una sola vez, desde la carpeta del repo):
   ```bash
   supabase secrets set --project-ref <ref> PORTAL_SAL=$(openssl rand -hex 32) \
     PORTAL_ORIGENES=https://pedir.gvento.online,https://g-vento.vercel.app
   ```
   Opcional, para las vistas previas de Vercel: `PORTAL_PREVIEW_SUFIJO=-<equipo>.vercel.app`.
3. **Desplegar:** `supabase functions deploy portal --no-verify-jwt --project-ref <ref>`.
4. **Verificar** (sin negocio publicado responde `{"disponible":false}`):
   - `curl -s -d '{"accion":"catalogo","slug":"no-existe"}' https://<ref>.supabase.co/functions/v1/portal`
     → `{"disponible":false}`;
   - con `-H "Origin: https://evil.example"` → **403**;
   - con `-H "Origin: https://g-vento.vercel.app"` → `access-control-allow-origin: https://g-vento.vercel.app`
     (en local no se puede medir: ver DEUDAS → *"Portal público (P2)"*);
   - `-d '{"accion":"catalogo","slug":"x","total":1}'` → **400** "Clave no permitida: total.".
5. **Quitar:** `supabase functions delete portal --project-ref <ref>` y, si se quiere, la reversa del SQL.
6. **Logs (lo mides tú al publicar, decidido el 2026-10-15).** Cada consulta del portal hace 3
   peticiones: la función, el contador y la consulta a la base. Lo esperado son **3 líneas de log por
   consulta**: una invocación en Logs → Edge Functions y dos peticiones en Logs → API.
   - **Cómo medirlo:** anota la hora, haz 10 consultas seguidas con el `curl` del paso 4 (catálogo de
     un slug que no existe) y cuenta las líneas nuevas de ese minuto. En Edge Functions cuenta solo las
     invocaciones: las líneas de arranque y apagado de la función (más en un arranque en frío) son de
     la plataforma, no de cada consulta. Después compara en Usage la ingesta de logs del día con la
     de un día normal.
   - **Aceptable:** hasta **3 líneas y 10 KB de log por consulta**, y el portal en total **hasta
     300 MB de ingesta al mes** (lo que sube Usage frente a un día normal, por 30). Con el piloto (unos
     50 pedidos al día y unas 10 consultas por pedido, entre catálogo y cotizaciones) serían unas
     45.000 líneas y unos 150 MB al mes: es un cálculo, no una medición. Ojo: la ingesta de todo el
     proyecto ya pasó el GB del plan (2,58 GB el 2026-09-30), así que el portal suma sobre eso.
   - **Requisito de la parte 4** (todavía no existe): el navegador cotizará solo al cambiar la
     dirección o el carrito en el checkout, nunca en cada clic.
   - **Si se pasa** (más de 3 líneas o 10 KB por consulta, o más de 300 MB al mes), en este orden:
     1. juntar el contador y la consulta en una sola llamada a la base (una función que cuente y
        responda): baja a 2 líneas por consulta;
     2. guardar el catálogo en la memoria de la función 30 s por negocio: la mayoría de las visitas no
        llegan a la base. Costo: "pausado" o "agotado" se ven hasta 30 s tarde en el menú; cotizar
        igual valida contra la base, así que nadie paga algo que no se puede vender;
     3. si aun así se pasa, el portal no se abre a más negocios hasta resolverlo.
   - **Si un log trae la IP del cliente** en los encabezados (lo que no se pudo medir en local), se
     anota en DEUDAS y se revisa con la política de datos (Ley 1581) antes del piloto.

## P2 · el dominio del portal (parte 3, 2026-10-15)

`pedido.html` sale con el frontend. Sin el SQL de P2 y la Edge Function desplegada, el portal no
puede cargar nada y dice "No hay conexión…" o "No pudimos atender tu consulta…": por eso la
verificación del paso 3 va DESPUÉS de publicar el servidor de P2 (partes 1 y 2). Lo sirven
`/pedir/<negocio>` en `g-vento.vercel.app` y en las vistas previas, y TODO `pedir.gvento.online`:
ahí no se sirve el POS (`/m`, `/login` o `/cocina` abren el portal, y `/`, `/index.html`,
`/movil.html` y `/cocina.html` se redirigen a `/_inicio`, que también es el portal).

0. **Antes:** `nslookup -type=NS gvento.online` → tienen que salir los servidores de GoDaddy
   (`…domaincontrol.com`); si son otros, el registro va donde digan esos. `nslookup -type=CAA
   gvento.online` → si sale algún registro CAA, tiene que permitir `letsencrypt.org` (el certificado de
   Vercel); si no sale nada, no hay restricción. (En Windows, si `nslookup` no entiende `CAA`:
   `Resolve-DnsName gvento.online -Type CAA` en PowerShell.)
1. **Vercel:** proyecto → Settings → Domains → agregar `pedir.gvento.online`. Vercel muestra el
   registro que espera. Agregar el dominio funciona en Hobby; el paso a Pro antes de abrir el portal a
   clientes es decisión tuya (el uso comercial).
2. **GoDaddy** (DNS de `gvento.online` → Agregar registro):

   | campo | valor |
   |---|---|
   | Tipo | `CNAME` |
   | Nombre | `pedir` |
   | Valor | `cname.vercel-dns.com` (si el panel de Vercel muestra otro valor para este proyecto, usa ese) |
   | TTL | 1 hora |

   No toques los registros de `@` ni de `www`.
3. **Verificar** (cuando Vercel marque el dominio como válido y emita el certificado):
   - `nslookup pedir.gvento.online` → responde con direcciones de Vercel;
   - `https://pedir.gvento.online/no-existe` → "Este negocio no está recibiendo pedidos en línea";
   - `https://pedir.gvento.online/` (en el navegador) → "Para pedir, abre el link que te compartió el
     negocio", NO el login del POS;
   - `https://pedir.gvento.online/m` → "Este link no corresponde a ningún negocio" (es el portal), NO
     el login del POS. Si sale el
     login, la regla `has: host` de `vercel.json` no se aplicó (hay un reporte en el foro de Vercel:
     https://community.vercel.com/t/vercel-json-the-has-condition-on-host-doesnt-seem-to-work/9863):
     avísame y la paso a un middleware de Vercel, que también funciona en Hobby;
   - `curl -sI https://pedir.gvento.online/` → un 307 con `location: /_inicio` (lo mismo con
     `/index.html`, `/movil.html` y `/cocina.html`): en ese dominio el POS no se sirve. Si `/` NO
     redirige y abre el login, la regla no alcanzó: avísame (la salida es un middleware de Vercel);
   - `https://g-vento.vercel.app/pedir/no-existe` → el mismo mensaje.
4. **Quitar:** borrar el dominio en Vercel y el registro en GoDaddy. El frontend puede quedarse.

## Lo que hace falta de tu lado

- [x] Documentación de Factus Pay y respuestas a las dudas (13/10): devuelve la llave Bre-B, mínimo $1.000, estados `ready`/`paid`, vencimiento en segundos, 6 reintentos, una cuenta por negocio, retiro inmediato.
- [ ] Acceso al sandbox de Factus Pay (se enviaron los datos de registro).
- [ ] Pedir la URL base de producción de Factus Pay.
- [ ] Hablar con Salchimelo: que abra su cuenta de Factus Pay, la ubicación exacta del local, la zona, las tarifas, los productos a publicar y quiénes son sus domiciliarios.
- [ ] Definir si "Pedidos en línea" se cobra aparte (adicional al plan) o va incluido en el plan Profesional.
- [ ] Texto de la política de datos y los términos (puede partir de una plantilla; conviene que lo revise un abogado).

## Riesgos

- **Factus Pay:** el aviso de pago no viene firmado (solo una llave en la URL) y no hay devoluciones por API. Se mitiga confirmando cada pago contra la API de Factus antes de darlo por bueno, y con la política de que las devoluciones las hace el negocio. El pago queda desacoplado para poder cambiar de proveedor.
- **Pagos con tarjeta:** Bre-B no cubre tarjetas de crédito. Para el público de domicilios de barrio casi todos pagan con Nequi o con su banco; si un negocio pide tarjeta, se evalúa un segundo medio.
- **Ubicación del cliente:** el GPS del celular a veces falla o el cliente lo niega. Por eso hay pin ajustable, dirección escrita e indicaciones.
- **Diciembre:** temporada alta. Si el piloto se corre a diciembre, que arranque la primera semana o se pase a enero, para no estrenar un flujo de pago en el pico.
- **Soporte:** un portal público trae preguntas de clientes finales. El link de WhatsApp del local va en el seguimiento y en el aviso de fuera de zona, para que no te escriban a ti.
