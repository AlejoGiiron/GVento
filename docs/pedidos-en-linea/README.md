# Pedidos en línea · diseño aprobado (13/10/2026)

Diseño hecho en el lienzo de diseño "G-Vento · Pedidos en línea". Es la referencia visual de lo que se construye; el plan de fases está en `docs/plan-pedidos-en-linea.md`.

## Pantallas (`pantallas/`)

| archivo | pantalla | fase |
|---|---|---|
| `1-cliente-menu.png` | Portal: menú del negocio, promo del día, carrito | P2 (promo: P6) |
| `2-cliente-datos-entrega.png` | Datos de entrega: pin en mapa, "Usar mi ubicación", dirección, indicaciones, nombre, celular, "Recordar mis datos", aceptación de datos | P2 |
| `2b-cliente-fuera-de-zona.png` | Dirección fuera de la zona: no deja pagar, botón de WhatsApp del local | P2 |
| `2c-cliente-pago-breb.png` | Pago con Bre-B: llave para copiar, QR opcional, "Esperando tu pago…", vencimiento | P3 |
| `3-cliente-seguimiento.png` | Seguimiento: estados, domiciliario, WhatsApp del local | P3–P4 |
| `4-negocio-configuracion.png` | Configuración › Pedidos en línea: estado + pausa, link y QR, color, horario, zona (radio o dibujada), envío (fijo o por distancia), pedido mínimo, tiempo, Factus Pay | **P1** (Factus Pay: P3) |
| `5-negocio-productos-promociones.png` | Productos en el portal (publicado, precio a domicilio, agotado, $0 no se publica) + promociones | **P1** (promociones: P6) |
| `6-negocio-domicilios.png` | Domicilios recibe el pedido "EN LÍNEA · PAGADO", asignar domiciliario | P4 |
| `7-domiciliario-ruta.png` | Mis domicilios: ruta en Google Maps, WhatsApp, llamada, Entregado / Cobré y entregué | P5 |

## Notas
- Los datos (Salchimelo, productos, precios, nombres, direcciones) son de ejemplo.
- El mapa es un dibujo: en P1 va Leaflet + OpenStreetMap.
- Estilo: el de G-Vento (barra lateral oscura, verde #047857 para acciones positivas). El portal del cliente toma el color de cada negocio.
- `fuente/` tiene el HTML de cada pantalla (formato del lienzo de diseño, necesita su runtime para verse igual). Úsalo para leer textos, tamaños y colores exactos; no se copia tal cual al código.
- Lo que manda en la lógica es el plan y el diseño técnico aprobado de P1, no el mock: por ejemplo, el estado "Recibiendo pedidos" sale de `portal_estado`.
