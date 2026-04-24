ALTER TABLE public.order_items
  ADD COLUMN sent_to_kitchen boolean NOT NULL DEFAULT false;
