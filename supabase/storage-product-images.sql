-- Bucket público para imágenes de productos
-- Ejecutar en Supabase Dashboard → SQL Editor

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  2097152,  -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Lectura pública (para menú digital sin autenticación)
CREATE POLICY "product-images: lectura pública"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

-- Upload solo para usuarios autenticados
CREATE POLICY "product-images: upload autenticado"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'product-images');

-- Update solo para usuarios autenticados
CREATE POLICY "product-images: update autenticado"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'product-images');

-- Delete solo para usuarios autenticados
CREATE POLICY "product-images: delete autenticado"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'product-images');
