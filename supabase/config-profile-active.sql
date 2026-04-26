-- Agrega is_active a profiles para poder desactivar usuarios sin eliminarlos
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
