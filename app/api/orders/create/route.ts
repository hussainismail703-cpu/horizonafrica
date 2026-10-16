import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createOrder, CreateOrderItemInput } from "@/lib/orders";
import type { DeliveryMethod } from "@/lib/types";

export const maxDuration = 60;

const DELIVERY_METHODS: DeliveryMethod[] = ["delivery", "collection"];

// POST /api/orders/create
// Called by n8n after Layla has assembled a confirmed order. Always Bearer
// APP_SECRET authenticated — dashboard users view orders through /api/orders.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const appSecret = process.env.APP_SECRET;
  if (!appSecret || authHeader !== `Bearer ${appSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const phone = body.phone ?? body.phone_number;
  if (typeof phone !== "string" || !phone.trim()) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }

  const deliveryMethod = body.delivery_method;
  if (!DELIVERY_METHODS.includes(deliveryMethod as DeliveryMethod)) {
    return NextResponse.json(
      { error: "delivery_method must be delivery or collection" },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50) {
    return NextResponse.json(
      { error: "items must contain 1–50 line items" },
      { status: 400 }
    );
  }

  const items: CreateOrderItemInput[] = [];
  for (const raw of body.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json({ error: "Each item must be an object" }, { status: 400 });
    }
    const item = raw as Record<string, unknown>;
    const variantId = Number(item.variant_id ?? item.shopify_variant_id);
    const qty = Number(item.qty ?? item.quantity);
    if (!Number.isInteger(variantId) || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      return NextResponse.json(
        { error: "Each item needs numeric variant_id and qty between 1 and 99" },
        { status: 400 }
      );
    }
    items.push({ variant_id: variantId, qty });
  }

  const fee = body.delivery_fee_cents ?? body.delivery_fee;
  const deliveryFeeCents =
    fee === undefined || fee === null ? 0 : Number(fee);
  if (!Number.isInteger(deliveryFeeCents) || deliveryFeeCents < 0 || deliveryFeeCents > 1_000_000) {
    return NextResponse.json(
      { error: "delivery_fee_cents must be an integer between 0 and 1000000" },
      { status: 400 }
    );
  }

  let deliveryAddress: Record<string, unknown> | null = null;
  if (typeof body.delivery_address === "string" && body.delivery_address.trim()) {
    deliveryAddress = { address1: body.delivery_address.trim().slice(0, 300) };
  } else if (
    body.delivery_address &&
    typeof body.delivery_address === "object" &&
    !Array.isArray(body.delivery_address)
  ) {
    deliveryAddress = Object.fromEntries(
      Object.entries(body.delivery_address as Record<string, unknown>)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [
          key.slice(0, 60),
          typeof value === "string" ? value.replace(/\x00/g, "").slice(0, 300) : value,
        ])
    );
  } else if (body.delivery_address !== undefined && body.delivery_address !== null) {
    return NextResponse.json(
      { error: "delivery_address must be a string or object" },
      { status: 400 }
    );
  }

  const customer =
    body.customer && typeof body.customer === "object" && !Array.isArray(body.customer)
      ? (body.customer as Record<string, unknown>)
      : {};

  const result = await createOrder(createServiceClient(), {
    phone,
    items,
    delivery_method: deliveryMethod as DeliveryMethod,
    delivery_address: deliveryAddress,
    delivery_fee_cents: deliveryFeeCents,
    customer: {
      name: typeof customer.name === "string" ? customer.name.slice(0, 200) : null,
      email: typeof customer.email === "string" ? customer.email.slice(0, 200) : null,
    },
  });

  if (!result.ok) {
    const status =
      result.error === "shopify_not_configured"
        ? 503
        : result.error === "out_of_stock"
          ? 409
          : result.error === "invalid_items" ||
              result.error === "invalid_phone" ||
              result.error === "invalid_delivery_address"
            ? 400
            : 502;
    return NextResponse.json(result, { status });
  }

  const order = result.order;
  return NextResponse.json(
    {
      ok: true,
      order_id: order.id,
      order_number: order.order_number,
      payment_link: order.payment_link,
      status: order.status,
      items: order.items,
      subtotal_cents: order.subtotal_cents,
      delivery_fee_cents: order.delivery_fee_cents,
      total_cents: order.total_cents,
      currency: order.currency,
    },
    { status: 201 }
  );
}
