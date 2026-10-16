-- Eastern Wear Phase 1 · M3: Stock-on-Hand Order Flow
-- Scope freeze refs: §4.3, §8 metrics
--
-- Orders are created by n8n after Layla has confirmed item(s), customer
-- details and delivery/collection. The app revalidates live Shopify stock,
-- creates a Shopify draft order, stores its secure invoice/payment link and
-- tracks the order through payment.

-- 1. orders ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number             serial UNIQUE,
  phone_number             text NOT NULL,
  lead_id                  bigint REFERENCES public.leads(id) ON DELETE SET NULL,
  customer_name            text,
  customer_email           text,
  shopify_draft_order_id   bigint UNIQUE,
  shopify_order_id         bigint UNIQUE,
  shopify_order_number     text,
  order_track              text NOT NULL DEFAULT 'stock_on_hand'
    CHECK (order_track IN ('stock_on_hand','imported')),
  items                    jsonb NOT NULL,
  subtotal_cents           integer,
  delivery_fee_cents       integer NOT NULL DEFAULT 0,
  total_cents              integer,
  currency                 text NOT NULL DEFAULT 'ZAR',
  delivery_method          text CHECK (delivery_method IN ('delivery','collection')),
  delivery_address         jsonb,
  payment_link             text,
  status                   text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','paid','payment_failed','cancelled','expired')),
  paid_at                  timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_orders_set_updated_at ON public.orders;
CREATE TRIGGER trg_orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_orders_phone
  ON public.orders (phone_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status
  ON public.orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_track
  ON public.orders (order_track, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_lead
  ON public.orders (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_pending_expiry
  ON public.orders (created_at) WHERE status = 'pending_payment';

-- 2. order_events ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event       text NOT NULL,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order
  ON public.order_events (order_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_order_events_type
  ON public.order_events (event, created_at DESC);

-- 3. RLS ----------------------------------------------------------------------
ALTER TABLE public.orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders', 'order_events']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_select_auth', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_insert_auth', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_update_auth', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_delete_auth', t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true);', t || '_select_auth', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true);', t || '_insert_auth', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true);', t || '_update_auth', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true);', t || '_delete_auth', t);
  END LOOP;
END $$;
