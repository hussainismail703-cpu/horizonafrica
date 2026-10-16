-- Eastern Wear Phase 1 · M3 follow-up: Shopify webhook replay dedupe
--
-- Shopify retries a failed/suspect delivery with the SAME
-- X-Shopify-Webhook-Id. The event log must reject a second insert for a
-- delivery id we already recorded so the after() processing never runs twice.
-- Partial index keeps multiple NULL ids (missing header) legal.

CREATE UNIQUE INDEX IF NOT EXISTS uq_shopify_webhook_events_shopify_id
  ON public.shopify_webhook_events (shopify_id)
  WHERE shopify_id IS NOT NULL;
