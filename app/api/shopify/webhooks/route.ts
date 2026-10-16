import { after, NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/shopify";
import {
  deactivateShopifyProduct,
  upsertShopifyCustomer,
  upsertShopifyProduct,
} from "@/lib/shopify-sync";
import { createServiceClient } from "@/lib/supabase/service";
import { ShopifyCustomer, ShopifyProduct } from "@/lib/shopify";

// POST /api/shopify/webhooks
// Receives Shopify webhook deliveries. HMAC is verified against
// SHOPIFY_WEBHOOK_SECRET (fail-closed — unlike the Meta webhook this endpoint
// has no legacy traffic, so soft mode isn't needed). Every verified delivery
// is logged to shopify_webhook_events BEFORE processing so nothing is lost;
// topic processing then runs in after() so Shopify gets a fast 200.
//
// Topics:
//   orders/paid            → logged, consumed by M3 order flow
//   products/update        → incremental product+variant upsert
//   products/delete        → product+variants deactivated
//   customers/create|update→ shopify_customers upsert + lead phone link
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic") ?? "unknown";
  const webhookId = req.headers.get("x-shopify-webhook-id");

  const valid = verifyShopifyWebhook(rawBody, hmac);
  if (valid === null) {
    return NextResponse.json(
      { error: "SHOPIFY_WEBHOOK_SECRET is not configured" },
      { status: 503 }
    );
  }
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Durably log the event first — even if processing is killed mid-flight,
  // the unprocessed row keeps it recoverable.
  let eventId: string | null = null;
  try {
    const { data } = await createServiceClient()
      .from("shopify_webhook_events")
      .insert({
        topic,
        shopify_id: webhookId ?? (payload.id != null ? String(payload.id) : null),
        payload,
      })
      .select("id")
      .single();
    eventId = data?.id ?? null;
  } catch (err) {
    console.error("[shopify-webhook] failed to log event:", err);
  }

  after(async () => {
    const supabase = createServiceClient();
    let error: string | null = null;
    try {
      switch (topic) {
        case "products/update":
        case "products/create":
          await upsertShopifyProduct(supabase, payload as unknown as ShopifyProduct);
          break;
        case "products/delete":
          await deactivateShopifyProduct(supabase, payload.id as number);
          break;
        case "customers/create":
        case "customers/update":
          await upsertShopifyCustomer(supabase, payload as unknown as ShopifyCustomer);
          break;
        case "orders/paid":
          // Consumed by M3's order flow — the logged event row is the handoff.
          break;
        default:
          break;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Unknown processing error";
      console.error(`[shopify-webhook] ${topic} processing failed:`, error);
    }

    if (eventId) {
      await supabase
        .from("shopify_webhook_events")
        .update({ processed: error === null, error })
        .eq("id", eventId);
    }
  });

  return NextResponse.json({ ok: true });
}
