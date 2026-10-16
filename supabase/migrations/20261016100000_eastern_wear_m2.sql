-- Eastern Wear Phase 1 · M2: Shopify Connection
-- Scope freeze refs: §4.3 (stock read), §4.7 (customer sync)
--
-- Adds a Shopify-mirrored catalog (products + variants with live stock),
-- a Shopify customer mirror matched to leads by phone, and a raw
-- shopify_webhook_events log used for debugging/auditing inbound Shopify
-- webhooks (orders/paid is consumed by M3's order flow).
--
-- NOTE: the legacy `products` table is DEPRECATED but intentionally left in
-- place until M7 — the n8n "Fetch Products" node will be repointed at
-- shopify_products/shopify_variants once syncs are verified.
--
-- All statements are idempotent (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS).

-- 1. shopify_products -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shopify_products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_product_id  bigint NOT NULL UNIQUE,
  handle              text,
  title               text NOT NULL,
  category            text,
  image_url           text,
  description         text,
  is_active           boolean NOT NULL DEFAULT true,
  last_synced_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_shopify_products_set_updated_at ON public.shopify_products;
CREATE TRIGGER trg_shopify_products_set_updated_at
  BEFORE UPDATE ON public.shopify_products
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- 2. shopify_variants -------------------------------------------------------
-- One row per sellable variant (size/colour). price_cents mirrors Shopify's
-- price; inventory_qty/available are refreshed by product syncs and by the
-- live stock endpoint.
CREATE TABLE IF NOT EXISTS public.shopify_variants (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           uuid NOT NULL REFERENCES public.shopify_products(id) ON DELETE CASCADE,
  shopify_variant_id   bigint NOT NULL UNIQUE,
  title                text,
  sku                  text,
  price_cents          integer,
  inventory_qty        integer,
  inventory_item_id    bigint,
  available            boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_shopify_variants_set_updated_at ON public.shopify_variants;
CREATE TRIGGER trg_shopify_variants_set_updated_at
  BEFORE UPDATE ON public.shopify_variants
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_shopify_variants_product
  ON public.shopify_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_shopify_variants_item
  ON public.shopify_variants (inventory_item_id) WHERE inventory_item_id IS NOT NULL;

-- 3. shopify_customers ------------------------------------------------------
-- Mirror of Shopify customers. `phone` is normalised to canonical SA format
-- (27…) so it can be joined to leads.phone_number.
CREATE TABLE IF NOT EXISTS public.shopify_customers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_customer_id   bigint NOT NULL UNIQUE,
  phone                 text,
  email                 text,
  full_name             text,
  orders_count          integer NOT NULL DEFAULT 0,
  total_spent_cents     bigint NOT NULL DEFAULT 0,
  tags                  text[] NOT NULL DEFAULT '{}',
  synced_to_broadcast   boolean NOT NULL DEFAULT false,
  last_synced_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopify_customers_phone
  ON public.shopify_customers (phone) WHERE phone IS NOT NULL;

-- 4. leads ↔ shopify link ---------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS shopify_customer_id bigint;
CREATE INDEX IF NOT EXISTS idx_leads_shopify_customer_id
  ON public.leads (shopify_customer_id) WHERE shopify_customer_id IS NOT NULL;

-- 5. shopify_webhook_events --------------------------------------------------
-- Raw log of inbound Shopify webhooks. Every verified delivery lands here so
-- failed/lost processing is recoverable and auditable; orders/paid rows are
-- consumed by M3's order flow.
CREATE TABLE IF NOT EXISTS public.shopify_webhook_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic        text NOT NULL,
  shopify_id   text,
  payload      jsonb NOT NULL,
  processed    boolean NOT NULL DEFAULT false,
  error        text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopify_webhook_events_topic
  ON public.shopify_webhook_events (topic, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_shopify_webhook_events_unprocessed
  ON public.shopify_webhook_events (received_at) WHERE NOT processed;

-- 6. RLS ---------------------------------------------------------------------
ALTER TABLE public.shopify_products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_variants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_customers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_webhook_events  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'shopify_products', 'shopify_variants', 'shopify_customers', 'shopify_webhook_events'
  ]
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
