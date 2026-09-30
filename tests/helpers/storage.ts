import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Creds } from './auth'

// ============================================================================
// Helpers de Storage para los specs de aislamiento entre clientes
// (storage-logos, storage-product-images). Un solo lugar para las dos trampas:
//
// 🔴 remove() sobre un objeto que la RLS no deja borrar NO devuelve error:
//    devuelve una lista vacía. Todo borrado se verifica con `existe()`.
// 🔴 La sede de cada usuario se lee del PERFIL: es la carpeta que usa la app
//    (`<profile.restaurant_id>/…` en supabase-helpers).
// ============================================================================

export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

export const otraCreds = (): Creds => ({
  email: process.env.E2E_OTRA_EMAIL!,
  password: process.env.E2E_OTRA_PASSWORD!,
})

export type Usuario = { c: SupabaseClient; sede: string }

/** Cliente autenticado (anon key + login, NO service role) y su sede activa. */
export async function usuario(creds: Creds): Promise<Usuario> {
  if (!creds.email) throw new Error('faltan credenciales (¿E2E_OTRA_* en scripts/capturas/local.config?)')
  const c = createClient(process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword(creds)
  if (error) throw new Error(`login ${creds.email}: ${error.message}`)
  const { data: { user } } = await c.auth.getUser()
  const { data, error: e2 } = await c.from('profiles').select('restaurant_id').eq('id', user!.id).single()
  if (e2) throw e2
  return { c, sede: data!.restaurant_id as string }
}

export const subir = (c: SupabaseClient, bucket: string, path: string) =>
  c.storage.from(bucket).upload(path, PNG_1PX, { upsert: true, contentType: 'image/png' })

/** ¿Existe el objeto? Se pregunta con un cliente que puede listar (lectura pública). */
export async function existe(c: SupabaseClient, bucket: string, path: string): Promise<boolean> {
  const i = path.lastIndexOf('/')
  const [carpeta, nombre] = [path.slice(0, i), path.slice(i + 1)]
  const { data, error } = await c.storage.from(bucket).list(carpeta, { search: nombre })
  if (error) throw error
  return (data ?? []).some((f) => f.name === nombre)
}
