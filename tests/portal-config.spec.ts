import { test, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cashierCreds, hasWaiterCreds, loginAsOwner, ownerCreds, waiterCreds } from './helpers/auth'
import { readFileSync } from 'node:fs'
import { cliente, psql, psqlResultado } from './helpers/db-local'
import { otraCreds } from './helpers/storage'
import { CLAVES_PORTAL, type PortalCambios } from '../src/lib/portal'
import { CASOS_SLUG, CASOS_WHATSAPP } from '../src/lib/portalCasos'

// ============================================================================
// Pedidos en línea, P1 (supabase/portal-config.sql): la configuración del portal de cada sede.
//   · Tablas sin acceso directo: todo por las funciones, con pedidos_online.gestionar.
//   · actualizar_portal: ALLOWLIST de claves (contrato con CLAVES_PORTAL), slug único entre
//     organizaciones, publicar exige la configuración completa y no se puede dejar incompleto.
//   · guardar_portal_productos: solo productos de la sede (por id), sin precio no se publica.
//   · portal_estado: motivos en orden y el horario en hora de Bogotá (R7).
//   · La pantalla: Configuración › Pedidos en línea y › Productos en el portal.
// ============================================================================

let owner: SupabaseClient
let cajero: SupabaseClient
let otra: SupabaseClient
let SEDE = ''
let SEDE_OTRA = ''
let PROD_A = ''      // producto activo de la sede, con precio
let PROD_B = ''      // otro producto activo de la sede, con precio
let PROD_CERO = ''   // producto de la sede con precio 0 (fixture de este spec)
let PROD_AJENO = ''  // producto de OTRA sede (fixture de este spec, en la sede de LAB-OTRA)
let CAT_AJENA = ''

const LAB_SLUG = 'e2e-portal-lab'
const OTRA_SLUG = 'e2e-portal-otra'
// Dos franjas que cubren el día entero (con una sola, 00:00–23:59, el minuto 23:59 quedaba cerrado).
const HORARIO_TODO_EL_DIA = Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((d) => [d, [['00:00', '12:00'], ['12:00', '00:00']]]))

const limpiar = () => psql(`
  delete from public.portal_productos where restaurant_id in ('${SEDE}', '${SEDE_OTRA}');
  delete from public.portal_sedes where restaurant_id in ('${SEDE}', '${SEDE_OTRA}');`)

const fila = (sql: string) => psql(sql)
/** Un INSERT … RETURNING id: psql devuelve el id y además "INSERT 0 1". */
const insertarId = (sql: string) => psql(sql).split(/\r?\n/)[0].trim()

test.beforeAll(async () => {
  const o = await cliente(ownerCreds()); owner = o.c; SEDE = o.sede
  cajero = (await cliente(cashierCreds())).c
  const x = await cliente(otraCreds()); otra = x.c; SEDE_OTRA = x.sede
  expect(SEDE_OTRA, 'otra.test tiene que estar en otra sede').not.toBe(SEDE)
  const prods = psql(`select string_agg(id::text, ',' order by name) from (
      select id, name from public.products where restaurant_id = '${SEDE}' and is_active and price > 0 order by name limit 2) t;`).split(',')
  ;[PROD_A, PROD_B] = prods
  expect(PROD_B, 'la sede del owner necesita 2 productos activos con precio').toBeTruthy()
  CAT_AJENA = insertarId(`insert into public.categories (name, restaurant_id) values ('E2E Portal ajena', '${SEDE_OTRA}') returning id;`)
  PROD_AJENO = insertarId(`insert into public.products (name, price, restaurant_id, category_id, is_active)
    values ('E2E Portal producto ajeno', 8000, '${SEDE_OTRA}', '${CAT_AJENA}', true) returning id;`)
  PROD_CERO = insertarId(`
    insert into public.products (name, price, restaurant_id, category_id, is_active)
    select 'E2E Portal Comida trabajador', 0, '${SEDE}', category_id, true
      from public.products where id = '${PROD_A}'
    returning id;`)
  limpiar()
})

test.afterAll(() => {
  if (SEDE && SEDE_OTRA) limpiar()
  for (const id of [PROD_CERO, PROD_AJENO].filter(Boolean)) psql(`delete from public.products where id = '${id}';`)
  if (CAT_AJENA) psql(`delete from public.categories where id = '${CAT_AJENA}';`)
})

test.beforeEach(() => limpiar())

const err = (r: { error: { message?: string } | null }) => r.error?.message ?? ''

test.describe('Pedidos en línea · configuración (servidor)', () => {
  test('catálogo: las tablas no se tocan directo; 7 funciones para la app, las internas para nadie', () => {
    expect(psql(`select string_agg(t || ':' || r || ':' || p, ',' order by t, r, p) from
        unnest(array['portal_sedes', 'portal_productos']) t, unnest(array['anon', 'authenticated']) r,
        unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
       where has_table_privilege(r, 'public.' || t, p);`), 'privilegios de tabla que no deberían existir').toBe('')
    expect(psql(`select bool_and(relrowsecurity) from pg_class where oid in ('public.portal_sedes'::regclass, 'public.portal_productos'::regclass);`)).toBe('t')
    const app = ['portal_estado', 'portal_config', 'portal_slug_disponible', 'actualizar_portal',
      'pausar_pedidos_online', 'portal_productos_lista', 'guardar_portal_productos']
    const internas = ['geo_distancia_m', 'geo_en_poligono', 'portal_poligono_valido', 'portal_tramos_validos',
      'portal_horario_valido', 'portal_faltantes_de', 'portal_estado_de', 'portal_mensaje_restriccion', 'portal_disponibilidad']
    const ejec = (nombres: string[]) => psql(`select string_agg(proname || ':' || has_function_privilege('anon', oid, 'EXECUTE')
        || ':' || has_function_privilege('authenticated', oid, 'EXECUTE'), ',' order by proname)
        from pg_proc where pronamespace = 'public'::regnamespace and proname in (${nombres.map((n) => `'${n}'`).join(',')});`)
    expect(ejec(app)).toBe([...app].sort().map((n) => `${n}:false:true`).join(','))
    expect(ejec(internas)).toBe([...internas].sort().map((n) => `${n}:false:false`).join(','))
  })

  test('sin sesión: ni las tablas ni las funciones', async () => {
    const anon = createClient(process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } })
    expect(err(await anon.from('portal_sedes').select('slug'))).toMatch(/permission denied/i)
    expect(err(await anon.rpc('portal_config'))).toMatch(/permission denied/i)
    expect(err(await anon.rpc('actualizar_portal', { p_cambios: { slug: 'e2e-anon' } }))).toMatch(/permission denied/i)
  })

  test('permisos: el cajero no configura, pero ve el estado y pausa (delivery.gestionar); el dueño sí configura', async () => {
    expect(err(await cajero.rpc('portal_config'))).toMatch(/No tienes permiso para configurar/)
    expect(err(await cajero.rpc('actualizar_portal', { p_cambios: { slug: 'e2e-cajero' } }))).toMatch(/No tienes permiso para configurar/)
    expect(err(await cajero.rpc('guardar_portal_productos', { p_cambios: [{ product_id: PROD_A, publicado: true, precio_domicilio: null }] })))
      .toMatch(/No tienes permiso para configurar/)
    expect(err(await cajero.rpc('portal_productos_lista'))).toMatch(/No tienes permiso para configurar/)
    // Contraste: pasa la compuerta (sin portal, el estado es sin_configurar y pausar dice que no está configurado).
    const est = await cajero.rpc('portal_estado')
    expect(est.error).toBeNull()
    expect((est.data as { motivo: string }).motivo).toBe('sin_configurar')
    expect(err(await cajero.rpc('pausar_pedidos_online', { p_pausar: true }))).toMatch(/no están configurados/)
    // El dueño sí.
    const r = await owner.rpc('actualizar_portal', { p_cambios: { slug: LAB_SLUG } })
    expect(r.error).toBeNull()
    expect(fila(`select slug from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe(LAB_SLUG)
    expect((await cajero.rpc('pausar_pedidos_online', { p_pausar: true })).error).toBeNull()
    expect(fila(`select pausado from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('t')
  })

  test('el mozo (sin delivery.gestionar) tampoco ve el estado ni pausa', async () => {
    test.skip(!hasWaiterCreds(), 'sin credenciales de mozo')
    const mozo = (await cliente(waiterCreds())).c
    expect(err(await mozo.rpc('portal_estado'))).toMatch(/No tienes permiso para ver el estado/)
    expect(err(await mozo.rpc('pausar_pedidos_online', { p_pausar: true }))).toMatch(/No tienes permiso para pausar/)
  })

  test('allowlist: una clave ajena aborta y no se guarda nada; para empezar hace falta el link', async () => {
    expect(err(await owner.rpc('actualizar_portal', { p_cambios: { slug: LAB_SLUG, restaurant_id: SEDE_OTRA } })))
      .toMatch(/no permitida: restaurant_id/)
    expect(err(await owner.rpc('actualizar_portal', { p_cambios: { slug: LAB_SLUG, pausado: true } }))).toMatch(/no permitida: pausado/)
    expect(fila(`select count(*) from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('0')
    expect(err(await owner.rpc('actualizar_portal', { p_cambios: { pedido_minimo: 1000 } }))).toMatch(/elige el link/)
    expect((await owner.rpc('actualizar_portal', { p_cambios: { slug: LAB_SLUG } })).error).toBeNull()
    expect(err(await owner.rpc('actualizar_portal', { p_cambios: { slug: null } }))).toMatch(/No se puede dejar vacío: slug/)
  })

  test('contrato R1: cada clave de CLAVES_PORTAL se escribe por la RPC y vuelve igual', async () => {
    const valores: Required<{ [K in (typeof CLAVES_PORTAL)[number]]: PortalCambios[K] }> = {
      slug: LAB_SLUG, activo: false, lat: 4.711, lng: -74.0721, zona_tipo: 'radio', zona_radio_m: 3000,
      zona_poligono: [[4.72, -74.08], [4.72, -74.06], [4.70, -74.06], [4.70, -74.08]],
      envio_tipo: 'distancia', envio_fijo: 4000,
      envio_tramos: [{ hasta_km: 2, valor: 3000 }, { hasta_km: 4, valor: 4000 }, { hasta_km: null, valor: 6000 }],
      pedido_minimo: 15000, tiempo_min: 30, tiempo_max: 45,
      horario: { '3': [['17:00', '23:30']], '6': [['16:00', '00:00']] }, color: '#c2410c', whatsapp: '573001234567',
    }
    expect(Object.keys(valores).sort()).toEqual([...CLAVES_PORTAL].sort())
    // lat y lng van juntas (CHECK portal_sedes_ubicacion): cada una se escribe con su pareja.
    const pareja: Partial<Record<string, Record<string, unknown>>> = { lat: { lng: valores.lng }, lng: { lat: valores.lat } }
    for (const clave of CLAVES_PORTAL) {
      const r = await owner.rpc('actualizar_portal', { p_cambios: { slug: LAB_SLUG, ...pareja[clave], [clave]: valores[clave] } })
      expect(r.error?.message, `actualizar_portal rechazó la clave ${clave}`).toBeUndefined()
      const portal = (r.data as { portal: Record<string, unknown> }).portal
      expect(portal[clave], `la clave ${clave} no volvió igual`).toEqual(valores[clave])
    }
  })

  test('link: formato, único entre organizaciones y disponibilidad', async () => {
    expect(err(await owner.rpc('actualizar_portal', { p_cambios: { slug: 'ab' } }))).toMatch(/de 3 a 40/)
    expect(err(await owner.rpc('actualizar_portal', { p_cambios: { slug: 'con espacio' } }))).toMatch(/de 3 a 40/)
    expect(err(await owner.rpc('actualizar_portal', { p_cambios: { slug: '-guion' } }))).toMatch(/de 3 a 40/)
    // Mayúsculas y espacios alrededor se normalizan en el servidor.
    expect((await owner.rpc('actualizar_portal', { p_cambios: { slug: '  E2E-Portal-LAB ' } })).error).toBeNull()
    expect(fila(`select slug from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe(LAB_SLUG)
    // Otra organización toma un link; el de LAB no puede usarlo.
    expect((await otra.rpc('actualizar_portal', { p_cambios: { slug: OTRA_SLUG } })).error).toBeNull()
    expect(err(await owner.rpc('actualizar_portal', { p_cambios: { slug: OTRA_SLUG } }))).toMatch(/ya lo usa otro negocio/)
    expect(fila(`select slug from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe(LAB_SLUG)
    expect((await owner.rpc('portal_slug_disponible', { p_slug: OTRA_SLUG })).data).toBe(false)
    expect((await owner.rpc('portal_slug_disponible', { p_slug: LAB_SLUG })).data, 'el propio cuenta como disponible').toBe(true)
    expect((await owner.rpc('portal_slug_disponible', { p_slug: 'e2e-libre-123' })).data).toBe(true)
    expect((await owner.rpc('portal_slug_disponible', { p_slug: 'X' })).data).toBe(false)
    // R1 #12 (b): el servidor contesta lo mismo que slugValido en los casos compartidos
    // (src/lib/portal.test.ts corre el lado del navegador con la misma lista).
    const servidor: string[] = []
    for (const c of CASOS_SLUG) servidor.push(`${c.slug}: ${(await owner.rpc('portal_slug_disponible', { p_slug: c.slug })).data}`)
    expect(servidor).toEqual(CASOS_SLUG.map((c) => `${c.slug}: ${c.valido}`))
  })

  test('forma de los valores: el servidor rechaza zona, tramos, horario, tiempo y color mal formados', async () => {
    expect((await owner.rpc('actualizar_portal', { p_cambios: { slug: LAB_SLUG } })).error).toBeNull()
    const casos: [PortalCambios | Record<string, unknown>, RegExp][] = [
      [{ zona_radio_m: 50 }, /radio de la zona/],
      [{ zona_poligono: [[4.7, -74.1], [4.71, -74.09]] }, /zona dibujada no es válida/],
      // Un "moño": los bordes 1-2 y 3-4 se cruzan.
      [{ zona_poligono: [[4.70, -74.10], [4.72, -74.08], [4.72, -74.10], [4.70, -74.08]] }, /bordes no se pueden cruzar/],
      [{ envio_tramos: [{ hasta_km: 4, valor: 1 }, { hasta_km: 2, valor: 1 }, { hasta_km: null, valor: 1 }] }, /tramos de envío/],
      [{ envio_tramos: [{ hasta_km: 2, valor: 1 }, { hasta_km: 5, valor: 1 }] }, /tramos de envío/],
      [{ horario: { '8': [['10:00', '12:00']] } }, /horario no es válido/],
      [{ horario: { '1': [['10:00', '10:00']] } }, /horario no es válido/],
      [{ horario: { '1': [['24:00', '10:00']] } }, /horario no es válido/],
      [{ tiempo_min: 50, tiempo_max: 40 }, /tiempo de entrega/],
      [{ color: 'rojo' }, /#rrggbb/],
      [{ whatsapp: '3001234567' }, /WhatsApp del local/],
      [{ whatsapp: '57300123456' }, /WhatsApp del local/],
      [{ whatsapp: '570000000001' }, /WhatsApp del local/],
      [{ lat: 4.7 }, /ubicación del local no es válida/],
      [{ lat: 'norte' }, /tipo equivocado/],
    ]
    for (const [cambio, esperado] of casos) {
      expect(err(await owner.rpc('actualizar_portal', { p_cambios: cambio })), JSON.stringify(cambio)).toMatch(esperado)
    }
    // Nada de lo anterior quedó guardado.
    expect(fila(`select coalesce(zona_radio_m::text, '-') || coalesce(zona_poligono::text, '-') || coalesce(envio_tramos::text, '-')
        || horario::text || coalesce(tiempo_min::text, '-') || coalesce(color, '-') || coalesce(lat::text, '-')
        || coalesce(whatsapp, '-')
        from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('---{}----')
  })

  test('WhatsApp: el servidor acepta exactamente lo mismo que la pantalla (CASOS_WHATSAPP, R1 #12 c)', async () => {
    expect((await owner.rpc('actualizar_portal', { p_cambios: { slug: LAB_SLUG } })).error).toBeNull()
    const servidor: string[] = []
    for (const c of CASOS_WHATSAPP) {
      const r = await owner.rpc('actualizar_portal', { p_cambios: { whatsapp: c.numero } })
      servidor.push(`${c.numero}: ${r.error === null}`)
    }
    expect(servidor).toEqual(CASOS_WHATSAPP.map((c) => `${c.numero}: ${c.valido}`))
  })

  test('productos: solo los de la sede, por id; sin precio no se publica; todo o nada', async () => {
    const guardar = (c: unknown) => owner.rpc('guardar_portal_productos', { p_cambios: c })
    expect(err(await guardar([
      { product_id: PROD_A, publicado: true, precio_domicilio: null },
      { product_id: PROD_AJENO, publicado: true, precio_domicilio: null },
    ]))).toMatch(/no es de esta sede/)
    expect(fila(`select count(*) from public.portal_productos where product_id in ('${PROD_A}', '${PROD_AJENO}');`), 'todo o nada').toBe('0')
    expect(err(await guardar([{ product_id: PROD_CERO, publicado: true, precio_domicilio: null }]))).toMatch(/no tiene precio/)
    expect(err(await guardar([{ product_id: PROD_A, publicado: true, precio_domicilio: 0 }]))).toMatch(/no es válido/)
    expect(err(await guardar([{ product_id: PROD_A, publicado: true, precio_domicilio: null },
      { product_id: PROD_A, publicado: false, precio_domicilio: null }]))).toMatch(/repetido/)
    expect(err(await guardar([{ product_id: PROD_A, publicado: true }]))).toMatch(/product_id, publicado y precio_domicilio/)
    // Contraste: el de $0 con precio a domicilio sí se publica; los demás normal.
    const r = await guardar([
      { product_id: PROD_A, publicado: true, precio_domicilio: null },
      { product_id: PROD_B, publicado: true, precio_domicilio: 12345 },
      { product_id: PROD_CERO, publicado: true, precio_domicilio: 5000 },
    ])
    expect(r.error).toBeNull()
    const lista = (await owner.rpc('portal_productos_lista')).data as { product_id: string; publicado: boolean; precio_domicilio: number | null }[]
    const de = (id: string) => lista.find((p) => p.product_id === id)
    expect([de(PROD_A)?.publicado, de(PROD_A)?.precio_domicilio]).toEqual([true, null])
    expect([de(PROD_B)?.publicado, de(PROD_B)?.precio_domicilio]).toEqual([true, 12345])
    expect([de(PROD_CERO)?.publicado, de(PROD_CERO)?.precio_domicilio]).toEqual([true, 5000])
    expect(lista.some((p) => p.product_id === PROD_AJENO), 'la lista es solo de la sede').toBe(false)
  })

  test('regla única (portal_disponibilidad): agotado por receta, categoría desactivada, y agotado no deja el portal incompleto', async () => {
    const guardar = (c: unknown) => owner.rpc('guardar_portal_productos', { p_cambios: c })
    const lista = async () => ((await owner.rpc('portal_productos_lista')).data as { product_id: string; agotado: boolean; categoria_activa: boolean }[])
    const cat = insertarId(`insert into public.categories (name, restaurant_id) values ('E2E Portal regla', '${SEDE}') returning id;`)
    const ids: string[] = []
    try {
      const insumo = insertarId(`insert into public.products (name, price, restaurant_id, category_id, stock_tracking, stock_qty)
        values ('E2E Portal insumo', 100, '${SEDE}', '${cat}', true, 1) returning id;`); ids.push(insumo)
      const combo = insertarId(`insert into public.products (name, price, restaurant_id, category_id, kind)
        values ('E2E Portal combo', 15000, '${SEDE}', '${cat}', 'composite') returning id;`); ids.unshift(combo)
      psql(`insert into public.product_components (restaurant_id, parent_id, component_id, qty) values ('${SEDE}', '${combo}', '${insumo}', 2);`)
      // 1. El combo necesita 2 insumos y hay 1: agotado en la lista (antes solo miraba el stock propio,
      //    que un compuesto no tiene). Contraste: con 2 insumos, disponible.
      expect((await lista()).find((p) => p.product_id === combo)?.agotado).toBe(true)
      psql(`update public.products set stock_qty = 2 where id = '${insumo}';`)
      expect((await lista()).find((p) => p.product_id === combo)?.agotado).toBe(false)
      // 2. Categoría desactivada en el POS: la lista lo dice y no se puede publicar. Contraste: reactivada, sí.
      psql(`update public.categories set is_active = false where id = '${cat}';`)
      expect((await lista()).find((p) => p.product_id === combo)?.categoria_activa).toBe(false)
      expect(err(await guardar([{ product_id: combo, publicado: true, precio_domicilio: null }]))).toMatch(/categoría desactivada/)
      psql(`update public.categories set is_active = true where id = '${cat}';`)
      expect((await guardar([{ product_id: combo, publicado: true, precio_domicilio: null }])).error).toBeNull()
      // 3. Con el combo como único publicado y agotado, el portal NO queda incompleto por eso (el stock es
      //    de hoy). Contraste: con su categoría desactivada, sí falta "al menos un producto".
      expect((await owner.rpc('actualizar_portal', { p_cambios: { slug: LAB_SLUG } })).error).toBeNull()
      psql(`update public.products set stock_qty = 0 where id = '${insumo}';`)
      const faltan = () => fila(`select array_to_string(portal_faltantes_de('${SEDE}'), '|');`)
      expect(faltan()).not.toContain('al menos un producto')
      psql(`update public.categories set is_active = false where id = '${cat}';`)
      expect(faltan()).toContain('al menos un producto')
    } finally {
      psql(`delete from public.portal_productos where product_id in (${ids.map((i) => `'${i}'`).join(',') || 'null'});`)
      for (const i of ids) psql(`delete from public.products where id = '${i}';`)
      psql(`delete from public.categories where id = '${cat}';`)
    }
  })

  test('publicar: incompleto no se puede (y dice qué falta); completo sí; publicado no se deja incompleto', async () => {
    expect((await owner.rpc('actualizar_portal', { p_cambios: { slug: LAB_SLUG } })).error).toBeNull()
    const e1 = err(await owner.rpc('actualizar_portal', { p_cambios: { activo: true } }))
    for (const falta of ['la ubicación del local', 'la zona de cobertura', 'el valor del envío', 'el tiempo de entrega', 'el horario', 'al menos un producto publicado'])
      expect(e1).toContain(falta)
    expect(fila(`select activo from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('f')
    let est = (await owner.rpc('portal_estado')).data as { motivo: string; faltantes: string[] }
    expect(est.motivo).toBe('desactivado')
    expect(est.faltantes.length).toBe(6)

    // Polígono que deja el local por fuera: tampoco.
    expect((await owner.rpc('actualizar_portal', { p_cambios: {
      lat: 4.60, lng: -74.08, zona_tipo: 'poligono', zona_poligono: [[4.72, -74.08], [4.72, -74.06], [4.70, -74.06], [4.70, -74.08]],
      envio_tipo: 'fijo', envio_fijo: 4000, tiempo_min: 30, tiempo_max: 45, horario: HORARIO_TODO_EL_DIA,
    } })).error).toBeNull()
    expect((await owner.rpc('guardar_portal_productos', { p_cambios: [{ product_id: PROD_A, publicado: true, precio_domicilio: null }] })).error).toBeNull()
    const e2 = err(await owner.rpc('actualizar_portal', { p_cambios: { activo: true } }))
    expect(e2).toContain('que el local quede dentro de la zona')
    expect(e2).not.toContain('el horario')

    // Con el local adentro, se publica.
    expect((await owner.rpc('actualizar_portal', { p_cambios: { lat: 4.71, lng: -74.07, activo: true } })).error).toBeNull()
    expect(fila(`select activo from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('t')
    est = (await owner.rpc('portal_estado')).data as { motivo: string; faltantes: string[] }
    const hayTurno = fila(`select exists (select 1 from public.cash_shifts where restaurant_id = '${SEDE}' and closed_at is null);`) === 't'
    expect(est.motivo).toBe(hayTurno ? null : 'sin_turno')

    // Publicado: no se puede quitar el horario ni despublicar el único producto.
    expect(err(await owner.rpc('actualizar_portal', { p_cambios: { horario: {} } }))).toMatch(/Para publicar el portal falta: el horario/)
    expect(err(await owner.rpc('guardar_portal_productos', { p_cambios: [{ product_id: PROD_A, publicado: false, precio_domicilio: null }] })))
      .toMatch(/quedaría sin: al menos un producto/)
    expect(fila(`select publicado from public.portal_productos where product_id = '${PROD_A}';`)).toBe('t')

    // Pausa y reanuda: el motivo cambia.
    est = (await owner.rpc('pausar_pedidos_online', { p_pausar: true })).data as { motivo: string; faltantes: string[] }
    expect(est.motivo).toBe('pausado')
    est = (await owner.rpc('pausar_pedidos_online', { p_pausar: false })).data as { motivo: string; faltantes: string[] }
    expect(est.motivo).toBe(hayTurno ? null : 'sin_turno')

    // Despublicar sí se puede siempre.
    expect((await owner.rpc('actualizar_portal', { p_cambios: { activo: false } })).error).toBeNull()
    expect(((await owner.rpc('portal_estado')).data as { motivo: string }).motivo).toBe('desactivado')
  })

  test('publicado pero incompleto por un cambio en el POS (se desactiva el único producto): no recibe y dice qué falta', async () => {
    expect((await owner.rpc('actualizar_portal', { p_cambios: {
      slug: LAB_SLUG, lat: 4.71, lng: -74.07, zona_tipo: 'radio', zona_radio_m: 3000, envio_tipo: 'fijo', envio_fijo: 4000,
      tiempo_min: 30, tiempo_max: 45, horario: HORARIO_TODO_EL_DIA,
    } })).error).toBeNull()
    expect((await owner.rpc('guardar_portal_productos', { p_cambios: [{ product_id: PROD_A, publicado: true, precio_domicilio: null }] })).error).toBeNull()
    expect((await owner.rpc('actualizar_portal', { p_cambios: { activo: true } })).error).toBeNull()
    // El POS desactiva el producto: las RPC del portal no se enteran, el estado sí.
    psql(`update public.products set is_active = false where id = '${PROD_A}';`)
    try {
      const est = (await owner.rpc('portal_estado')).data as { recibe: boolean; motivo: string; faltantes: string[] }
      expect([est.recibe, est.motivo, est.faltantes]).toEqual([false, 'incompleto', ['al menos un producto publicado con precio']])
      // Con la pausa puesta, lo que falta sigue mandando (va antes en el orden).
      expect(((await owner.rpc('pausar_pedidos_online', { p_pausar: true })).data as { motivo: string }).motivo).toBe('incompleto')
    } finally {
      psql(`update public.products set is_active = true where id = '${PROD_A}';`)
    }
    expect(((await owner.rpc('portal_estado')).data as { motivo: string }).motivo).toBe('pausado')
  })

  test('horario en hora de Bogotá (R7): las fronteras, la medianoche y los casos donde UTC daría otro día', async () => {
    expect((await owner.rpc('actualizar_portal', { p_cambios: {
      slug: LAB_SLUG, lat: 4.71, lng: -74.07, zona_tipo: 'radio', zona_radio_m: 3000, envio_tipo: 'fijo', envio_fijo: 4000,
      tiempo_min: 30, tiempo_max: 45,
      // miércoles 5:00 p. m. a 11:30 p. m.; sábado 4:00 p. m. a 1:00 a. m. (pasa la medianoche)
      horario: { '3': [['17:00', '23:30']], '6': [['16:00', '01:00']] },
    } })).error).toBeNull()
    expect((await owner.rpc('guardar_portal_productos', { p_cambios: [{ product_id: PROD_A, publicado: true, precio_domicilio: null }] })).error).toBeNull()
    expect((await owner.rpc('actualizar_portal', { p_cambios: { activo: true } })).error).toBeNull()

    const motivo = async (iso: string) => ((await owner.rpc('portal_estado', { p_ahora: iso })).data as { motivo: string | null }).motivo
    const abierto = async (iso: string) => (await motivo(iso)) !== 'fuera_de_horario'
    const casos: [string, boolean, string][] = [
      ['2026-10-14T17:00:00-05:00', true, 'miércoles 5:00 p. m. (abre, incluido)'],
      ['2026-10-14T16:59:00-05:00', false, 'miércoles 4:59 p. m.'],
      ['2026-10-14T23:29:00-05:00', true, 'miércoles 11:29 p. m.'],
      ['2026-10-14T23:30:00-05:00', false, 'miércoles 11:30 p. m. (cierra, excluido)'],
      ['2026-10-15T00:30:00-05:00', false, 'jueves 12:30 a. m. (la del miércoles no pasa la medianoche)'],
      ['2026-10-17T23:00:00-05:00', true, 'sábado 11:00 p. m.'],
      ['2026-10-18T00:30:00-05:00', true, 'domingo 12:30 a. m. (la del sábado pasa la medianoche)'],
      ['2026-10-18T01:00:00-05:00', false, 'domingo 1:00 a. m. (cierra)'],
      ['2026-10-18T17:00:00-05:00', false, 'domingo 5:00 p. m. (cerrado)'],
      // Donde UTC cambiaría el resultado:
      ['2026-10-15T01:00:00Z', true, 'jueves 01:00 UTC = miércoles 8:00 p. m. en Bogotá'],
      ['2026-10-14T17:30:00Z', false, 'miércoles 17:30 UTC = miércoles 12:30 p. m. en Bogotá'],
    ]
    const obtenido = []
    for (const [iso] of casos) obtenido.push(await abierto(iso))
    expect(obtenido.map((v, i) => `${casos[i][2]}: ${v}`)).toEqual(casos.map(([, v, n]) => `${n}: ${v}`))
  })
})

// ─── Las guardas de supabase/portal-config.sql (corren el archivo en una transacción que se deshace) ──

test.describe('la guarda de portal-config.sql', () => {
  const cuerpo = () => readFileSync('supabase/portal-config.sql', 'utf-8').replace(/\r\n/g, '\n').split('\n')
    .filter((l) => l !== 'begin;' && l !== 'commit;').join('\n')
  const SIN_TABLAS = 'drop table public.portal_productos; drop table public.portal_sedes;'

  test('ya aplicada: re-aplicar aborta sin cambiar nada', () => {
    const r = psqlResultado(`begin;\n${cuerpo()}\nrollback;`)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('ya está aplicada')
  })

  test('precondición por md5: con otra has_permission aborta; con la vigente pasa la guarda (contraste)', () => {
    const otra = `create or replace function public.has_permission(perm text) returns boolean
      language sql stable security definer set search_path = public as $$ select true $$;`
    const conOtra = psqlResultado(`begin;\n${SIN_TABLAS}\n${otra}\n${cuerpo()}\nrollback;`)
    expect(conOtra.status).not.toBe(0)
    expect(conOtra.stderr).toContain('no son las de profiles-is-active-enforced.sql')
    // Contraste: con las funciones vigentes la guarda pasa (después choca con las funciones que ya
    // existen, porque aquí solo se borraron las tablas; ese error no es el de la precondición).
    const vigente = psqlResultado(`begin;\n${SIN_TABLAS}\n${cuerpo()}\nrollback;`)
    expect(vigente.stderr).not.toContain('no son las de profiles-is-active-enforced.sql')
    expect(vigente.stderr).toMatch(/already exists|ya existe/)
  })
})

// ─── La pantalla ────────────────────────────────────────────────────

async function abrirSeccion(page: Page, id: 'pedidos_online' | 'portal_productos') {
  await page.goto('/config')
  await page.getByTestId(`config-nav-${id}`).click()
}

test.describe('Pedidos en línea · la pantalla', () => {
  test('crear el portal, horario, envío y zona por radio; el "Slug público" ya no está en Restaurante', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/config')
    await expect(page.getByTestId('config-restaurant-name')).toBeVisible()
    await expect(page.getByText('Slug público')).toHaveCount(0)

    await page.getByTestId('config-nav-pedidos_online').click()
    await page.getByTestId('portal-slug').fill('E2E Portal LAB')
    await expect(page.getByTestId('portal-slug')).toHaveValue(LAB_SLUG)
    await expect(page.getByTestId('portal-slug-aviso')).toHaveText('Disponible')
    await page.getByTestId('portal-crear').click()
    await expect(page.getByTestId('portal-estado')).toHaveText('Portal sin publicar')
    expect(fila(`select slug || ':' || activo from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe(`${LAB_SLUG}:false`)
    await expect(page.getByTestId('portal-qr-descargar')).toBeVisible()

    // Horario: miércoles 5:00 p. m. a 11:30 p. m.
    await page.getByTestId('horario-editar').click()
    await page.getByTestId('horario-3-abre').check()
    await page.getByTestId('horario-3-0-desde').fill('17:00')
    await page.getByTestId('horario-3-0-hasta').fill('23:30')
    await page.getByTestId('horario-guardar').click()
    await expect(page.getByTestId('horario-resumen')).toContainText('Miércoles5:00 p. m. – 11:30 p. m.')
    expect(fila(`select horario::text from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('{"3": [["17:00", "23:30"]]}')

    // Envío fijo, mínimo y tiempo.
    await page.getByTestId('envio-tipo-fijo').check()
    await page.getByTestId('envio-fijo').fill('4000')
    await expect(page.getByTestId('envio-fijo')).toHaveValue('4.000')
    await page.getByTestId('pedido-minimo').fill('15000')
    await page.getByTestId('tiempo-min').fill('30')
    await page.getByTestId('tiempo-max').fill('45')
    await page.getByTestId('envio-guardar').click()
    await expect.poll(() => fila(`select envio_tipo || ':' || envio_fijo || ':' || pedido_minimo || ':' || tiempo_min || '-' || tiempo_max
        from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('fijo:4000.00:15000.00:30-45')

    // Zona: el local con un clic en el mapa y un radio de 2,5 km.
    await page.getByTestId('zona-tipo-radio').check()
    await page.getByTestId('zona-radio-km').fill('2,5')
    await page.getByTestId('zona-mover-local').click()
    await page.getByTestId('zona-mapa').click()
    await expect(page.getByTestId('zona-local')).toBeVisible()
    await page.getByTestId('zona-local-listo').click()
    await page.getByTestId('zona-guardar').click()
    await expect.poll(() => fila(`select (lat is not null) || ':' || zona_tipo || ':' || zona_radio_m
        from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('true:radio:2500')
  })

  test('zona dibujada: tres clics en el mapa son tres puntos guardados', async ({ page }) => {
    expect((await owner.rpc('actualizar_portal', { p_cambios: { slug: LAB_SLUG, lat: 4.711, lng: -74.0721 } })).error).toBeNull()
    await loginAsOwner(page)
    await abrirSeccion(page, 'pedidos_online')
    await page.getByTestId('zona-tipo-poligono').check()
    const mapa = page.getByTestId('zona-mapa')
    await mapa.scrollIntoViewIfNeeded()
    const caja = (await mapa.boundingBox())!
    // Posición relativa al mapa: Playwright lo trae a la vista antes de cada clic.
    for (const [fx, fy] of [[0.25, 0.3], [0.75, 0.3], [0.5, 0.8]]) {
      await mapa.click({ position: { x: caja.width * fx, y: caja.height * fy } })
    }
    await expect(page.getByTestId('zona-vertice')).toHaveCount(3)
    await page.getByTestId('zona-terminar').click()
    await page.getByTestId('zona-guardar').click()
    await expect.poll(() => fila(`select zona_tipo || ':' || jsonb_array_length(zona_poligono)
        from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('poligono:3')
  })

  test('productos en el portal: publicar, precio a domicilio, y el de $0 no se puede marcar', async ({ page }) => {
    await loginAsOwner(page)
    await abrirSeccion(page, 'portal_productos')
    await expect(page.getByTestId(`portal-producto-${PROD_AJENO}`)).toHaveCount(0)
    await expect(page.getByTestId(`portal-publicado-${PROD_CERO}`)).toBeDisabled()
    await expect(page.getByTestId(`portal-producto-${PROD_CERO}`)).toContainText('No se publica')
    await page.getByTestId(`portal-publicado-${PROD_A}`).check()
    await page.getByTestId(`portal-precio-${PROD_B}`).fill('9999')
    await page.getByTestId(`portal-publicado-${PROD_B}`).check()
    await expect(page.getByTestId(`portal-producto-${PROD_B}`)).toContainText('Precio distinto a domicilio')
    await expect(page.getByTestId('portal-productos-resumen')).toContainText('2 sin guardar')
    await page.getByTestId('portal-productos-guardar').click()
    await expect(page.getByTestId('portal-productos-resumen')).not.toContainText('sin guardar')
    expect(fila(`select string_agg(publicado || ':' || coalesce(precio_domicilio::text, 'igual'), ',' order by (product_id = '${PROD_B}'))
        from public.portal_productos where product_id in ('${PROD_A}', '${PROD_B}');`)).toBe('true:igual,true:9999.00')
  })

  test('publicar y pausar desde la tarjeta de estado; si falta algo, lo dice', async ({ page }) => {
    expect((await owner.rpc('actualizar_portal', { p_cambios: { slug: LAB_SLUG } })).error).toBeNull()
    await loginAsOwner(page)
    await abrirSeccion(page, 'pedidos_online')
    await page.getByTestId('portal-publicado').click()
    await expect(page.getByText(/Para publicar el portal falta: la ubicación del local/)).toBeVisible()
    await expect(page.getByTestId('portal-publicado')).not.toBeChecked()

    expect((await owner.rpc('actualizar_portal', { p_cambios: {
      lat: 4.71, lng: -74.07, zona_tipo: 'radio', zona_radio_m: 3000, envio_tipo: 'fijo', envio_fijo: 4000,
      tiempo_min: 30, tiempo_max: 45, horario: HORARIO_TODO_EL_DIA,
    } })).error).toBeNull()
    expect((await owner.rpc('guardar_portal_productos', { p_cambios: [{ product_id: PROD_A, publicado: true, precio_domicilio: null }] })).error).toBeNull()
    await page.reload()
    await page.getByTestId('config-nav-pedidos_online').click()
    await page.getByTestId('portal-publicado').click()
    await expect(page.getByTestId('portal-publicado')).toBeChecked()
    await expect(page.getByTestId('portal-estado')).toHaveText(/Recibiendo pedidos|Sin turno abierto/)
    await page.getByTestId('portal-pausar').click()
    await expect(page.getByTestId('portal-estado')).toHaveText('Pedidos pausados')
    expect(fila(`select activo || ':' || pausado from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('true:true')
  })

  test('cambiar el link, elegir y quitar el color, y el envío por distancia con un tramo agregado', async ({ page }) => {
    expect((await owner.rpc('actualizar_portal', { p_cambios: { slug: LAB_SLUG } })).error).toBeNull()
    await loginAsOwner(page)
    await abrirSeccion(page, 'pedidos_online')

    // Link nuevo: avisa que está libre y lo guarda.
    await page.getByTestId('portal-slug').fill('e2e-portal-lab-dos')
    await expect(page.getByTestId('portal-slug-aviso')).toHaveText('Disponible')
    await page.getByTestId('portal-slug-guardar').click()
    await expect.poll(() => fila(`select slug from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('e2e-portal-lab-dos')
    await expect(page.getByTestId('portal-copiar')).toBeVisible()

    // Color: se elige, se guarda y se quita (vuelve al verde de G-Vento = null).
    await page.getByTestId('portal-color').fill('#c2410c')
    await page.getByTestId('portal-color-guardar').click()
    await expect.poll(() => fila(`select coalesce(color, 'null') from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('#c2410c')
    await page.getByTestId('portal-color-quitar').click()
    await expect.poll(() => fila(`select coalesce(color, 'null') from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('null')

    // Envío por distancia: hasta 2 km $3.000, se agrega 2 a 4 km $4.000, más de 4 km $6.000.
    await page.getByTestId('envio-tipo-distancia').check()
    await page.getByTestId('envio-tramo-0-valor').fill('3000')
    await page.getByTestId('envio-tramo-1-valor').fill('6000')
    await page.getByTestId('envio-tramo-agregar').click()
    await page.getByTestId('envio-tramo-1-km').fill('4')
    await page.getByTestId('envio-tramo-1-valor').fill('4000')
    await expect(page.getByTestId('envio-tramo-2-etiqueta')).toHaveText('Más de 4 km, dentro de la zona')
    await page.getByTestId('tiempo-min').fill('30')
    await page.getByTestId('tiempo-max').fill('45')
    await page.getByTestId('envio-guardar').click()
    await expect.poll(() => fila(`select envio_tipo || ':' || (envio_tramos =
        '[{"hasta_km":2,"valor":3000},{"hasta_km":4,"valor":4000},{"hasta_km":null,"valor":6000}]'::jsonb)
        from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('distancia:true')

    // WhatsApp del local: arranca con el teléfono de la sede SIN guardarlo, se guarda y se quita.
    // El teléfono de prueba de LAB no es de Colombia: durante la prueba la sede tiene un celular
    // conocido, y se restaura al final.
    const telefonoOriginal = fila(`select coalesce(phone, '') from public.restaurants where id = '${SEDE}';`)
    psql(`update public.restaurants set phone = '300 555 0000' where id = '${SEDE}';`)
    try {
      await page.reload()
      await page.getByTestId('config-nav-pedidos_online').click()
      await expect(page.getByTestId('portal-whatsapp')).toHaveValue('300 555 0000')
      await expect(page.getByText('Todavía no está guardado')).toBeVisible()
      expect(fila(`select coalesce(whatsapp, 'null') from public.portal_sedes where restaurant_id = '${SEDE}';`), 'no se guarda solo').toBe('null')
    } finally {
      psql(`update public.restaurants set phone = '${telefonoOriginal.replace(/'/g, "''")}' where id = '${SEDE}';`)
    }
    // Un número que no sirve avisa al guardar (aunque no haya nada guardado).
    await page.getByTestId('portal-whatsapp').fill('123')
    await page.getByTestId('portal-whatsapp-guardar').click()
    await expect(page.getByText('Escribe un número de Colombia de 10 dígitos')).toBeVisible()
    await page.getByTestId('portal-whatsapp').fill('+57 315 555 0101')
    await page.getByTestId('portal-whatsapp-guardar').click()
    await expect.poll(() => fila(`select coalesce(whatsapp, 'null') from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('573155550101')
    await expect(page.getByTestId('portal-whatsapp')).toHaveValue('315 555 0101')
    await page.getByTestId('portal-whatsapp').fill('')
    await page.getByTestId('portal-whatsapp-guardar').click()
    await expect.poll(() => fila(`select coalesce(whatsapp, 'null') from public.portal_sedes where restaurant_id = '${SEDE}';`)).toBe('null')
  })
})
