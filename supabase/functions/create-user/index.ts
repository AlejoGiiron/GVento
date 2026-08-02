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

    // Verifica que el llamante esté ACTIVO y tenga permiso sobre el restaurante.
    const { data: callerProfile, error: profErr } = await admin
      .from('profiles')
      .select('is_active, restaurant_id, organization_id')
      .eq('id', user.id)
      .single()

    if (profErr || !callerProfile) return json({ error: 'Perfil no encontrado' }, 403)

    // is_active explícito ANTES del permiso: un admin desactivado con sesión viva
    // podía crear usuarios nuevos vía service role (persistencia: te desactivan,
    // te creás otra cuenta). has_permission ya filtra is_active por su cuenta,
    // pero este chequeo da el mensaje correcto en vez de "sin permiso".
    if (!callerProfile.is_active)
      return json({ error: 'Tu usuario está desactivado' }, 403)

    // Gate por PERMISO RBAC, no por el enum legacy `role`. Se ejecuta con el
    // cliente del LLAMANTE: has_permission() resuelve por auth.uid().
    const { data: puede, error: permErr } = await caller.rpc('has_permission', {
      perm: 'usuarios.gestionar',
    })
    if (permErr) return json({ error: 'No se pudo verificar el permiso' }, 403)
    if (!puede) return json({ error: 'Se requiere el permiso usuarios.gestionar' }, 403)

    // Parsea y valida el cuerpo. `role_id` (RBAC) es opcional por compatibilidad
    // con llamantes viejos, pero la UI siempre lo manda.
    const { email, password, full_name, role, role_id, restaurant_id } = await req.json()

    if (!email || !password || !full_name || !role || !restaurant_id)
      return json({ error: 'Faltan campos requeridos' }, 400)

    if (password.length < 8)
      return json({ error: 'La contraseña debe tener mínimo 8 caracteres' }, 400)

    if (!['admin', 'cashier', 'waiter'].includes(role))
      return json({ error: 'Rol inválido' }, 400)

    // El restaurant_id debe coincidir con el del llamante
    if (restaurant_id !== callerProfile.restaurant_id)
      return json({ error: 'No tienes permiso sobre ese restaurante' }, 403)

    // Validación del rol RBAC ANTES de crear la cuenta: si el rol es inválido
    // conviene rechazar sin haber creado nada, y así la compensación de abajo
    // queda solo para el fallo genuino del UPDATE (raro), no para el caso comun.
    // Cross-org: el rol DEBE pertenecer a la organización del llamante. La UI
    // solo lista los de su org, pero la Edge Function es un endpoint directo.
    if (role_id) {
      const { data: rol, error: rolErr } = await admin
        .from('roles')
        .select('id, organization_id')
        .eq('id', role_id)
        .maybeSingle()

      if (rolErr) return json({ error: 'No se pudo verificar el rol' }, 500)
      if (!rol) return json({ error: 'El rol indicado no existe' }, 400)
      if (rol.organization_id !== callerProfile.organization_id)
        return json({ error: 'El rol no pertenece a tu organización' }, 403)
    }

    // Crea el usuario — email_confirm:true para que no necesite verificar correo.
    // user_metadata es leído por el trigger handle_new_user para crear el profile
    // (que ademas DERIVA organization_id de la sede). role_id NO va en la
    // metadata a propósito: es un canal que el usuario controla en un signUp
    // abierto, y ya se confía en él para el enum `role` (deuda anotada). Meter
    // role_id ahí convertiría esa deuda en escalada directa a owner.
    const { data, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role, restaurant_id },
    })

    if (createErr) return json({ error: createErr.message }, 400)

    const newUserId = data.user?.id
    if (!newUserId) return json({ error: 'No se pudo crear el usuario' }, 500)

    // Asignación del rol RBAC EN EL SERVIDOR. Antes lo hacía el navegador en un
    // segundo paso (useUsers): si ese paso fallaba —o se cerraba la pestaña— el
    // perfil quedaba SIN ROL y por lo tanto SIN NINGÚN PERMISO (has_permission
    // hace JOIN contra roles). Ahora ocurre acá, en el mismo request.
    if (role_id) {
      const { error: roleErr } = await admin
        .from('profiles')
        .update({ role_id })
        .eq('id', newUserId)

      if (roleErr) {
        // COMPENSACIÓN: deshacer la creación en vez de dejar un usuario a medias.
        // profiles.id referencia auth.users ON DELETE CASCADE, así que borrar la
        // cuenta se lleva el perfil: no queda residuo. Si el propio delete falla
        // se reporta igual — es preferible un error ruidoso a un perfil mudo.
        const { error: delErr } = await admin.auth.admin.deleteUser(newUserId)
        if (delErr)
          return json({
            error: 'No se pudo asignar el rol y tampoco revertir la creación. ' +
                   `Revisa manualmente el usuario ${email}.`,
          }, 500)
        return json({ error: 'No se pudo asignar el rol; el usuario no fue creado' }, 500)
      }
    }

    return json({ success: true, user_id: newUserId })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
