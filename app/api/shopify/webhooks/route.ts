import { after, NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/shopify";
import {
  deactivateShopifyProduct,
  upsertShopifyCustomer,
  upsertShopifyProduct,
} from "@/lib/shopify-sync";
import { createServiceClient } from "@/lib/supabase/service";
import { markOrderPaid, paidOrderIdentifiers } from "@/lib/orders";
import { ShopifyCustomer, ShopifyProduct } from "@/lib/shopify";
import type { Order } from "@/lib/types";

async function notifyOrderPaid(order: Order, payload: Record<string, unknown>) {
  const url = process.env.N8N_ORDER_PAID_URL ?? process.env.N8N_ORDER_PAID_WEBHOOK_URL;
  if (!url) {
    await createServiceClient().from("order_events").insert({
      order_id: order.id,
      event: "paid_notification_skipped",
      detail: { reason: "N8N_ORDER_PAID_URL not configured" },
    });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order, shopify_order: payload }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`n8n order-paid webhook → HTTP ${res.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }

  await createServiceClient().from("order_events").insert({
    order_id: order.id,
    event: "paid_notification_sent",
    detail: { url: new URL(url).pathname },
  });
}

// POST /api/shopify/webhooks
// Receives Shopify webhook deliveries. HMAC is verified against
// SHOPIFY_WEBHOOK_SECRET (fail-closed — unlike the Meta webhook this endpoint
// has no legacy traffic, so soft mode isn't needed). Every verified delivery
// is logged to shopify_webhook_events BEFORE processing so nothing is lost;
// topic processing then runs in after() so Shopify gets a fast 200.
//
// Topics:
//   orders/paid            → match Layla order, mark paid, notify n8n for confirmation/staff alert
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
  // the unprocessed row keeps it recoverable. shopify_id carries the unique
  // X-Shopify-Webhook-Id delivery id, so a Shopify retry hits the unique index
  // (23505) and is acknowledged without re-processing.
  let eventId: string | null = null;
  try {
    const { data, error: insertError } = await createServiceClient()
      .from("shopify_webhook_events")
      .insert({
        topic,
        shopify_id: webhookId ?? (payload.id != null ? String(payload.id) : null),
        payload,
      })
      .select("id")
      .single();
    if (insertError) {
      if (insertError.code !== "23505") throw insertError;
      // Same delivery id seen before. If the earlier attempt already
      // processed cleanly this is a pure retry — ack and drop it. If it
      // failed or never finished, reprocess under the existing event row.
      const { data: existing } = await createServiceClient()
        .from("shopify_webhook_events")
        .select("id, processed")
        .eq(
          "shopify_id",
          webhookId ?? (payload.id != null ? String(payload.id) : "")
        )
        .limit(1)
        .maybeSingle();
      if (!existing || existing.processed) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      eventId = existing.id;
    } else {
      eventId = data?.id ?? null;
    }
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
        case "orders/paid": {
          const identifiers = paidOrderIdentifiers(payload);
          const paid = await markOrderPaid(supabase, identifiers);
          if (!paid.matched) {
            throw new Error(
              `orders/paid received with no matching Layla order (shopify_order_id=${identifiers.shopifyOrderId ?? "unknown"})`
            );
          }
          if (!paid.alreadyPaid) {
            await notifyOrderPaid(paid.order, payload);
          }
          break;
        }
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
