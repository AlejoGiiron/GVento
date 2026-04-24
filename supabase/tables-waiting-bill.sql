-- Fase 05: Gestión de mesas
-- Ejecutar en el SQL Editor de Supabase

-- 1. Agregar estado waiting_bill al enum table_status
ALTER TYPE table_status ADD VALUE IF NOT EXISTS 'waiting_bill';

-- 2. (Opcional) Actualizar tablas existentes en estado 'reserved' no utilizadas
-- ALTER TABLE tables ALTER COLUMN status SET DEFAULT 'free';
