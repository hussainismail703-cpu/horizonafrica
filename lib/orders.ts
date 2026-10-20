import { SupabaseClient } from "@supabase/supabase-js";
import {
  createDraftOrder,
  deleteDraftOrder,
  getVariantInventory,
  isShopifyConfigured,
  type DraftOrderResult,
} from "@/lib/shopify";
import { normalizePhone } from "@/lib/phone-utils";
import {
  cancelOrderFollowUps,
  scheduleOrderFollowUps,
} from "@/lib/order-follow-ups";
import type { DeliveryMethod, Order, OrderItem } from "@/lib/types";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 50;
const MAX_QTY_PER_ITEM = 99;

export interface CreateOrderItemInput {
  variant_id: number;
  qty: number;
}

export interface CreateOrderInput {
  phone: string;
  items: CreateOrderItemInput[];
  delivery_method: DeliveryMethod;
  delivery_address?: Record<string, unknown> | null;
  delivery_fee_cents?: number;
  customer?: {
    name?: string | null;
    email?: string | null;
  };
}

export type CreateOrderResult =
  | { ok: true; order: Order }
  | {
      ok: false;
      error:
        | "shopify_not_configured"
        | "invalid_phone"
        | "invalid_items"
        | "invalid_delivery_address"
        | "out_of_stock"
        | "order_failed";
      message: string;
      unavailable?: Record<string, unknown>[];
    };

interface VariantRow {
  id: string;
  shopify_variant_id: number;
  title: string | null;
  sku: string | null;
  price_cents: number | null;
  inventory_qty: number | null;
  inventory_item_id: number | null;
  available: boolean;
  shopify_products:
    | { title: string; handle: string | null; is_active: boolean }
    | { title: string; handle: string | null; is_active: boolean }[]
    | null;
}

function productOf(row: VariantRow) {
  const product = Array.isArray(row.shopify_products)
    ? row.shopify_products[0]
    : row.shopify_products;
  return product ?? { title: "Unknown item", handle: null, is_active: false };
}

function orderLinkTtlHours(): number {
  const parsed = Number(process.env.ORDER_LINK_TTL_HOURS ?? "24");
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 168 ? parsed : 24;
}

function mailingAddress(
  address: Record<string, unknown> | null | undefined,
  customerName: string | null,
  phone: string
): Record<string, string> | undefined {
  if (!address) return undefined;
  const stringField = (keys: string[]) => {
    for (const key of keys) {
      const value = address[key];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
    }
    return undefined;
  };
  const nameParts = (customerName ?? "").trim().split(/\s+/).filter(Boolean);
  const mapped: Record<string, string | undefined> = {
    firstName: stringField(["first_name", "firstName"]) ?? nameParts[0],
    lastName:
      stringField(["last_name", "lastName"]) ??
      (nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined),
    address1: stringField(["address1", "line1", "street", "address"]),
    address2: stringField(["address2", "line2", "suburb", "complex"]),
    city: stringField(["city", "town"]),
    province: stringField(["province", "state"]),
    zip: stringField(["zip", "postal_code", "postalCode", "postcode"]),
    country: stringField(["country"]) ?? "South Africa",
    phone: `+${phone}`,
  };
  const result = Object.fromEntries(
    Object.entries(mapped).filter(([, value]) => Boolean(value))
  ) as Record<string, string>;
  return result.address1 ? result : undefined;
}

function normaliseItems(items: CreateOrderItemInput[]): CreateOrderItemInput[] {
  const byVariant = new Map<number, number>();
  for (const item of items) {
    byVariant.set(item.variant_id, (byVariant.get(item.variant_id) ?? 0) + item.qty);
  }
  return [...byVariant.entries()].map(([variant_id, qty]) => ({ variant_id, qty }));
}

export async function createOrder(
  supabase: SupabaseClient,
  input: CreateOrderInput
): Promise<CreateOrderResult> {
  if (!isShopifyConfigured()) {
    return {
      ok: false,
      error: "shopify_not_configured",
      message: "Shopify is not configured",
    };
  }

  const phone = normalizePhone(input.phone);
  // Plausible E.164 digits only — a leftover leading 0 or a wrong length would
  // be rejected by Shopify anyway, so fail fast with a 400 instead.
  if (!phone || phone.startsWith("0") || phone.length < 10 || phone.length > 15) {
    return {
      ok: false,
      error: "invalid_phone",
      message: "Phone must be a valid local or international number",
    };
  }
  const items = normaliseItems(input.items);
  if (items.length === 0 || items.length > MAX_ITEMS) {
    return { ok: false, error: "invalid_items", message: "1–50 items are required" };
  }
  if (items.some((item) => !Number.isInteger(item.variant_id) || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY_PER_ITEM)) {
    return {
      ok: false,
      error: "invalid_items",
      message: `Each item needs a numeric variant_id and quantity 1–${MAX_QTY_PER_ITEM}`,
    };
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("id, full_name, email, shopify_customer_id")
    .eq("phone_number", phone)
    .maybeSingle();

  const { data: variantRows, error: variantError } = await supabase
    .from("shopify_variants")
    .select(
      "id, shopify_variant_id, title, sku, price_cents, inventory_qty, inventory_item_id, available, shopify_products!inner(title, handle, is_active)"
    )
    .in(
      "shopify_variant_id",
      items.map((item) => item.variant_id)
    );

  if (variantError) {
    return { ok: false, error: "order_failed", message: variantError.message };
  }

  const variants = new Map(
    ((variantRows ?? []) as VariantRow[]).map((row) => [row.shopify_variant_id, row])
  );
  const missing = items.filter((item) => {
    const row = variants.get(item.variant_id);
    return !row || !productOf(row).is_active;
  });
  if (missing.length) {
    return {
      ok: false,
      error: "invalid_items",
      message: `Unknown or inactive variant(s): ${missing.map((i) => i.variant_id).join(", ")}`,
    };
  }

  const inventoryItemIds = [...new Set(
    items
      .map((item) => variants.get(item.variant_id)?.inventory_item_id)
      .filter((id): id is number => typeof id === "number")
  )];

  let liveInventory = new Map<number, number>();
  try {
    const levels = await getVariantInventory(inventoryItemIds);
    for (const level of levels) {
      if (typeof level.available === "number") {
        liveInventory.set(
          level.inventory_item_id,
          (liveInventory.get(level.inventory_item_id) ?? 0) + level.available
        );
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: "order_failed",
      message: `Could not revalidate live Shopify stock: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  const unavailable: Record<string, unknown>[] = [];
  const orderItems: OrderItem[] = [];
  for (const item of items) {
    const variant = variants.get(item.variant_id)!;
    const product = productOf(variant);
    const liveQty =
      variant.inventory_item_id !== null && liveInventory.has(variant.inventory_item_id)
        ? liveInventory.get(variant.inventory_item_id)!
        : variant.inventory_qty;

    if (typeof liveQty === "number" && item.qty > liveQty) {
      unavailable.push({
        variant_id: item.variant_id,
        product_title: product.title,
        variant_title: variant.title,
        requested: item.qty,
        available: Math.max(liveQty, 0),
      });
      continue;
    }
    if (liveQty === null && !variant.available) {
      unavailable.push({
        variant_id: item.variant_id,
        product_title: product.title,
        variant_title: variant.title,
        requested: item.qty,
        available: 0,
      });
      continue;
    }

    orderItems.push({
      variant_id: item.variant_id,
      product_title: product.title,
      variant_title: variant.title,
      sku: variant.sku,
      qty: item.qty,
      price_cents: variant.price_cents,
    });
  }

  if (unavailable.length) {
    return {
      ok: false,
      error: "out_of_stock",
      message: "One or more items no longer have enough stock",
      unavailable,
    };
  }

  const customerName =
    input.customer?.name?.trim() || lead?.full_name || null;
  const customerEmail =
    input.customer?.email?.trim() || lead?.email || null;
  const deliveryFee =
    input.delivery_method === "delivery"
      ? Math.max(0, Math.trunc(input.delivery_fee_cents ?? 0))
      : 0;
  const shippingAddress =
    input.delivery_method === "delivery"
      ? mailingAddress(input.delivery_address, customerName, phone)
      : undefined;
  if (input.delivery_method === "delivery" && !shippingAddress) {
    return {
      ok: false,
      error: "invalid_delivery_address",
      message: "A delivery address with a street address is required",
    };
  }
  const subtotalCents = orderItems.reduce(
    (sum, item) => sum + (item.price_cents ?? 0) * item.qty,
    0
  );
  const orderId = crypto.randomUUID();

  let draft: DraftOrderResult;
  try {
    draft = await createDraftOrder(
      items.map((item) => ({
        variant_id: item.variant_id,
        quantity: item.qty,
        requires_shipping: input.delivery_method === "delivery",
      })),
      {
        phone: `+${phone}`,
        ...(customerEmail ? { email: customerEmail } : {}),
      },
      `Layla WhatsApp order ${orderId}`,
      {
        customAttributes: [{ key: "layla_order_id", value: orderId }],
        tags: ["layla", "whatsapp", "stock_on_hand"],
        ...(input.delivery_method === "delivery"
          ? {
              shippingAddress,
              ...(deliveryFee > 0
                ? { shippingLine: { title: "Delivery", price: deliveryFee / 100 } }
                : {}),
            }
          : {}),
      }
    );
  } catch (err) {
    return {
      ok: false,
      error: "order_failed",
      message: `Could not create Shopify draft order: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  const orderRow = {
    id: orderId,
    phone_number: phone,
    lead_id: lead?.id ?? null,
    customer_name: customerName,
    customer_email: customerEmail,
    shopify_draft_order_id: draft.id,
    order_track: "stock_on_hand" as const,
    items: orderItems,
    subtotal_cents: subtotalCents,
    delivery_fee_cents: deliveryFee,
    total_cents: Math.round(Number(draft.total_price) * 100),
    currency: "ZAR",
    delivery_method: input.delivery_method,
    delivery_address: input.delivery_address ?? null,
    payment_link: draft.invoice_url,
    status: "pending_payment" as const,
  };

  const { data: order, error: insertError } = await supabase
    .from("orders")
    .insert(orderRow)
    .select("*")
    .single();

  if (insertError || !order) {
    try {
      await deleteDraftOrder(draft.id);
    } catch (cleanupError) {
      console.error("[orders] draft-order cleanup failed:", cleanupError);
    }
    return {
      ok: false,
      error: "order_failed",
      message: insertError?.message ?? "Failed to persist order",
    };
  }

  await supabase.from("order_events").insert([
    {
      order_id: order.id,
      event: "stock_revalidated",
      detail: { inventory_item_ids: inventoryItemIds, items: orderItems },
    },
    {
      order_id: order.id,
      event: "created",
      detail: {
        shopify_draft_order_id: draft.id,
        shopify_draft_order_name: draft.name,
        inventory_reserved: false,
      },
    },
  ]);

  if (lead?.id) {
    await supabase
      .from("leads")
      .update({ order_track: "stock_on_hand" })
      .eq("id", lead.id);
  }

  // Queue the unpaid-order nudge sequence (M6): first nudge at
  // created_at + FOLLOWUP_HOURS[0], subsequent steps handled by the cron.
  await scheduleOrderFollowUps(supabase, order as Order);

  return { ok: true, order: order as Order };
}

export interface MarkPaidInput {
  internalOrderId?: string | null;
  draftOrderId?: number | null;
  shopifyOrderId?: number | null;
  shopifyOrderNumber?: string | null;
  paidAt?: string | null;
  payload?: Record<string, unknown>;
}

export type MarkPaidResult =
  | { matched: false }
  | { matched: true; alreadyPaid: boolean; order: Order };

function numericId(value: unknown): number | null {
  const text = String(value ?? "");
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : null;
}

/** Extract every identifier Shopify might send back on an orders/paid payload. */
export function paidOrderIdentifiers(payload: Record<string, unknown>): MarkPaidInput {
  const noteAttributes = [
    ...(Array.isArray(payload.note_attributes) ? payload.note_attributes : []),
    ...(Array.isArray(payload.custom_attributes) ? payload.custom_attributes : []),
  ] as Record<string, unknown>[];
  const attr = noteAttributes.find(
    (entry) =>
      entry.key === "layla_order_id" ||
      entry.name === "layla_order_id"
  );
  const noteMatch = String(payload.note ?? "").match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );

  return {
    internalOrderId:
      (typeof attr?.value === "string" && UUID_REGEX.test(attr.value) ? attr.value : null) ??
      noteMatch?.[0] ??
      null,
    draftOrderId:
      numericId(payload.draft_order_id) ??
      numericId((payload.draft_order as Record<string, unknown> | undefined)?.id) ??
      numericId(payload.source_identifier),
    shopifyOrderId: numericId(payload.id),
    shopifyOrderNumber:
      typeof payload.name === "string"
        ? payload.name
        : payload.order_number != null
          ? String(payload.order_number)
          : null,
    paidAt:
      typeof payload.processed_at === "string"
        ? payload.processed_at
        : typeof payload.created_at === "string"
          ? payload.created_at
          : null,
    payload,
  };
}

export async function markOrderPaid(
  supabase: SupabaseClient,
  input: MarkPaidInput
): Promise<MarkPaidResult> {
  let order: Order | null = null;

  if (input.internalOrderId && UUID_REGEX.test(input.internalOrderId)) {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .eq("id", input.internalOrderId)
      .maybeSingle();
    order = (data as Order | null) ?? null;
  }
  if (!order && input.draftOrderId) {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .eq("shopify_draft_order_id", input.draftOrderId)
      .maybeSingle();
    order = (data as Order | null) ?? null;
  }
  if (!order && input.shopifyOrderId) {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .eq("shopify_order_id", input.shopifyOrderId)
      .maybeSingle();
    order = (data as Order | null) ?? null;
  }

  if (!order) return { matched: false };
  if (order.status === "paid") {
    return { matched: true, alreadyPaid: true, order };
  }

  const paidAt = input.paidAt ?? new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("orders")
    .update({
      status: "paid",
      paid_at: paidAt,
      shopify_order_id: input.shopifyOrderId ?? order.shopify_order_id,
      shopify_order_number:
        input.shopifyOrderNumber ?? order.shopify_order_number,
    })
    .eq("id", order.id)
    .neq("status", "paid")
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);

  const paidOrder = (updated as Order | null) ?? order;
  if (!updated) {
    return { matched: true, alreadyPaid: true, order: paidOrder };
  }

  await supabase.from("order_events").insert({
    order_id: order.id,
    event: "paid",
    detail: {
      shopify_order_id: input.shopifyOrderId ?? null,
      shopify_order_number: input.shopifyOrderNumber ?? null,
      payload: input.payload ?? null,
    },
  });

  await cancelOrderFollowUps(supabase, order.id);

  return { matched: true, alreadyPaid: false, order: paidOrder };
}

export interface CreateImportedOrderInput {
  phone: string;
  item_description: string;
  notes?: string | null;
  customer?: {
    name?: string | null;
    email?: string | null;
  };
}

export type CreateImportedOrderResult =
  | { ok: true; order: Order }
  | { ok: false; error: "invalid_phone" | "invalid_item" | "order_failed"; message: string };

/**
 * Imported/online order track (scope freeze §4.4): the customer wants an item
 * that is ordered in rather than held in stock. Layla explains the 6-week
 * lead time + 50% deposit terms, confirms intent, and n8n hands the enquiry
 * to orders@easternwearbykersh.com. No Shopify draft order or payment link
 * is created — the order lands directly in 'handed_to_orders' for the team.
 */
export async function createImportedOrder(
  supabase: SupabaseClient,
  input: CreateImportedOrderInput
): Promise<CreateImportedOrderResult> {
  const phone = normalizePhone(input.phone);
  if (!phone || phone.startsWith("0") || phone.length < 10 || phone.length > 15) {
    return {
      ok: false,
      error: "invalid_phone",
      message: "Phone must be a valid local or international number",
    };
  }

  const description = (input.item_description ?? "").replace(/\x00/g, "").trim();
  if (!description || description.length > 2000) {
    return {
      ok: false,
      error: "invalid_item",
      message: "item_description is required (max 2000 chars)",
    };
  }

  const notes =
    typeof input.notes === "string" && input.notes.trim()
      ? input.notes.replace(/\x00/g, "").trim().slice(0, 4000)
      : null;

  const { data: lead } = await supabase
    .from("leads")
    .select("id, full_name, email")
    .eq("phone_number", phone)
    .maybeSingle();

  const customerName =
    input.customer?.name?.trim() || lead?.full_name || null;
  const customerEmail =
    input.customer?.email?.trim() || lead?.email || null;

  const { data: order, error: insertError } = await supabase
    .from("orders")
    .insert({
      phone_number: phone,
      lead_id: lead?.id ?? null,
      customer_name: customerName,
      customer_email: customerEmail,
      order_track: "imported",
      items: [
        {
          variant_id: null,
          product_title: description,
          variant_title: null,
          sku: null,
          qty: 1,
          price_cents: null,
        },
      ],
      delivery_fee_cents: 0,
      currency: "ZAR",
      status: "handed_to_orders",
    })
    .select("*")
    .single();

  if (insertError || !order) {
    return {
      ok: false,
      error: "order_failed",
      message: insertError?.message ?? "Failed to persist order",
    };
  }

  await supabase.from("order_events").insert({
    order_id: order.id,
    event: "handed_to_orders",
    detail: {
      item_description: description,
      notes,
      handover_target: "orders@easternwearbykersh.com",
      terms: "6-week lead time + 50% deposit",
    },
  });

  if (lead?.id) {
    await supabase
      .from("leads")
      .update({ order_track: "imported" })
      .eq("id", lead.id);
  }

  return { ok: true, order: order as Order };
}

/** Expire unpaid links past ORDER_LINK_TTL_HOURS (default 24). */
export async function expireStaleOrders(
  supabase: SupabaseClient
): Promise<{ expired: number }> {
  const cutoff = new Date(
    Date.now() - orderLinkTtlHours() * 60 * 60 * 1000
  ).toISOString();
  const { data: stale, error } = await supabase
    .from("orders")
    .select("id")
    .eq("status", "pending_payment")
    .lt("created_at", cutoff)
    .limit(500);

  if (error) throw new Error(error.message);
  let expired = 0;
  for (const row of stale ?? []) {
    const { data } = await supabase
      .from("orders")
      .update({ status: "expired" })
      .eq("id", row.id)
      .eq("status", "pending_payment")
      .select("id")
      .maybeSingle();
    if (!data) continue;
    expired++;
    await supabase.from("order_events").insert({
      order_id: row.id,
      event: "expired",
      detail: { cutoff },
    });
    await cancelOrderFollowUps(supabase, row.id);
  }
  return { expired };
}
