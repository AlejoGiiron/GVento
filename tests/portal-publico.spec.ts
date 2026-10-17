import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { ownerCreds } from './helpers/auth'
import { cliente, psql, psqlResultado } from './helpers/db-local'
import { otraCreds } from './helpers/storage'
import { claveLimite } from '../supabase/functions/portal/reglas'
import {
  CLAVES_CATALOGO, CLAVES_CATEGORIA, CLAVES_COTIZACION, CLAVES_ENTREGA, CLAVES_ESTADO, CLAVES_EXTRA, CLAVES_LINEA,
  CLAVES_NEGOCIO, CLAVES_PRODUCTO,
} from '../src/portal/claves'

// ============================================================================
// Pedidos en línea, P2 (supabase/portal-publico.sql + supabase/functions/portal):
// lo que ve y cotiza el cliente del portal.
//   · Solo service_role ejecuta las funciones del portal (anon y authenticated no).
//   · Catálogo: ALLOWLIST de campos (claves exactas) y solo lo publicado, activo y con precio.
//   · portal_calcular: el precio lo pone el servidor; extras con contraste (de otro producto, de
//     otra sede, inactivo); stock de todo el carrito (simples, recetas y productos vinculados);
//     zona, envío por tramos, mínimo y horario en hora de Bogotá (R7).
//   · Catálogo y cotización usan la MISMA regla de precio y de agotado (se comparan producto por
//     producto: R1 #14 a).
//   · La Edge Function: allowlist de acciones y claves, origen, tamaño, el error propio PT400 (los
//     demás salen genéricos), contador caído → 503, y el límite por IP (429) con la IP guardada
//     solo como el hash que calcula reglas.ts (R1 #14 b).
// ============================================================================

const SLUG = 'e2e-p2-lab'
const SLUG_OTRA = 'e2e-p2-otra'
// Centro de la zona y dos puntos: ~1,5 km al norte (tramo 2) y ~3 km al norte (fuera del radio de 2 km).
const CENTRO = { lat: 3.45, lng: -76.53 }
const A_1500 = { lat: 3.4635, lng: -76.53 }
const A_3000 = { lat: 3.477, lng: -76.53 }
const HORARIO_TODO_EL_DIA = Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((d) => [d, [['00:00', '12:00'], ['12:00', '00:00']]]))
const FN = () => `${process.env.VITE_GVENTO_SUPABASE_URL}/functions/v1/portal`

let SEDE = ''
let SEDE_OTRA = ''
let OWNER = ''
let TURNO_PROPIO = ''   // el turno que abre este spec si la sede no tenía uno (se borra al final)
const id: Record<string, string> = {}

const insertarId = (sql: string) => psql(sql).split(/\r?\n/)[0].trim()
const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`

type Linea = { product_id: string; cantidad: number; nombre: string | null; precio_unitario: number | null; total: number | null; problema: string | null; extras: { extra_id: string; cantidad: number; precio_unitario: number }[] }
type Cotizacion = { disponible: boolean; lineas: Linea[]; subtotal: number; envio: number | null; total: number | null; distancia_m: number | null; en_zona: boolean | null; falta_para_minimo: number; motivos: string[]; puede_pedir: boolean; estado: { recibe: boolean; motivo: string | null; abre_en: string | null } }

/** Como la Edge Function: rol service_role. */
const sinSet = (salida: string) => salida.split(/\r?\n/).filter((l) => l !== 'SET').join('\n').trim()
const comoServicio = (sql: string) => sinSet(psql(`set role service_role; ${sql}`))
const catalogo = (slug = SLUG) => JSON.parse(comoServicio(`select portal_catalogo('${slug}');`))
function cotizar(items: unknown, donde: { lat: number; lng: number } | null = CENTRO, ahora?: string): Cotizacion {
  const ub = donde ? `${donde.lat}, ${donde.lng}` : 'null, null'
  const t = ahora ? `, '${ahora}'::timestamptz` : ''
  return JSON.parse(comoServicio(`select portal_cotizar('${SLUG}', ${lit(items)}, ${ub}${t});`))
}
/** Para la FORMA inválida: stderr con el SQLSTATE (VERBOSITY verbose: "ERROR:  PT400: …"). */
function cotizarError(items: unknown, ub = `${CENTRO.lat}, ${CENTRO.lng}`): string {
  const r = psqlResultado(`\\set VERBOSITY verbose\nset role service_role; select portal_cotizar('${SLUG}', ${lit(items)}, ${ub});`)
  return r.status === 0 ? 'SIN ERROR' : r.stderr
}
/** La sal local de la función (la escribe pnpm e2e:preparar): para calcular el MISMO hash que ella. */
const SAL_LOCAL = () => {
  const m = readFileSync('supabase/functions/.env', 'utf-8').match(/^PORTAL_SAL=(\S+)/m)
  if (!m) throw new Error('Falta PORTAL_SAL en supabase/functions/.env: corre pnpm e2e:preparar')
  return m[1]
}
const linea = (product_id: string, cantidad: number, extras?: { extra_id: string; cantidad: number }[]) =>
  extras ? { product_id, cantidad, extras } : { product_id, cantidad }

function restablecer() {
  psql(`
    update public.portal_sedes set activo = false where restaurant_id = '${SEDE}';
    update public.portal_sedes set lat = ${CENTRO.lat}, lng = ${CENTRO.lng}, zona_tipo = 'radio', zona_radio_m = 2000,
           zona_poligono = null, envio_tipo = 'distancia', envio_fijo = null,
           envio_tramos = '[{"hasta_km": 1, "valor": 2000}, {"hasta_km": null, "valor": 4000}]',
           pedido_minimo = 15000, tiempo_min = 25, tiempo_max = 45, horario = ${lit(HORARIO_TODO_EL_DIA)},
           color = '#aa3300', whatsapp = '573155550101', pausado = false
     where restaurant_id = '${SEDE}';
    update public.portal_sedes set activo = true where restaurant_id = '${SEDE}';
    update public.products set stock_qty = 3 where id = '${id.gaseosa}';
    update public.products set stock_qty = 5 where id = '${id.pan}';
    update public.products set is_active = true where id = '${id.perro}';
    update public.extras set is_active = true where id = '${id.queso}';
    update public.categories set is_active = true where id in ('${id.cat}', '${id.cat2}');`)
}

test.beforeAll(async () => {
  const o = await cliente(ownerCreds()); SEDE = o.sede; OWNER = o.uid
  SEDE_OTRA = (await cliente(otraCreds())).sede
  expect(SEDE_OTRA).not.toBe(SEDE)
  psql(`delete from public.portal_productos where restaurant_id in ('${SEDE}', '${SEDE_OTRA}');
        delete from public.portal_sedes where slug in ('${SLUG}', '${SLUG_OTRA}') or restaurant_id in ('${SEDE}', '${SEDE_OTRA}');`)

  id.cat = insertarId(`insert into public.categories (name, restaurant_id, sort_order) values ('E2E P2 Comidas', '${SEDE}', 1) returning id;`)
  id.cat2 = insertarId(`insert into public.categories (name, restaurant_id, sort_order) values ('E2E P2 Bebidas', '${SEDE}', 2) returning id;`)
  id.catOtra = insertarId(`insert into public.categories (name, restaurant_id) values ('E2E P2 Ajena', '${SEDE_OTRA}') returning id;`)
  const prod = (nombre: string, precio: number, extra = '', sede = SEDE, cat = id.cat) => insertarId(
    `insert into public.products (name, price, restaurant_id, category_id${extra ? ', ' + extra.split('=')[0] : ''})
     values ('${nombre}', ${precio}, '${sede}', '${cat}'${extra ? ', ' + extra.split('=')[1] : ''}) returning id;`)
  id.perro = prod('E2E P2 Perro', 10000)
  id.gaseosa = insertarId(`insert into public.products (name, price, restaurant_id, category_id, stock_tracking, stock_qty)
     values ('E2E P2 Gaseosa', 3000, '${SEDE}', '${id.cat2}', true, 3) returning id;`)
  id.pan = insertarId(`insert into public.products (name, price, restaurant_id, category_id, stock_tracking, stock_qty)
     values ('E2E P2 Pan', 500, '${SEDE}', '${id.cat}', true, 5) returning id;`)
  id.combo = prod('E2E P2 Combo', 20000, `kind='composite'`)
  id.oculto = prod('E2E P2 Oculto', 5000)
  id.inactivo = prod('E2E P2 Inactivo', 5000, 'is_active=false')
  id.sinPrecio = prod('E2E P2 Sin precio', 0)
  id.ajeno = prod('E2E P2 Ajeno', 7000, '', SEDE_OTRA, id.catOtra)
  psql(`insert into public.product_components (restaurant_id, parent_id, component_id, qty) values ('${SEDE}', '${id.combo}', '${id.pan}', 2);`)

  const extra = (nombre: string, precio: number, sede = SEDE, mas = '') => insertarId(
    `insert into public.extras (name, price, restaurant_id${mas ? ', ' + mas.split('=')[0] : ''})
     values ('${nombre}', ${precio}, '${sede}'${mas ? ', ' + mas.split('=')[1] : ''}) returning id;`)
  id.queso = extra('E2E P2 Queso', 2000)
  id.tocineta = extra('E2E P2 Tocineta', 3000)              // de la sede, pero asignado SOLO a la gaseosa
  id.extraInactivo = extra('E2E P2 Salsa vieja', 1000, SEDE, 'is_active=false')
  id.extraAjeno = extra('E2E P2 Extra ajeno', 1500, SEDE_OTRA)
  id.panExtra = extra('E2E P2 Pan extra', 1000, SEDE, `linked_product_id='${id.pan}'`)
  // Al perro se le asignan TODOS (también el ajeno y el inactivo): la base los tiene que rechazar igual.
  psql(`insert into public.product_extras (product_id, extra_id) values
          ('${id.perro}', '${id.queso}'), ('${id.perro}', '${id.extraInactivo}'), ('${id.perro}', '${id.extraAjeno}'),
          ('${id.perro}', '${id.panExtra}'), ('${id.gaseosa}', '${id.tocineta}');`)

  psql(`insert into public.portal_sedes (restaurant_id, slug, horario) values ('${SEDE}', '${SLUG}', '{}'),
          ('${SEDE_OTRA}', '${SLUG_OTRA}', ${lit(HORARIO_TODO_EL_DIA)});
        insert into public.portal_productos (product_id, restaurant_id, publicado, precio_domicilio) values
          ('${id.perro}', '${SEDE}', true, 12000), ('${id.gaseosa}', '${SEDE}', true, null), ('${id.combo}', '${SEDE}', true, null),
          ('${id.oculto}', '${SEDE}', false, null), ('${id.inactivo}', '${SEDE}', true, null), ('${id.sinPrecio}', '${SEDE}', true, null),
          ('${id.ajeno}', '${SEDE_OTRA}', true, null);
        update public.portal_sedes set lat = ${CENTRO.lat}, lng = ${CENTRO.lng}, zona_tipo = 'radio', zona_radio_m = 2000,
               envio_tipo = 'fijo', envio_fijo = 3000, tiempo_min = 20, tiempo_max = 30, activo = true
         where restaurant_id = '${SEDE_OTRA}';`)
  restablecer()

  if (psql(`select count(*) from public.cash_shifts where restaurant_id = '${SEDE}' and closed_at is null;`) === '0') {
    TURNO_PROPIO = insertarId(`insert into public.cash_shifts (restaurant_id, opened_by, opening_amount) values ('${SEDE}', '${OWNER}', 0) returning id;`)
  }
  expect(cotizar([linea(id.perro, 2)]).estado.recibe, 'la sede tiene que recibir para las pruebas').toBe(true)
})

test.afterAll(() => {
  if (!SEDE) return
  psql(`
    delete from public.portal_sedes where restaurant_id in ('${SEDE}', '${SEDE_OTRA}');
    delete from public.portal_productos where restaurant_id in ('${SEDE}', '${SEDE_OTRA}');
    delete from public.portal_limites;
    delete from public.extras where name like 'E2E P2 %';
    delete from public.products where name = 'E2E P2 Combo';
    delete from public.products where name like 'E2E P2 %';
    delete from public.categories where name like 'E2E P2 %';
    ${TURNO_PROPIO ? `delete from public.cash_shifts where id = '${TURNO_PROPIO}';` : ''}`)
})

test.beforeEach(() => restablecer())

test.describe('Pedidos en línea · portal público (servidor)', () => {
  test('permisos: solo service_role ejecuta las funciones; el contador no se toca directo; anon no ejecuta nada DEFINER', async () => {
    const FUNCIONES = ['portal_catalogo(text,timestamptz)', 'portal_cotizar(text,jsonb,numeric,numeric,timestamptz)',
      'portal_calcular(uuid,jsonb,numeric,numeric,timestamptz)', 'portal_contar(text,integer)', 'portal_sede_de_slug(text)',
      'portal_proxima_apertura(uuid,timestamptz)', 'portal_estado_publico(uuid,timestamptz)',
      'portal_entero_entre(jsonb,integer,integer)', 'portal_uuid(jsonb)']
    expect(psql(`select string_agg(f || ':' || r || ':' || has_function_privilege(r, f::regprocedure, 'EXECUTE'), ',' order by f collate "C", r collate "C")
        from unnest(${`array[${FUNCIONES.map((f) => `'${f}'`).join(',')}]`}) f, unnest(array['anon', 'authenticated', 'service_role']) r;`))
      .toBe(FUNCIONES.slice().sort().flatMap((f) => [`${f}:anon:false`, `${f}:authenticated:false`, `${f}:service_role:true`]).join(','))
    expect(psql(`select string_agg(r || ':' || p, ',') from unnest(array['anon', 'authenticated']) r,
        unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p where has_table_privilege(r, 'public.portal_limites', p);`)).toBe('')
    expect(psql(`select string_agg(p.oid::regprocedure::text, ',') from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE');`)).toBe('')
    // Por la API, sin sesión y con sesión: rechazado. Contraste: el mismo catálogo como service_role sí responde.
    const owner = (await cliente(ownerCreds())).c
    const r = await owner.rpc('portal_catalogo', { p_slug: SLUG })
    expect(r.error?.message ?? '', 'authenticated no ejecuta el catálogo').toMatch(/permission denied/)
    expect(catalogo().disponible).toBe(true)
  })

  test('catálogo: ALLOWLIST de campos (claves exactas) y solo lo publicado, activo, con precio y de la sede', () => {
    const c = catalogo()
    // Las claves exactas, las mismas que los tipos del navegador (src/portal/claves.ts, R1 #14 a).
    expect(Object.keys(c).sort()).toEqual(CLAVES_CATALOGO)
    expect(Object.keys(c.negocio).sort()).toEqual(CLAVES_NEGOCIO)
    expect(Object.keys(c.estado).sort()).toEqual(CLAVES_ESTADO)
    expect(Object.keys(c.entrega).sort()).toEqual(CLAVES_ENTREGA)
    const cats = c.categorias.filter((x: { nombre: string }) => x.nombre.startsWith('E2E P2 '))
    expect(cats.map((x: { nombre: string }) => x.nombre), 'en el orden de la categoría').toEqual(['E2E P2 Comidas', 'E2E P2 Bebidas'])
    expect(Object.keys(cats[0]).sort()).toEqual(CLAVES_CATEGORIA)
    const prods = Object.fromEntries(cats.flatMap((x: { productos: { nombre: string }[] }) => x.productos).map((p: { nombre: string }) => [p.nombre, p]))
    expect(Object.keys(prods).sort(), 'ni el oculto, ni el inactivo, ni el de $0, ni el insumo sin publicar')
      .toEqual(['E2E P2 Combo', 'E2E P2 Gaseosa', 'E2E P2 Perro'])
    expect(Object.keys(prods['E2E P2 Perro']).sort()).toEqual(CLAVES_PRODUCTO)
    expect([prods['E2E P2 Perro'].precio, prods['E2E P2 Gaseosa'].precio], 'precio a domicilio o el del local').toEqual([12000, 3000])
    expect(prods['E2E P2 Perro'].extras.map((e: { nombre: string }) => e.nombre), 'ni el inactivo ni el de otra sede')
      .toEqual(['E2E P2 Pan extra', 'E2E P2 Queso'])
    expect(Object.keys(prods['E2E P2 Perro'].extras[0]).sort()).toEqual(CLAVES_EXTRA)
    expect(JSON.stringify(c)).not.toContain('E2E P2 Ajeno')
    expect(c.entrega.envio_desde).toBe(2000)
    expect(c.negocio.whatsapp).toBe('573155550101')
  })

  test('catálogo: agotado por stock propio, por receta y del extra vinculado (con contraste)', () => {
    const agotados = () => {
      const todos = catalogo().categorias.flatMap((x: { productos: unknown[] }) => x.productos) as
        { nombre: string; agotado: boolean; extras: { nombre: string; agotado: boolean }[] }[]
      const p = Object.fromEntries(todos.map((x) => [x.nombre, x]))
      return [p['E2E P2 Gaseosa'].agotado, p['E2E P2 Combo'].agotado,
        p['E2E P2 Perro'].extras.find((e: { nombre: string }) => e.nombre === 'E2E P2 Pan extra').agotado]
    }
    expect(agotados()).toEqual([false, false, false])
    psql(`update public.products set stock_qty = 0 where id = '${id.gaseosa}'; update public.products set stock_qty = 1 where id = '${id.pan}';`)
    expect(agotados(), 'gaseosa en 0; el combo necesita 2 panes y hay 1; el extra vinculado todavía tiene 1').toEqual([true, true, false])
    psql(`update public.products set stock_qty = 0 where id = '${id.pan}';`)
    expect(agotados()).toEqual([true, true, true])
  })

  test('sin publicar, incompleto o slug que no existe: catálogo y cotizar responden solo {disponible: false}', () => {
    const ambos = (slug = SLUG) => [catalogo(slug),
      JSON.parse(comoServicio(`select portal_cotizar('${slug}', ${lit([linea(id.perro, 2)])}, ${CENTRO.lat}, ${CENTRO.lng});`))]
    const NO = { disponible: false }
    psql(`update public.portal_sedes set activo = false where restaurant_id = '${SEDE}';`)
    expect([...ambos(), ...ambos('no-existe-e2e'), ...ambos(SLUG.toUpperCase() + ' ')]).toEqual([NO, NO, NO, NO, NO, NO])
    // Publicado pero incompleto (quedó sin tiempo de entrega por fuera de la RPC): tampoco.
    psql(`update public.portal_sedes set activo = true, tiempo_min = null, tiempo_max = null where restaurant_id = '${SEDE}';`)
    expect(ambos()).toEqual([NO, NO])
    psql(`update public.portal_sedes set tiempo_min = 25, tiempo_max = 45 where restaurant_id = '${SEDE}';`)
    expect(ambos(SLUG.toUpperCase() + ' ').map((x) => x.disponible), 'contraste: publicado y completo; el slug se normaliza')
      .toEqual([true, true])
  })

  test('catálogo y cotizar, producto por producto: el mismo precio y el mismo agotado (R1 #14 a)', () => {
    // Por cada producto y cada extra del catálogo: si no está agotado, cotizar 1 cobra EXACTAMENTE el
    // precio del catálogo; si está agotado, cotizar 1 da sin_stock. Devuelve las diferencias.
    const comparar = () => {
      const dif: string[] = []
      let vistos = 0; let agotados = 0
      for (const cat of catalogo().categorias) {
        for (const p of cat.productos) {
          vistos++
          const l = cotizar([linea(p.id, 1)]).lineas[0]
          if (p.agotado) { agotados++; if (l.problema !== 'sin_stock') dif.push(`${p.nombre}: agotado y cotizar dice ${l.problema}`) }
          else if (l.problema !== null || l.precio_unitario !== p.precio) dif.push(`${p.nombre}: ${p.precio} vs ${l.precio_unitario} (${l.problema})`)
          for (const e of p.extras) {
            vistos++
            const le = cotizar([linea(p.id, 1, [{ extra_id: e.id, cantidad: 1 }])]).lineas[0]
            if (e.agotado || p.agotado) { agotados++; if (le.problema !== 'sin_stock') dif.push(`${p.nombre}+${e.nombre}: agotado y cotizar dice ${le.problema}`) }
            else if (le.problema !== null || le.extras[0]?.precio_unitario !== e.precio) dif.push(`${p.nombre}+${e.nombre}: ${e.precio} vs ${le.extras[0]?.precio_unitario} (${le.problema})`)
          }
        }
      }
      return { dif, vistos, agotados }
    }
    const normal = comparar()
    expect([normal.dif, normal.vistos >= 5, normal.agotados]).toEqual([[], true, 0])
    psql(`update public.products set stock_qty = 0 where id = '${id.gaseosa}'; update public.products set stock_qty = 0 where id = '${id.pan}';`)
    const escaso = comparar()
    expect([escaso.dif, escaso.agotados], 'contraste: la gaseosa (y su extra), el combo y el pan extra, agotados').toEqual([[], 4])
  })

  test('categoría desactivada en el POS: sus productos salen del catálogo y no se cobran (contraste: reactivada)', () => {
    psql(`update public.categories set is_active = false where id = '${id.cat}';`)
    const c = JSON.stringify(catalogo())
    expect([c.includes('E2E P2 Perro'), c.includes('E2E P2 Gaseosa')], 'sale la de Comidas; Bebidas sigue').toEqual([false, true])
    expect(cotizar([linea(id.perro, 2)]).lineas[0].problema).toBe('no_disponible')
    // Sin NINGUNA categoría activa no queda nada vendible: el portal queda incompleto (la misma regla
    // que la configuración de P1, portal_faltantes_de) y no responde más que {disponible: false}.
    psql(`update public.categories set is_active = false where id = '${id.cat2}';`)
    expect(catalogo()).toEqual({ disponible: false })
    psql(`update public.categories set is_active = true where id in ('${id.cat}', '${id.cat2}');`)
    expect(JSON.stringify(catalogo())).toContain('E2E P2 Perro')
    expect(cotizar([linea(id.perro, 2)]).lineas[0].problema).toBeNull()
  })

  test('precios: los pone el servidor; la cantidad de un extra es por unidad del producto', () => {
    const q = cotizar([linea(id.perro, 2, [{ extra_id: id.queso, cantidad: 1 }]), linea(id.gaseosa, 1)])
    expect(q.lineas.map((l) => [l.nombre, l.precio_unitario, l.total, l.problema])).toEqual([
      ['E2E P2 Perro', 12000, 28000, null], ['E2E P2 Gaseosa', 3000, 3000, null]])
    expect(q.lineas[0].extras).toEqual([{ extra_id: id.queso, nombre: 'E2E P2 Queso', cantidad: 1, precio_unitario: 2000 }])
    expect([q.subtotal, q.envio, q.total, q.puede_pedir, q.motivos]).toEqual([31000, 2000, 33000, true, []])
    // El navegador no puede mandar precios: cualquier clave fuera de la allowlist se rechaza.
    expect(cotizarError([{ product_id: id.perro, cantidad: 1, precio_unitario: 1 }])).toContain('Cada producto lleva product_id y cantidad')
    expect(cotizarError([{ product_id: id.perro, cantidad: 1, extras: [{ extra_id: id.queso, cantidad: 1, precio: 0 }] }]))
      .toContain('Cada extra lleva extra_id y cantidad')
  })

  test('extras: de otro producto, de otra sede o inactivo → la línea no se cobra (contraste: el válido sí)', () => {
    const casos: [string, string][] = [['válido', id.queso], ['de otro producto', id.tocineta], ['de otra sede', id.extraAjeno], ['inactivo', id.extraInactivo]]
    const r = casos.map(([n, e]) => {
      const l = cotizar([linea(id.perro, 1, [{ extra_id: e, cantidad: 1 }])]).lineas[0]
      return `${n}: ${l.problema ?? 'ok'} · ${l.total}`
    })
    expect(r).toEqual(['válido: ok · 14000', 'de otro producto: extra_no_disponible · null',
      'de otra sede: extra_no_disponible · null', 'inactivo: extra_no_disponible · null'])
    // Desactivar el queso lo deja como el inactivo (el mismo extra, antes y después).
    psql(`update public.extras set is_active = false where id = '${id.queso}';`)
    expect(cotizar([linea(id.perro, 1, [{ extra_id: id.queso, cantidad: 1 }])]).lineas[0].problema).toBe('extra_no_disponible')
    const q = cotizar([linea(id.perro, 1, [{ extra_id: id.tocineta, cantidad: 1 }]), linea(id.gaseosa, 5)])
    expect([q.subtotal, q.puede_pedir, q.motivos.includes('productos')], 'la línea con problema no suma').toEqual([0, false, true])
  })

  test('productos: sin publicar, inactivo, de $0 o de otra sede → no disponible y sin nombre (contraste: el publicado)', () => {
    const q = cotizar([id.perro, id.oculto, id.inactivo, id.sinPrecio, id.ajeno, '00000000-0000-4000-8000-000000000000'].map((p) => linea(p, 1)))
    expect(q.lineas.map((l) => `${l.nombre}|${l.problema}|${l.total}`)).toEqual([
      'E2E P2 Perro|null|12000', 'null|no_disponible|null', 'null|no_disponible|null', 'null|no_disponible|null',
      'null|no_disponible|null', 'null|no_disponible|null'])
    expect([q.subtotal, q.motivos]).toEqual([12000, ['productos', 'bajo_minimo']])
    psql(`update public.products set is_active = false where id = '${id.perro}';`)
    expect(cotizar([linea(id.perro, 1)]).lineas[0].problema, 'el mismo producto, desactivado en el POS').toBe('no_disponible')
  })

  test('stock de todo el carrito: simple, receta del compuesto y producto vinculado al extra (con contraste)', () => {
    const prob = (items: unknown) => cotizar(items).lineas.map((l) => l.problema ?? 'ok')
    expect(prob([linea(id.gaseosa, 3)])).toEqual(['ok'])
    expect(prob([linea(id.gaseosa, 4)])).toEqual(['sin_stock'])
    expect(prob([linea(id.gaseosa, 2), linea(id.gaseosa, 2)]), 'sumado entre líneas').toEqual(['sin_stock', 'sin_stock'])
    expect(prob([linea(id.combo, 2)]), '2 combos = 4 panes de 5').toEqual(['ok'])
    expect(prob([linea(id.combo, 3)]), '3 combos = 6 panes').toEqual(['sin_stock'])
    // 2 combos (4 panes) + 1 perro con 1 pan extra (1 pan) = 5: alcanza. Con 2 perros, 6: no.
    expect(prob([linea(id.combo, 2), linea(id.perro, 1, [{ extra_id: id.panExtra, cantidad: 1 }])])).toEqual(['ok', 'ok'])
    expect(prob([linea(id.combo, 2), linea(id.perro, 2, [{ extra_id: id.panExtra, cantidad: 1 }])])).toEqual(['sin_stock', 'sin_stock'])
    expect(prob([linea(id.perro, 30)]), 'el perro no lleva stock').toEqual(['ok'])
    // Nunca sale CUÁNTO queda: la respuesta tiene estas claves y ninguna más, y "sin_stock" solo dice
    // que no alcanza para esa cantidad (decisión del 2026-10-15).
    const q = cotizar([linea(id.gaseosa, 4, []), linea(id.combo, 3)])
    expect(Object.keys(q).sort()).toEqual(CLAVES_COTIZACION)
    expect(q.lineas.map((l) => Object.keys(l).sort())).toEqual([CLAVES_LINEA, CLAVES_LINEA])
    expect(JSON.stringify(q)).not.toMatch(/unidades|stock_qty|"stock"|disponibles/)
  })

  test('lo que el portal acepta es lo que el POS descuenta (R1 #13 e): el carrito justo en el límite deja el stock en 0', () => {
    // 2 combos (4 panes) + 1 perro con 1 pan extra (1 pan) = 5 panes de 5; 3 gaseosas de 3.
    const carrito = [linea(id.combo, 2), linea(id.perro, 1, [{ extra_id: id.panExtra, cantidad: 1 }]), linea(id.gaseosa, 3)]
    const q = cotizar(carrito)
    expect(q.lineas.map((l) => l.problema)).toEqual([null, null, null])
    // Contraste: un pan más ya no alcanza según el portal.
    expect(cotizar([...carrito.slice(0, 1), linea(id.perro, 2, [{ extra_id: id.panExtra, cantidad: 1 }])]).lineas.map((l) => l.problema))
      .toEqual(['sin_stock', 'sin_stock'])
    // El MISMO carrito por el POS (add_order_items_with_extras), como el dueño, sin confirmar.
    const items = q.lineas.map((l) => ({ product_id: l.product_id, qty: l.cantidad, unit_price: l.precio_unitario,
      extras: l.extras.map((e) => ({ extra_id: e.extra_id, qty: e.cantidad })) }))
    const orden = '00000000-0000-4000-8000-0000000000e2'
    const quedan = psql(`begin;
      insert into public.orders (id, type, restaurant_id, created_by) values ('${orden}', 'takeaway', '${SEDE}', '${OWNER}');
      select set_config('request.jwt.claims', '{"sub":"${OWNER}","role":"authenticated"}', true);
      set local role authenticated;
      select public.add_order_items_with_extras('${orden}', ${lit(items)}, null);
      reset role;
      select string_agg(name || ':' || coalesce(stock_qty::text, '-'), ',' order by name)
        from public.products where id in ('${id.pan}', '${id.gaseosa}', '${id.perro}');
      rollback;`).split(/\r?\n/).filter((l) => l.includes(':')).pop()
    expect(quedan, 'el POS descuenta exactamente lo que el portal contó').toBe('E2E P2 Gaseosa:0,E2E P2 Pan:0,E2E P2 Perro:-')
  })

  test('zona y envío: tramos por distancia, fuera del radio, polígono y sin ubicación', () => {
    const z = (donde: { lat: number; lng: number } | null) => {
      const q = cotizar([linea(id.perro, 2)], donde)
      return [q.en_zona, q.envio, q.total, q.motivos]
    }
    expect(z(CENTRO)).toEqual([true, 2000, 26000, []])
    expect(z(A_1500)).toEqual([true, 4000, 28000, []])
    expect(z(A_3000)).toEqual([false, null, null, ['fuera_de_zona']])
    expect(z(null)).toEqual([null, null, null, ['sin_ubicacion']])
    // Polígono: un cuadrado de ~1,1 km de lado alrededor del centro. A 1,5 km queda fuera aunque el radio lo dejaba.
    psql(`update public.portal_sedes set zona_tipo = 'poligono', zona_poligono = '[[3.455,-76.535],[3.455,-76.525],[3.445,-76.525],[3.445,-76.535]]'
          where restaurant_id = '${SEDE}';`)
    expect([z(CENTRO)[0], z(A_1500)[0]]).toEqual([true, false])
    psql(`update public.portal_sedes set envio_tipo = 'fijo', envio_fijo = 3500 where restaurant_id = '${SEDE}';`)
    expect(z(CENTRO)).toEqual([true, 3500, 27500, []])
    expect(cotizarError([linea(id.perro, 1)], `${CENTRO.lat}, null`)).toMatch(/PT400: La ubicación no es válida/)
  })

  test('pedido mínimo y estado: bajo el mínimo, pausado y fuera de horario con la próxima apertura en hora de Bogotá (R7)', () => {
    const q = cotizar([linea(id.perro, 1)])
    expect([q.motivos, q.falta_para_minimo, q.puede_pedir]).toEqual([['bajo_minimo'], 3000, false])
    psql(`update public.portal_sedes set pausado = true where restaurant_id = '${SEDE}';`)
    const p = cotizar([linea(id.perro, 2)])
    expect([p.motivos, p.estado]).toEqual([['cerrado'], { recibe: false, motivo: 'pausado', abre_en: null }])
    // Domingo 23:30 en Bogotá = lunes 04:30 UTC. Abre el domingo 23:45 (Bogotá) y el lunes a las 10:00.
    // En UTC sería "lunes 04:30" y la próxima apertura saldría el lunes 10:00: el contraste de R7.
    psql(`update public.portal_sedes set pausado = false, horario = '{"7": [["23:45", "23:55"]], "1": [["10:00", "12:00"]]}'
          where restaurant_id = '${SEDE}';`)
    const h = cotizar([linea(id.perro, 2)], CENTRO, '2026-10-19T04:30:00Z')
    expect([h.motivos, h.estado.motivo, new Date(h.estado.abre_en!).toISOString()])
      .toEqual([['cerrado'], 'fuera_de_horario', '2026-10-19T04:45:00.000Z'])
    expect(cotizar([linea(id.perro, 2)], CENTRO, '2026-10-19T04:50:00Z').estado.recibe, 'contraste: dentro de la franja').toBe(true)
    expect(new Date(cotizar([linea(id.perro, 2)], CENTRO, '2026-10-19T05:00:00Z').estado.abre_en!).toISOString(),
      'pasada la franja del domingo, el lunes a las 10:00 de Bogotá').toBe('2026-10-19T15:00:00.000Z')
  })

  test('forma del carrito: cada caso inválido da el error propio PT400 (contraste: el válido pasa)', () => {
    const p = id.perro
    const casos: [string, unknown][] = [
      ['vacío', []], ['31 líneas', Array.from({ length: 31 }, () => linea(p, 1))], ['no es lista', { product_id: p, cantidad: 1 }],
      ['cantidad 0', [linea(p, 0)]], ['cantidad 51', [linea(p, 51)]], ['cantidad 1.5', [linea(p, 1.5)]],
      ['cantidad texto', [{ product_id: p, cantidad: '2' }]], ['sin cantidad', [{ product_id: p }]], ['id que no es uuid', [linea('abc', 1)]],
      ['extra repetido', [linea(p, 1, [{ extra_id: id.queso, cantidad: 1 }, { extra_id: id.queso, cantidad: 1 }])]],
      ['extra cantidad 6', [linea(p, 1, [{ extra_id: id.queso, cantidad: 6 }])]],
      ['11 extras', [linea(p, 1, Array.from({ length: 11 }, () => ({ extra_id: id.queso, cantidad: 1 })))]],
      ['nota de 141', [{ product_id: p, cantidad: 1, nota: 'x'.repeat(141) }]], ['nota número', [{ product_id: p, cantidad: 1, nota: 5 }]],
      ['línea que es un número', [1]], ['línea que es una lista', [[p, 1]]], ['extras con un número', [linea(p, 1, [7 as never])]],
      ['cantidad gigante', [{ product_id: p, cantidad: 1e40 }]],
    ]
    expect(casos.map(([n, items]) => `${n}: ${/ERROR: {2}PT400: /.test(cotizarError(items))}`)).toEqual(casos.map(([n]) => `${n}: true`))
    expect(cotizarError([])).toMatch(/PT400: El pedido tiene que tener de 1 a 30 productos/)
    // "2.0" es un entero para la forma (portal_entero_entre): se cobra como 2, no revienta en un cast.
    // Va como JSON crudo porque JSON.stringify(2.0) ya da "2" (así lo mandaría un llamador directo, P3).
    const crudo = `[{"product_id": "${p}", "cantidad": 2.0, "extras": [{"extra_id": "${id.queso}", "cantidad": 1.0}]}]`
    const q2 = JSON.parse(comoServicio(`select portal_cotizar('${SLUG}', '${crudo}'::jsonb, ${CENTRO.lat}, ${CENTRO.lng});`))
    expect([q2.lineas[0].cantidad, q2.lineas[0].total]).toEqual([2, (12000 + 2000) * 2])
    const ok = cotizar([{ product_id: p, cantidad: 50, nota: 'x'.repeat(140), extras: [{ extra_id: id.queso, cantidad: 5 }] }])
    expect(ok.lineas[0].total, 'contraste: en el borde de cada límite').toBe((12000 + 2000 * 5) * 50)
  })

  test('contador del límite: solo claves hasheadas; cuenta por minuto y purga lo de ayer', () => {
    const contar = (clave: string, max: number) => psqlResultado(`set role service_role; select portal_contar('${clave}', ${max});`)
    expect(contar('cotizar:203.0.113.5', 10).stderr, 'una IP en claro no se puede guardar').toMatch(/portal_limites_clave/)
    expect(contar('Cotizar:sin-ip', 10).stderr).toMatch(/portal_limites_clave/)
    expect(contar('cotizar:sin-ip', 10).stderr, 'sin IP hay UN balde global, no uno por acción').toMatch(/portal_limites_clave/)
    const k = `cotizar:${'ab'.repeat(32)}`
    psql(`delete from public.portal_limites where clave = '${k}';
          insert into public.portal_limites (clave, ventana, cuenta) values ('${k}', now() - interval '2 days', 99);`)
    expect([1, 2, 3].map(() => sinSet(contar(k, 2).stdout))).toEqual(['t', 't', 'f'])
    expect(psql(`select count(*) from public.portal_limites where clave = '${k}' and ventana < now() - interval '1 day';`), 'purga').toBe('0')
    expect(sinSet(contar('global:sin-ip', 1).stdout)).toBe('t')
  })
})

test.describe('el pre-flight de portal-publico.sql', () => {
  test('consultas 2 y 4: los md5 de P1 que exige y los de sus 9 funciones dan t; la reversa tiene las mismas listas', () => {
    const pre = readFileSync('supabase/diag/portal-publico-preflight.sql', 'utf-8').replace(/\r\n/g, '\n')
    const c2 = pre.slice(pre.indexOf('-- ── Consulta 2'), pre.indexOf('-- ── Consulta 3'))
    const c4 = pre.slice(pre.indexOf('-- ── Consulta 4'))
    const f2 = psql(c2).split(/\r?\n/).filter(Boolean)
    const f4 = psql(c4).split(/\r?\n/).filter(Boolean)
    expect([f2.length, f4.length]).toEqual([6, 9])
    expect([...f2.filter((f) => !f.endsWith('|t')), ...f4.filter((f) => !f.endsWith('|t|t'))]).toEqual([])
    // La reversa vive FUERA de git: si no está, falla (E2E_SIN_REVERSAS=1 lo permite a propósito).
    const rev = '../gvento/portal-publico-revertir.sql'
    if (!existsSync(rev)) expect(process.env.E2E_SIN_REVERSAS, `falta ${rev}`).toBe('1')
    if (existsSync(rev)) {
      const md5 = (txt: string) => [...new Set([...txt.matchAll(/'([a-z_]+\([^']*\))',\s*'([0-9a-f]{32})'/g)]
        .map((m) => `${m[1].replace('timestamp with time zone', 'timestamptz')}=${m[2]}`))].sort()
      // POR IGUALDAD: un md5 viejo en cualquiera de las copias de la reversa sale como sobrante.
      expect(md5(readFileSync(rev, 'utf-8')), 'la reversa (fuera de git) exige exactamente los mismos md5')
        .toEqual([...new Set([...md5(c2), ...md5(c4)])].sort())
      expect(md5(c2).length + md5(c4).length).toBe(15)
    }
  })
})

test.describe('la guarda de portal-publico.sql', () => {
  const cuerpo = () => readFileSync('supabase/portal-publico.sql', 'utf-8').replace(/\r\n/g, '\n').split('\n')
    .filter((l) => l !== 'begin;' && l !== 'commit;').join('\n')

  test('ya aplicada: re-aplicar aborta sin cambiar nada', () => {
    const r = psqlResultado(`begin;\n${cuerpo()}\nrollback;`)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('ya está aplicada')
  })

  test('precondición por md5: con otra portal_estado_de aborta; con la vigente pasa la guarda (contraste)', () => {
    const sinTabla = 'drop table public.portal_limites;'
    const otra = `create or replace function public.portal_estado_de(p_sede uuid, p_ahora timestamptz) returns jsonb
      language sql stable security definer set search_path = public as $$ select '{"recibe": true}'::jsonb $$;`
    const conOtra = psqlResultado(`begin;\n${sinTabla}\n${otra}\n${cuerpo()}\nrollback;`)
    expect(conOtra.status).not.toBe(0)
    expect(conOtra.stderr).toContain('no son las de portal-config.sql')
    const vigente = psqlResultado(`begin;\n${sinTabla}\n${cuerpo()}\nrollback;`)
    expect(vigente.stderr).not.toContain('no son las de portal-config.sql')
    expect(vigente.stderr).toMatch(/already exists|ya existe/)
  })
})

test.describe('Pedidos en línea · Edge Function portal', () => {
  const llamar = (cuerpo: unknown, headers: Record<string, string> = {}, method = 'POST') =>
    fetch(FN(), { method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'POST' ? (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) : undefined })

  test('responde lo mismo que la base; el origen ajeno recibe 403 (contraste: el de la app)', async () => {
    const r = await llamar({ accion: 'catalogo', slug: SLUG }, { Origin: 'http://localhost:5180', 'cf-connecting-ip': '198.51.100.10' })
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(await r.json()).toEqual(catalogo())
    const ajeno = await llamar({ accion: 'catalogo', slug: SLUG }, { Origin: 'https://evil.example', 'cf-connecting-ip': '198.51.100.10' })
    expect([ajeno.status, JSON.stringify(await ajeno.json())]).toEqual([403, '{"error":"Origen no permitido."}'])
    const q = await llamar({ accion: 'cotizar', slug: SLUG, items: [linea(id.perro, 2)], lat: CENTRO.lat, lng: CENTRO.lng }, { 'cf-connecting-ip': '198.51.100.10' })
    expect((await q.json()).total).toBe(26000)
  })

  test('cuerpo: acción, claves, método y tamaño; el error propio PT400 de la base llega como 400 con su mensaje', async () => {
    const ip = { 'cf-connecting-ip': '198.51.100.11' }
    const casos: [unknown, number, RegExp][] = [
      [{ accion: 'cotizar', slug: SLUG, items: [linea(id.perro, 1)], total: 1 }, 400, /Clave no permitida: total/],
      [{ accion: 'crear', slug: SLUG }, 400, /Acción desconocida/],
      ['{no es json', 400, /no es JSON/],
      [{ accion: 'cotizar', slug: SLUG, items: [linea(id.perro, 0)] }, 400, /Cada producto lleva product_id y cantidad/],
      [{ accion: 'cotizar', slug: SLUG, items: [linea(id.perro, 1)], lat: 3.4 }, 400, /La ubicación no es válida/],
      [{ accion: 'catalogo', slug: SLUG, relleno: 'x'.repeat(17000) }, 413, /demasiado grande/],
    ]
    for (const [cuerpo, status, msj] of casos) {
      const r = await llamar(cuerpo, ip)
      expect(`${r.status} ${(await r.json()).error}`).toMatch(new RegExp(`^${status} .*${msj.source}`))
    }
    expect((await llamar(null, ip, 'GET')).status).toBe(405)
    // Más de 16 KB enviados en partes (sin content-length desde el cliente): también 413.
    // Ojo: en local NO ejercita la lectura en partes de la función. El Kong local junta el cuerpo y
    // le pone content-length (medido el 2026-10-15: la función recibió content-length 20480 y ningún
    // transfer-encoding), así que lo corta el tope por content-length. El mutante que quita el tope
    // de la lectura en partes sobrevive aquí; ese tope es para el gateway de producción.
    const partes = new ReadableStream({ start(c) { for (let i = 0; i < 20; i++) c.enqueue(new TextEncoder().encode('x'.repeat(1024))); c.close() } })
    const sinLargo = await fetch(FN(), { method: 'POST', body: partes, headers: ip, duplex: 'half' } as RequestInit)
    expect(sinLargo.status).toBe(413)
  })

  test('cualquier error que no sea el propio sale genérico (500); el contador caído da 503 (fail-closed)', async () => {
    const ip = { 'cf-connecting-ip': '198.51.100.13' }
    const cuerpo = { accion: 'cotizar', slug: SLUG, items: [linea(id.perro, 2)], lat: CENTRO.lat, lng: CENTRO.lng }
    psql(`revoke execute on function public.portal_cotizar(text,jsonb,numeric,numeric,timestamptz) from service_role;`)
    try {
      const r = await llamar(cuerpo, ip)
      const txt = await r.text()
      expect([r.status, txt]).toEqual([500, '{"error":"No pudimos atender tu consulta. Intenta de nuevo en un momento."}'])
    } finally {
      psql(`grant execute on function public.portal_cotizar(text,jsonb,numeric,numeric,timestamptz) to service_role;`)
    }
    psql(`revoke execute on function public.portal_contar(text,integer) from service_role;`)
    try {
      expect((await llamar(cuerpo, ip)).status).toBe(503)
    } finally {
      psql(`grant execute on function public.portal_contar(text,integer) to service_role;`)
    }
    expect((await llamar(cuerpo, ip)).status, 'contraste: restaurados los permisos').toBe(200)
  })

  test('límite por IP: la base guarda el MISMO hash que calcula reglas.ts; pasado el máximo, 429; otra IP sigue', async () => {
    // Determinista: el contador de esta IP se deja en el máximo (60) para el minuto actual y el
    // siguiente, y se hace UNA consulta. (Con 61 consultas reales, cruzar el cambio de minuto
    // reiniciaba la cuenta: el flake que se vio el 2026-10-15.)
    const ip = `203.0.113.${(Date.now() % 200) + 20}`
    const cuerpo = { accion: 'cotizar', slug: 'e2e-no-existe', items: [] }
    const ahora = new Date()
    const claves = [ahora, new Date(ahora.getTime() + 60_000)].map((f) => claveLimite('cotizar', ip, SAL_LOCAL(), f))
    const [k1, k2] = await Promise.all(claves)
    psql(`delete from public.portal_limites where clave in ('${k1}', '${k2}');
          insert into public.portal_limites (clave, ventana, cuenta) values
            ('${k1}', date_trunc('minute', now()), 60), ('${k2}', date_trunc('minute', now()) + interval '1 minute', 60)
          on conflict do nothing;`)
    const r = await llamar(cuerpo, { 'cf-connecting-ip': ip })
    expect(r.status).toBe(429)
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await r.json()).error).toMatch(/Demasiadas consultas/)
    // La consulta sumó en la fila de ESE hash: la función usó la misma regla y la misma sal (R1 #14 b).
    expect(Number(psql(`select coalesce(max(cuenta), 0) from public.portal_limites where clave in ('${k1}', '${k2}');`))).toBe(61)
    // Contraste: otra IP, sin cuenta previa, pasa y queda contada en SU hash.
    const otra = `198.51.100.${(Date.now() % 200) + 20}`
    expect((await llamar(cuerpo, { 'cf-connecting-ip': otra })).status).toBe(200)
    const ko = await claveLimite('cotizar', otra, SAL_LOCAL(), new Date())
    expect(psql(`select count(*) from public.portal_limites where clave = '${ko}';`)).toBe('1')
  })
})
