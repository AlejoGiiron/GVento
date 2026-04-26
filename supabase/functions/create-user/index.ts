import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Admin client — usa service role para crear usuarios
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Cliente del llamante — verifica que esté autenticado
    const caller = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )

    const { data: { user }, error: authErr } = await caller.auth.getUser()
    if (authErr || !user) return json({ error: 'No autorizado' }, 401)

    // Verifica que el llamante sea admin del restaurante
    const { data: callerProfile, error: profErr } = await admin
      .from('profiles')
      .select('role, restaurant_id')
      .eq('id', user.id)
      .single()

    if (profErr || !callerProfile) return json({ error: 'Perfil no encontrado' }, 403)
    if (callerProfile.role !== 'admin') return json({ error: 'Se requiere rol admin' }, 403)

    // Parsea y valida el cuerpo
    const { email, password, full_name, role, restaurant_id } = await req.json()

    if (!email || !password || !full_name || !role || !restaurant_id)
      return json({ error: 'Faltan campos requeridos' }, 400)

    if (password.length < 8)
      return json({ error: 'La contraseña debe tener mínimo 8 caracteres' }, 400)

    if (!['admin', 'cashier', 'waiter'].includes(role))
      return json({ error: 'Rol inválido' }, 400)

    // El restaurant_id debe coincidir con el del llamante
    if (restaurant_id !== callerProfile.restaurant_id)
      return json({ error: 'No tienes permiso sobre ese restaurante' }, 403)

    // Crea el usuario — email_confirm:true para que no necesite verificar correo
    // user_metadata es leído por el trigger handle_new_user para crear el profile
    const { data, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role, restaurant_id },
    })

    if (createErr) return json({ error: createErr.message }, 400)

    return json({ success: true, user_id: data.user?.id })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
