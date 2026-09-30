-- supabase/diag/product-images-tamanos.sql
-- ============================================================================
-- DIAGNÓSTICO de SOLO LECTURA. Antes de decidir un límite de tamaño/tipo en el
-- bucket product-images (prod hoy no tiene ninguno): ¿qué hay subido de verdad?
-- El cliente (ImageUpload.tsx → validate) ya rechaza lo que no sea
-- jpeg/png/webp y lo que pase de 2 MB; un objeto fuera de eso en prod entró
-- por otro camino (o antes de esa validación).
-- QUÉ ESCRIBE: nada. RE-EJECUTAR: inofensivo.
-- ============================================================================
select coalesce(o.metadata->>'mimetype', '(sin tipo)')                  as tipo,
       count(*)                                                          as objetos,
       count(*) filter (where (o.metadata->>'size')::bigint > 2097152)   as mayores_a_2mb,
       pg_size_pretty(max((o.metadata->>'size')::bigint))                as el_mas_grande,
       pg_size_pretty(percentile_cont(0.5) within group
                      (order by (o.metadata->>'size')::bigint)::bigint)  as mediana,
       max(o.created_at at time zone 'America/Bogota')                   as ultimo_bogota
  from storage.objects o
 where o.bucket_id = 'product-images'
 group by 1
 order by 2 desc;
-- CÓMO LEERLO:
--   · todo jpeg/png/webp y mayores_a_2mb = 0 ⇒ un límite de servidor IGUAL al
--     del cliente no rompe nada existente (solo cierra el acceso directo a la API).
--   · aparece image/heic u otro tipo, o mayores_a_2mb > 0 ⇒ algo sube por fuera
--     de ImageUpload: averiguar qué antes de poner el límite.
