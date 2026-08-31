-- ============================================================
-- LabCentro — organización de laboratorio para G-Centro
--
-- POR QUÉ EXISTE: el esquema de G-Centro tiene un unique sobre
-- (producto_id, organizacion_externa_id) que impide vincular dos contratos a
-- la misma organización. LAB ya está vinculado, así que necesitan una SEGUNDA
-- organización para ejercitar el paso de vincular. La restricción es
-- deliberada de su lado (evita que dos contratos apunten al mismo tenant), así
-- que la solución correcta es una organización nueva, no relajarla.
--
-- QUÉ CREA: SOLO la fila de `organizations`. Nada más.
--   · NO crea sede (`restaurants`), NI roles, NI usuarios.
--   · Alcanza para lo que G-Centro necesita: un UUID al que vincular un
--     contrato y sobre el que escribir banderas con `aplicar-estado` (que usa
--     service role y por lo tanto no depende de RLS ni de que haya usuarios).
--
-- 🔴 LIMITACIÓN QUE HAY QUE SABER ANTES DE USARLA: sin sede y sin usuarios,
-- NADIE PUEDE INICIAR SESIÓN en LabCentro, así que el banner de G-Vento
-- **no se puede ver** para esta organización. Este tenant sirve para probar el
-- lado de ESCRITURA (crear contrato, vincular, escribir la bandera), no el de
-- LECTURA. Para verificar que una bandera produce efecto visible hay que usar
-- LAB, que sí tiene sede y usuarios. Si más adelante hiciera falta el efecto
-- visible acá, el camino es `supabase/onboard-org.sql` (crea sede + 4 roles +
-- usuario owner), no agregarle piezas sueltas a esta.
--
-- ── SOBRE "MARCARLA COMO TENANT DE LABORATORIO" ─────────────────────────────
-- ⚠️ Se hace lo que se puede, y conviene ser explícito sobre qué NO es:
-- **G-Vento no tiene ningún concepto de "organización de prueba".** No hay
-- columna `is_test`, ni vistas de cobranza, ni reportes que crucen
-- organizaciones — cada consulta está acotada por RLS a la organización propia.
-- O sea que del lado de G-Vento NO HAY NINGÚN LUGAR del que haya que excluirla.
-- El marcador en `config` es DOCUMENTACIÓN dentro de la fila: sirve para que
-- quien mire la tabla entienda qué es, y para poder filtrarla a mano. Ningún
-- código lo lee. Si algún día G-Vento gana una vista multi-organización, ESTE
-- es el marcador que hay que respetar.
-- La exclusión real de cobranza vive del lado de G-Centro (`es_prueba = true`).
--
-- ── IDEMPOTENTE ─────────────────────────────────────────────────────────────
-- `organizations.name` tiene UNIQUE desde organization-subscription.sql, así
-- que el `on conflict` hace que re-ejecutar esto sea inofensivo: no duplica ni
-- pisa. Devuelve siempre la fila existente.
--
-- ⚠️ El unique es sensible a mayúsculas y espacios ('LabCentro' ≠ 'labcentro'
-- ≠ 'LabCentro '). Por eso G-CENTRO DEBE GUARDAR EL UUID, NUNCA EL NOMBRE.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor.
-- ============================================================

begin;

insert into public.organizations (name, config)
values (
  'LabCentro',
  jsonb_build_object(
    'es_laboratorio', true,
    'proposito',      'Tenant de prueba de G-Centro: alta y vinculación de suscripciones',
    'no_es_cliente',  true,
    'creada',         '2026-08-19'
  )
)
on conflict (name) do nothing;

commit;


-- ============================================================
-- SALIDA PARA G-CENTRO — nombre y UUID juntos, de una sola copia.
-- Correr esto y pasar la línea tal cual.
-- ============================================================
select name || '  ' || id as "copiar_tal_cual"
  from public.organizations
 where name = 'LabCentro';


-- ============================================================
-- Verificación (opcional): estado inicial de la bandera.
-- Debe salir 'active' con mensaje y timestamp en NULL — nunca fue escrita.
-- Es la línea base contra la que G-Centro compara su primera escritura.
-- ============================================================
select name,
       subscription_status,
       subscription_message,
       subscription_updated_at
  from public.organizations
 where name = 'LabCentro';
