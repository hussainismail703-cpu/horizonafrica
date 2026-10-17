import { SupabaseClient } from "@supabase/supabase-js";
import {
  getVariantInventory,
  listCustomers,
  listProducts,
  ShopifyCustomer,
  ShopifyProduct,
} from "@/lib/shopify";
import { normalizePhone } from "@/lib/phone-utils";

/**
 * Shared Shopify → Supabase sync logic. Used by the /api/shopify/sync-* cron
 * routes and by /api/shopify/webhooks for incremental updates.
 */

function stripHtml(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function productToRow(product: ShopifyProduct) {
  return {
    shopify_product_id: product.id,
    handle: product.handle,
    title: product.title,
    category: product.product_type || null,
    image_url: product.image?.src ?? product.images?.[0]?.src ?? null,
    description: stripHtml(product.body_html),
    is_active: product.status === "active",
    last_synced_at: new Date().toISOString(),
  };
}

function variantToRow(variant: ShopifyProduct["variants"][number], productId: string) {
  return {
    product_id: productId,
    shopify_variant_id: variant.id,
    title: variant.title,
    sku: variant.sku || null,
    price_cents: variant.price ? Math.round(parseFloat(variant.price) * 100) : null,
    inventory_qty: variant.inventory_quantity ?? null,
    inventory_item_id: variant.inventory_item_id ?? null,
    available: (variant.inventory_quantity ?? 0) > 0,
  };
}

/**
 * Upsert a single Shopify product + its variants. Returns the internal
 * shopify_products row id, or null on failure.
 */
export async function upsertShopifyProduct(
  supabase: SupabaseClient,
  product: ShopifyProduct
): Promise<string | null> {
  const { data: productRow, error } = await supabase
    .from("shopify_products")
    .upsert(productToRow(product), { onConflict: "shopify_product_id" })
    .select("id")
    .single();

  if (error || !productRow) {
    console.error(`[shopify-sync] product ${product.id} upsert failed:`, error?.message);
    return null;
  }

  if (product.variants?.length) {
    const variantRows = product.variants.map((v) => variantToRow(v, productRow.id));
    const { error: vErr } = await supabase
      .from("shopify_variants")
      .upsert(variantRows, { onConflict: "shopify_variant_id" });
    if (vErr) {
      console.error(`[shopify-sync] variants for ${product.id} failed:`, vErr.message);
    }
  }

  return productRow.id;
}

/** Mark a Shopify product (and its variants) inactive — used by products/delete. */
export async function deactivateShopifyProduct(
  supabase: SupabaseClient,
  shopifyProductId: number
): Promise<void> {
  const { data } = await supabase
    .from("shopify_products")
    .update({ is_active: false, last_synced_at: new Date().toISOString() })
    .eq("shopify_product_id", shopifyProductId)
    .select("id")
    .maybeSingle();

  if (data?.id) {
    await supabase
      .from("shopify_variants")
      .update({ available: false })
      .eq("product_id", data.id);
  }
}

export interface SyncResult {
  products_seen: number;
  products_upserted: number;
  variants_upserted: number;
  products_deactivated: number;
}

/** Full catalog sync: pull every active product, upsert, deactivate strays. */
export async function syncAllProducts(supabase: SupabaseClient): Promise<SyncResult> {
  const products = await listProducts();
  const seenIds = new Set<number>();
  let productsUpserted = 0;
  let variantsUpserted = 0;

  for (const product of products) {
    seenIds.add(product.id);
    const id = await upsertShopifyProduct(supabase, product);
    if (id) {
      productsUpserted++;
      variantsUpserted += product.variants?.length ?? 0;
    }
  }

  // Refresh live inventory for every synced variant in one batched call.
  const inventoryItemIds = products.flatMap((p) =>
    (p.variants ?? []).map((v) => v.inventory_item_id).filter(Boolean)
  );
  if (inventoryItemIds.length) {
    try {
      const levels = await getVariantInventory(inventoryItemIds);
      const byItem = new Map(levels.map((l) => [l.inventory_item_id, l.available]));
      for (const product of products) {
        for (const variant of product.variants ?? []) {
          const available = byItem.get(variant.inventory_item_id);
          if (available === undefined) continue;
          await supabase
            .from("shopify_variants")
            .update({ inventory_qty: available, available: (available ?? 0) > 0 })
            .eq("shopify_variant_id", variant.id);
        }
      }
    } catch (err) {
      console.error("[shopify-sync] inventory refresh failed:", err);
    }
  }

  // Deactivate products no longer present in Shopify's active catalog.
  const { data: existing } = await supabase
    .from("shopify_products")
    .select("id, shopify_product_id")
    .eq("is_active", true);
  let deactivated = 0;
  for (const row of existing ?? []) {
    if (!seenIds.has(row.shopify_product_id)) {
      await deactivateShopifyProduct(supabase, row.shopify_product_id);
      deactivated++;
    }
  }

  return {
    products_seen: products.length,
    products_upserted: productsUpserted,
    variants_upserted: variantsUpserted,
    products_deactivated: deactivated,
  };
}

export function customerToRow(customer: ShopifyCustomer) {
  // WhatsApp broadcasts ride on phone numbers, so SMS marketing consent is the
  // governing signal; fall back to the legacy accepts_marketing flag, else NULL
  // (unknown — treated as consented-by-default in broadcast sync).
  const smsState = customer.sms_marketing_consent?.state;
  const acceptsMarketing =
    smsState === "subscribed"
      ? true
      : smsState
        ? false
        : (customer.accepts_marketing ?? null);
  return {
    shopify_customer_id: customer.id,
    phone: customer.phone ? normalizePhone(customer.phone) : null,
    email: customer.email,
    full_name: [customer.first_name, customer.last_name].filter(Boolean).join(" ") || null,
    orders_count: customer.orders_count ?? 0,
    total_spent_cents: Math.round(parseFloat(customer.total_spent ?? "0") * 100),
    tags: customer.tags ? customer.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    accepts_marketing: acceptsMarketing,
    last_synced_at: new Date().toISOString(),
  };
}

/** Upsert one Shopify customer and link it to the matching lead by phone. */
export async function upsertShopifyCustomer(
  supabase: SupabaseClient,
  customer: ShopifyCustomer
): Promise<void> {
  const row = customerToRow(customer);
  const { error } = await supabase
    .from("shopify_customers")
    .upsert(row, { onConflict: "shopify_customer_id" });
  if (error) {
    console.error(`[shopify-sync] customer ${customer.id} upsert failed:`, error.message);
    return;
  }
  if (row.phone) {
    await supabase
      .from("leads")
      .update({ shopify_customer_id: customer.id })
      .eq("phone_number", row.phone);
  }
}

export interface CustomerSyncResult {
  customers_seen: number;
  customers_upserted: number;
  leads_linked: number;
}

/** Full customer sync: pull every customer, upsert, link to leads by phone. */
export async function syncAllCustomers(
  supabase: SupabaseClient
): Promise<CustomerSyncResult> {
  const customers = await listCustomers();
  let upserted = 0;
  let linked = 0;

  for (const customer of customers) {
    const row = customerToRow(customer);
    const { error } = await supabase
      .from("shopify_customers")
      .upsert(row, { onConflict: "shopify_customer_id" });
    if (error) {
      console.error(`[shopify-sync] customer ${customer.id} failed:`, error.message);
      continue;
    }
    upserted++;

    if (row.phone) {
      const { data: lead } = await supabase
        .from("leads")
        .update({ shopify_customer_id: customer.id })
        .eq("phone_number", row.phone)
        .select("id")
        .maybeSingle();
      if (lead) linked++;
    }
  }

  return {
    customers_seen: customers.length,
    customers_upserted: upserted,
    leads_linked: linked,
  };
}
