import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, cashierCreds, waiterCreds, type Creds } from './auth'
import { psql } from './db-local'

// ============================================================================
// A — permisos de cobro: la MATRIZ de roles de las pruebas y las sondas del servidor.
// Lo que la pantalla muestra se compara con lo que el servidor ACEPTA, rol por rol.
//
// Roles: los tres de sistema de LAB (dueño, cajero, mozo) y dos PERSONALIZADOS que se
// le asignan al mozo de prueba por un rato (snapshot y restauración por id):
//   e2e-sin-cobro  → mesas.gestionar                  (no vende, no cobra mesas)
//   e2e-solo-mesa  → mesas.gestionar, mesas.cobrar    (no vende, cobra mesas)
// Todo en la base LOCAL y en la organización del mozo de prueba (por su perfil).
// ============================================================================

export type Caso = {
  nombre: string
  creds: () => Creds
  /** Rol personalizado a asignarle al mozo de prueba durante el caso. */
  rolPersonalizado?: 'e2e-sin-cobro' | 'e2e-solo-mesa'
  pos: boolean          // vende (POS y /m): pos.vender
  mesa: boolean         // cobra mesas: mesas.cobrar
  redirige: boolean     // en el celular, va solo a /m (rol viejo dueño/admin/cajero, hasta M2)
}

export const CASOS: Caso[] = [
  { nombre: 'dueño',        creds: ownerCreds,   pos: true,  mesa: true,  redirige: true },
  { nombre: 'cajero',       creds: cashierCreds, pos: true,  mesa: true,  redirige: true },
  { nombre: 'mozo',         creds: waiterCreds,  pos: true,  mesa: true,  redirige: false },
  { nombre: 'sin cobro',    creds: waiterCreds,  rolPersonalizado: 'e2e-sin-cobro', pos: false, mesa: false, redirige: false },
  { nombre: 'solo mesa',    creds: waiterCreds,  rolPersonalizado: 'e2e-solo-mesa', pos: false, mesa: true,  redirige: false },
]

const PERSONALIZADOS: Record<string, string[]> = {
  'e2e-sin-cobro': ['mesas.gestionar'],
  'e2e-solo-mesa': ['mesas.gestionar', 'mesas.cobrar'],
}

let snapMozo: { role: string; role_id: string } | null = null

/** Crea los roles personalizados en la organización del mozo de prueba y guarda su rol. */
export function prepararRoles() {
  const email = waiterCreds().email
  const [role, role_id] = psql(`select role || '|' || role_id from public.profiles where email = '${email}';`).split('|')
  snapMozo = { role, role_id }
  expect(role, 'el mozo de prueba parte como waiter').toBe('waiter')
  for (const [nombre, permisos] of Object.entries(PERSONALIZADOS)) {
    psql(`insert into public.roles (organization_id, name, is_system, permissions)
          select organization_id, '${nombre}', false, '${JSON.stringify(permisos)}'::jsonb
            from public.profiles where email = '${email}'
          on conflict (organization_id, name) do update set permissions = excluded.permissions;`)
  }
}

/** Le asigna al mozo de prueba un rol personalizado (rol viejo: waiter, como lo haría la app). */
export function asignarRol(nombre: string) {
  const email = waiterCreds().email
  const n = psql(`with u as (update public.profiles p set role = 'waiter',
                    role_id = (select r.id from public.roles r where r.organization_id = p.organization_id and r.name = '${nombre}')
                   where p.email = '${email}' returning 1) select count(*) from u;`)
  expect(n).toBe('1')
}

/** Devuelve al mozo de prueba su rol original (por id). Idempotente. */
export function restaurarMozo() {
  if (!snapMozo) return
  psql(`update public.profiles set role = '${snapMozo.role}', role_id = '${snapMozo.role_id}' where email = '${waiterCreds().email}';`)
}

/** Restaura al mozo y borra los roles personalizados (sin usuarios ya). */
export function limpiarRoles() {
  restaurarMozo()
  psql(`delete from public.roles r using public.profiles p
         where p.email = '${waiterCreds().email}' and r.organization_id = p.organization_id
           and r.name in (${Object.keys(PERSONALIZADOS).map((n) => `'${n}'`).join(',')}) and not r.is_system;`)
}

/**
 * Sonda del POS: register_pos_sale SIN ítems. No escribe nada (falla antes de la orden).
 * Con pos.vender responde "La venta no tiene ítems"; sin él, "No tienes permiso para vender".
 */
export async function sondaVenta(c: SupabaseClient): Promise<string> {
  const { error } = await c.rpc('register_pos_sale', {
    p_sale_id: randomUUID(), p_order: { type: 'takeaway', total: 8000 }, p_items: [], p_payments: [],
  })
  expect(error, 'la sonda tiene que fallar siempre (no lleva ítems)').not.toBeNull()
  return error!.message
}

/**
 * Sonda del cobro de mesa: register_sale_payment SIN pagos sobre una orden dine_in. No
 * escribe nada. Sin mesas.cobrar: "No tienes permiso para cobrar mesas"; con él, falla
 * más adelante por otra razón (sin líneas de pago), que NO es de permiso.
 */
export async function sondaCobroMesa(c: SupabaseClient, ordenId: string): Promise<string> {
  const { error } = await c.rpc('register_sale_payment', { p_order_id: ordenId, p_payments: [] })
  expect(error, 'la sonda tiene que fallar siempre (no lleva pagos)').not.toBeNull()
  return error!.message
}

export const SIN_PERMISO_VENDER = 'No tienes permiso para vender'
export const SIN_PERMISO_MESA = 'No tienes permiso para cobrar mesas'
