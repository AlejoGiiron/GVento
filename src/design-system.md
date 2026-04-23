# G-Vento Design System
Valores exactos extraídos del handoff de Claude Design (Login V1 + POS V2 aprobados).
Usar estos valores en cualquier pantalla nueva para mantener coherencia visual.

---

## 1. Paleta de colores

### Acento — Verde esmeralda (brand)
| Token            | Hex / valor                                    | Uso                                      |
|------------------|------------------------------------------------|------------------------------------------|
| green-primary    | `#10b981`                                      | Botones CTA, active nav, checkbox, toggle |
| green-dark       | `#059669`                                      | Gradiente logo, texto verde medio        |
| green-gradient   | `linear-gradient(135deg, #10b981, #059669)`    | Logo mark, badge                         |
| green-bg         | `#ecfdf5`                                      | Fondos éxito, active pill, chip          |
| green-border     | `#a7f3d0`                                      | Bordes pill turno, chips                 |
| green-text-dark  | `#065f46`                                      | Texto sobre fondo verde claro            |
| green-text-light | `#6ee7b7`                                      | Texto en panel oscuro (login brand)      |
| green-subtle-bg  | `rgba(16,185,129,.12)`                         | Ícono features panel, hover suave        |
| green-subtle-bd  | `rgba(16,185,129,.22)` / `.30`                 | Bordes sutiles en oscuro                 |
| green-glow       | `rgba(16,185,129,.35)`                         | box-shadow botones primarios             |
| green-glow-lg    | `rgba(16,185,129,.18)` / `.10`                 | Radial glows login panel                 |

### Slate — Escala principal
| Token          | Hex       | Tailwind equiv | Uso                                  |
|----------------|-----------|----------------|--------------------------------------|
| slate-950      | `#0f172a` | slate-900      | Sidebar bg, texto primario, overlay  |
| slate-800      | `#1e293b` | slate-800      | Bordes sidebar, hover sidebar        |
| slate-700      | `#334155` | slate-700      | Texto secundario, avatar sidebar     |
| slate-600      | `#475569` | slate-600      | Totals row label                     |
| slate-500      | `#64748b` | slate-500      | Texto muted, subtítulos, labels      |
| slate-400      | `#94a3b8` | slate-400      | Placeholders, texto deshabilitado    |
| slate-300      | `#cbd5e1` | slate-300      | Texto sutil sidebar, bordes light    |
| slate-200      | `#e2e8f0` | slate-200      | Bordes input, separadores            |
| slate-100      | `#f1f5f9` | slate-100      | Texto sidebar activo, fondos hover   |
| slate-050      | `#f8fafc` | slate-50       | Fondo app, POS left panel            |
| white          | `#fff`    | white          | Paneles, cards, formularios          |

### Error / Alerta
| Token         | Hex       | Uso                                  |
|---------------|-----------|--------------------------------------|
| error-bg      | `#fef2f2` | Fondo banner error, vuelto insuf.    |
| error-border  | `#fecaca` | Borde banner error                   |
| error-text    | `#991b1b` | Título error                         |
| error-text-md | `#b91c1c` | Cuerpo error                         |
| error-icon    | `#dc2626` | Ícono X error, descuento row         |
| error-input   | `#ef4444` | Borde input en estado error          |

### Otros semánticos
| Token       | Hex       | Uso                          |
|-------------|-----------|------------------------------|
| amber-badge | `#f59e0b` | Badges numéricos en sidebar  |
| amber-bg    | `#fef3c7` | Notas de ítem (sticky note)  |
| amber-text  | `#854d0e` | Texto nota ítem              |

### Colores de categorías (POS coctelería)
| Categoría        | Color     | Fondo     |
|------------------|-----------|-----------|
| Cocteles c/licor | `#d97706` | `#fef3c7` |
| Cocteles s/licor | `#059669` | `#d1fae5` |
| Sodas Italianas  | `#2563eb` | `#dbeafe` |
| Vaso Michelado   | `#db2777` | `#fce7f3` |
| Adiciones        | `#7c3aed` | `#ede9fe` |
| Otras Bebidas    | `#0891b2` | `#cffafe` |

### Colores de tipo de orden
| Tipo        | Bg        | Fg        |
|-------------|-----------|-----------|
| Mesa        | `#ecfdf5` | `#065f46` |
| Para llevar | `#fef3c7` | `#854d0e` |
| Delivery    | `#dbeafe` | `#1e40af` |

---

## 2. Tipografía

### Familias
```
UI principal:  'Inter, system-ui, sans-serif'
Monospace:     'JetBrains Mono, monospace'  ← handoff
               fontFamily: 'monospace'      ← implementación (fallback)
Precios/nums:  siempre monospace
```

### Escala de tamaños y pesos

#### Login — Panel marca (izquierdo `#0f172a`)
| Elemento           | Size    | Weight | Color     | Notas               |
|--------------------|---------|--------|-----------|---------------------|
| Logo nombre        | 18px    | 700    | `#f8fafc` | letterSpacing -0.3  |
| Logo sub           | 11.5px  | 400    | `#64748b` |                     |
| Restaurant pill    | 11.5px  | 600    | `#6ee7b7` | letterSpacing 0.3   |
| H1 headline        | 38px    | 800    | `#f8fafc` | letterSpacing -1.2, lh 1.05 |
| H1 acento verde    | 38px    | 800    | `#10b981` |                     |
| Body copy          | 14px    | 400    | `#94a3b8` | lh 1.55             |
| Feature items      | 13px    | 400    | `#cbd5e1` |                     |
| Footer             | 11.5px  | 400    | `#64748b` |                     |

#### Login — Formulario (derecho `#fff`)
| Elemento           | Size    | Weight | Color     | Notas               |
|--------------------|---------|--------|-----------|---------------------|
| Supertítulo        | 11px    | 600    | `#10b981` | uppercase, ls 1.2   |
| H2 título          | 26px    | 700    | `#0f172a` | letterSpacing -0.8  |
| Subtítulo          | 13.5px  | 400    | `#64748b` | lh 1.5              |
| Field label        | 12px    | 600    | `#334155` |                     |
| Input text         | 14px    | 400    | `#0f172a` |                     |
| Checkbox label     | 13px    | 500    | `#334155` |                     |
| Botón submit       | 14px    | 700    | `#fff`    |                     |
| Error título       | 12.5px  | 600    | `#991b1b` |                     |
| Error cuerpo       | 11.5px  | 400    | `#b91c1c` |                     |
| Footer ayuda       | 11.5px  | 400    | `#94a3b8` |                     |

#### Sidebar
| Elemento           | Size    | Weight | Color     |
|--------------------|---------|--------|-----------|
| Brand name         | 15px    | 700    | `#f1f5f9` |
| Section label      | 10.5px  | 600    | `#64748b` | uppercase, ls 1     |
| Nav item inactivo  | 13.5px  | 500    | `#cbd5e1` |
| Nav item activo    | 13.5px  | 600    | `#fff`    |
| User name          | 12.5px  | 600    | `#f1f5f9` |
| User role          | 11px    | 400    | `#64748b` |

#### Header
| Elemento           | Size    | Weight | Color     | Font      |
|--------------------|---------|--------|-----------|-----------|
| Page title         | 15px    | 700    | `#0f172a` | Inter     |
| Page subtitle      | 11.5px  | 400    | `#64748b` |           |
| Order type         | 12.5px  | 500/600| `#64748b`/`#0f172a` | |
| Turno nombre       | 11.5px  | 600    | `#065f46` |           |
| Turno hora         | 11px    | 400    | `#059669` |           |
| Clock              | 14px    | 600    | `#334155` | monospace |
| En línea           | 11.5px  | 500    | `#64748b` |           |

#### POS — Catálogo (izquierdo 60%)
| Elemento           | Size    | Weight | Color     | Font      |
|--------------------|---------|--------|-----------|-----------|
| Category tab       | 14px    | 500/700| `#64748b`/color | Inter |
| Section title      | 15px    | 700    | `#0f172a` | letterSpacing -0.3 |
| Product count      | 12px    | 400    | `#94a3b8` | monospace |
| Product name       | 14.5px  | 600    | `#0f172a` | letterSpacing -0.2 |
| Product desc       | 12px    | 400    | `#94a3b8` |           |
| Product price      | 16px    | 700    | `#0f172a` | monospace, ls -0.4 |

#### POS — Carrito (derecho 40%)
| Elemento           | Size    | Weight | Color     | Font      |
|--------------------|---------|--------|-----------|-----------|
| Order type label   | 15px    | 700    | `#0f172a` | letterSpacing -0.2 |
| Order subtitle     | 11.5px  | 400    | `#64748b` | monospace |
| Item name          | 14px    | 600    | `#0f172a` |           |
| Item precio unitario| 11.5px | 400    | `#94a3b8` | monospace |
| Item subtotal      | 14px    | 700    | `#0f172a` | monospace |
| Nota ítem          | 11.5px  | 500    | `#854d0e` |           |
| Discount label     | 11.5px  | 700    | `#334155` | uppercase, ls 0.5 |
| Total row label    | 12.5px  | 400    | `#475569` |           |
| Grand total        | 30px    | 700    | `#0f172a` | monospace, ls -0.8 |
| Cobrar button      | 15px    | 700    | `#fff`    | ls 0.2    |

#### Modal de cobro
| Elemento           | Size    | Weight | Color     | Font      |
|--------------------|---------|--------|-----------|-----------|
| Supertítulo        | 11px    | 600    | `#64748b` | uppercase, ls 0.5 |
| Monto total        | 28px    | 700    | `#0f172a` | monospace, ls -0.5 |
| Method label       | 11.5px  | 600    | `#334155` |           |
| Input efectivo     | 32px    | 700    | `#0f172a` | monospace, ls -0.5 |
| Quick amounts      | 11.5px  | 600    | `#334155` | monospace |
| Vuelto label       | 12.5px  | 600    | `#065f46` |           |
| Vuelto monto       | 22px    | 700    | `#065f46` | monospace |
| Botón continuar    | 13.5px  | 600    | `#fff`    |           |

---

## 3. Espaciado y geometría

### Border radius
| Uso                       | Valor  |
|---------------------------|--------|
| Cards de producto         | 14px   |
| Modal overlay card        | 14px   |
| Botón primario (CTA)      | 10px   |
| Botón secundario/outline  | 9px    |
| Input fields              | 10px (login) / 8px (POS) |
| Nav items sidebar         | 8px    |
| Logo mark grande          | 11px   |
| Logo mark pequeño         | 8px    |
| Badges circulares         | 100px  |
| Avatar usuario            | 50%    |
| Toggle / switch           | 7px    |
| Qty buttons               | 8px    |
| Notas pill                | 5px    |
| Icon buttons POS          | 7px    |

### Padding — componentes clave

#### Sidebar
```
width: 216px (handoff) / w-56 = 224px (Tailwind impl)
logo section: 20px 20px (handoff) / px-5 py-4 (AppLayout)
nav section:  10px 12px / px-2 py-3
nav item:     9px 10px  / px-3 py-2.5
gap items:    2px / space-y-0.5
user footer:  12px
```

#### Header
```
height: 60px (handoff) / h-14 = 56px (AppLayout)
horizontal padding: 0 20px (handoff) / px-6 (AppLayout)
```

#### Login
```
brand panel:    padding 40px 44px
form panel:     padding 40px 48px
form max-width: 400px, margin: 0 auto
input wrapper:  padding 11px 13px
submit button:  padding 13px 14px
gap campos:     marginTop 16-24px
```

#### POS — Catálogo
```
search area:       padding 18px 24px 4px
search bar:        padding 11px 14px, border-radius 10px
category tab:      padding 12px 16px 14px (active border-bottom 3px)
section header:    padding 16px 24px 8px
grid container:    padding 4px 24px 24px
grid gap:          14px
grid cols:         repeat(3, 1fr)
product card body: padding 12px 14px 14px
product img h:     140px
```

#### POS — Carrito
```
cart header:     padding 18px 22px 14px
item row:        padding 14px 22px
item color bar:  width 4px, border-radius 2px
discount:        padding 12px 22px
totals:          padding 10px 22px
cobrar footer:   padding 16px 22px 20px
```

#### Modal de cobro
```
overlay:     position absolute, inset 0, z-index 50
card width:  480-540px, max-width 92%
header:      padding 18px 22px
body:        padding 22px
quick amts:  padding 6px 10px, border-radius 6px
action row:  gap 10px, flex ratio 1:2
```

---

## 4. Sombras y efectos

```css
/* Botón primario verde */
box-shadow: 0 6px 16px rgba(16,185,129,.35);

/* Card hover */
box-shadow: 0 8px 20px rgba(0,0,0,.06);

/* Modal */
box-shadow: 0 25px 50px -12px rgba(0,0,0,.25);

/* Logo mark grande (login) */
box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset, 0 8px 20px rgba(16,185,129,.25);

/* Logo mark small (sidebar) */
box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset;

/* Success avatar ring */
box-shadow: 0 0 0 8px rgba(16,185,129,.08);

/* Online dot ring */
box-shadow: 0 0 0 3px rgba(16,185,129,.2);

/* Radial glow login (top-left) */
background: radial-gradient(circle, rgba(16,185,129,.18) 0%, transparent 60%);
  position: absolute; top: -20%; left: -10%; width: 460px; height: 460px;

/* Radial glow login (bottom-right) */
background: radial-gradient(circle, rgba(16,185,129,.10) 0%, transparent 60%);
  position: absolute; bottom: -15%; right: -10%; width: 380px; height: 380px;
```

### Transiciones
```css
default:    transition: all .15s;
background: transition: background .12s;
border:     transition: border .12s;
Tailwind:   transition-colors (class)
```

---

## 5. Patrones de layout

### Login (pantalla completa)
```
Outer:  display flex, height 100%, overflow hidden
  Left (brand):
    flex: 0 0 40%
    background: #0f172a
    padding: 40px 44px
    position: relative (para glows absolutos)
    display: flex flex-col
    Structure: Logo → mid (flex 1, justify center) → footer

  Right (form):
    flex: 1
    background: #fff
    padding: 40px 48px
    Structure: top-right help → center (flex 1, max-w 400px) → footer
```

### AppLayout
```html
<!-- Tailwind exact classes -->
<div class="flex h-screen overflow-hidden bg-white">
  <aside class="w-56 flex-shrink-0 bg-slate-900 flex flex-col">
    <!-- logo: px-5 py-4 border-b border-slate-700/60 -->
    <!-- nav:  flex-1 px-2 py-3 space-y-0.5 overflow-y-auto -->
    <!-- item activo: bg-slate-700 text-white -->
    <!-- item inact:  text-slate-400 hover:bg-slate-800 hover:text-slate-100 -->
    <!-- footer: p-2 border-t border-slate-700/60 -->
  </aside>
  <div class="flex-1 flex flex-col min-w-0">
    <header class="h-14 flex-shrink-0 flex items-center justify-between
                   px-6 border-b border-slate-200 bg-white">
    </header>
    <main class="flex-1 overflow-hidden bg-white">
      <!-- page content fills remaining height -->
    </main>
  </div>
</div>
```

> **Nota:** El handoff usa `background: #10b981` para el nav item activo.
> La implementación usa `bg-slate-700`. Para nuevas pantallas seguir la implementación (`bg-slate-700`).

### POS (dentro de `<main>`)
```
Outer: flex h-full overflow-hidden  (position: relative para el modal)
  Left catalog (60%):
    flex: 0 0 60%
    display: flex flex-col
    background: #fafafa
    Structure:
      1. Top bar (search + tabs): bg #fff, border-bottom 1px #f1f5f9
      2. Section header: padding 16px 24px
      3. Grid area: flex 1, overflow auto

  Right cart (40%):
    flex: 1
    background: #fff
    border-left: 1px solid #e5e7eb
    display: flex flex-col
    Structure:
      1. Header (order type + clear): border-bottom #f1f5f9
      2. Items list: flex 1, overflow auto
      3. Discount: border-top #f1f5f9
      4. Totals: border-top #f1f5f9
      5. Footer (total + cobrar): bg gradient #f8fafc→#fff, border-top #e5e7eb
```

---

## 6. Componentes clave

### Botón primario (CTA verde)
```jsx
// Estado normal
{
  background: '#10b981',
  border: 'none',
  borderRadius: 10,
  padding: '13-15px 16px',
  fontSize: '14-15px', fontWeight: 700, color: '#fff',
  boxShadow: '0 6px 16px rgba(16,185,129,.35)',
  cursor: 'pointer',
}
// Estado disabled
{ background: '#cbd5e1', boxShadow: 'none', cursor: 'not-allowed' }
```

### Botón secundario (outline)
```jsx
{
  background: '#fff',
  border: '1.5px solid #e5e7eb',
  borderRadius: 9,
  padding: '12px 16px',
  fontSize: '13.5px', fontWeight: 600, color: '#334155',
  cursor: 'pointer',
}
```

### Input field (POS / modal)
```jsx
// Wrapper con ícono
{
  display: 'flex', alignItems: 'center', gap: 8,
  border: '1.5px solid #e5e7eb',  // → #10b981 on focus, #ef4444 on error
  borderRadius: 10,
  padding: '11px 13px',
  background: '#fff',
}
// Input interno
{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14 }
```

### Field label
```jsx
{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }
```

### Nav item (sidebar)
```jsx
// Clases Tailwind (implementación)
isActive
  ? 'bg-slate-700 text-white'
  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
// Base: flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
```

### Pill / badge de estado
```jsx
// Turno activo (verde)
{
  background: '#ecfdf5', border: '1px solid #a7f3d0',
  borderRadius: 8, padding: '6px 11px',
}
// Dot indicador
{ width: 6, height: 6, borderRadius: '50%', background: '#10b981',
  boxShadow: '0 0 0 3px rgba(16,185,129,.2)' }
```

### Supertítulo de sección
```jsx
// Patrón usado en modal y form
{ fontSize: 11, fontWeight: 600, color: '#10b981',   // o '#64748b'
  textTransform: 'uppercase', letterSpacing: 1.2 }
```

### Modal overlay
```jsx
{
  position: 'absolute', inset: 0,
  background: 'rgba(15,23,42,.55)',
  display: 'grid', placeItems: 'center',
  zIndex: 50,
}
// Card interna
{ background: '#fff', borderRadius: 14, width: 480-540, maxWidth: '92%',
  boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden' }
```

### Product card
```jsx
{
  background: '#fff', border: '1px solid #e5e7eb',
  borderRadius: 14, overflow: 'hidden',
  // hover: borderColor → category.color, transform translateY(-2px)
  //        boxShadow: '0 8px 20px rgba(0,0,0,.06)'
}
```

### Error banner (login)
```jsx
{
  background: '#fef2f2', border: '1px solid #fecaca',
  borderRadius: 9, padding: '11px 13px',
  display: 'flex', alignItems: 'flex-start', gap: 10,
}
```

---

## 7. Spinner de carga
```jsx
// CSS keyframe: @keyframes gv-spin { to { transform: rotate(360deg); } }
{
  width: 15, height: 15,
  border: '2px solid rgba(255,255,255,.3)',
  borderTopColor: '#fff',
  borderRadius: '50%',
  animation: 'gv-spin .8s linear infinite',
}
```

---

## 8. Reglas de uso

1. **Precios** — siempre `Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 })`, con fuente monospace.
2. **Fechas** — siempre `timeZone: 'America/Bogota'`.
3. **Strings UI** — en español de Colombia (Colombia, no España).
4. **Íconos** — `lucide-react`, `strokeWidth` default salvo indicado.
5. **Colores de categoría** — leer del campo `categories.color` en BD; nunca hardcodear para productos.
6. **IVA** — siempre desglosado y etiquetado como "incluido": `Math.round(total - total/1.19)`.
7. **Nuevas pantallas** — usar `flex h-full overflow-hidden` como raíz (AppLayout ya maneja `overflow-hidden`).
8. **Estilo mezclado** — el proyecto usa inline styles + Tailwind. Componentes de layout usan Tailwind; componentes de UI interactiva (POS, Login) usan inline styles para control granular.
