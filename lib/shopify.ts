import crypto from "crypto";

/**
 * Server-side Shopify Admin API client (plain fetch — no SDK).
 *
 * Env:
 *   SHOPIFY_STORE_DOMAIN        e.g. "easternwearbykersh.myshopify.com"
 *   SHOPIFY_ADMIN_ACCESS_TOKEN  Admin API access token (shpat_…)
 *   SHOPIFY_API_VERSION         e.g. "2025-01"
 *   SHOPIFY_WEBHOOK_SECRET      webhook signing secret from Shopify admin
 *
 * `isShopifyConfigured()` lets callers degrade gracefully (503) while
 * credentials are pending, rather than crashing on undefined env vars.
 */

export interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  sku: string | null;
  price: string;
  inventory_quantity: number;
  inventory_item_id: number;
  available?: boolean;
}

export interface ShopifyProduct {
  id: number;
  handle: string;
  title: string;
  product_type: string;
  body_html: string | null;
  status: string;
  image?: { src: string } | null;
  images?: { src: string }[];
  variants: ShopifyVariant[];
}

export interface ShopifyCustomer {
  id: number;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  orders_count: number;
  total_spent: string;
  tags: string;
}

export function isShopifyConfigured(): boolean {
  return Boolean(
    process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
  );
}

function baseUrl(): string {
  const domain = process.env.SHOPIFY_STORE_DOMAIN!;
  const version = process.env.SHOPIFY_API_VERSION ?? "2025-01";
  return `https://${domain}/admin/api/${version}`;
}

async function shopifyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Follow Shopify's Link-header pagination (page_info cursors) until exhausted.
 * `resourceKey` is the top-level array key in the response body.
 */
async function listAll<T>(path: string, resourceKey: string): Promise<T[]> {
  const out: T[] = [];
  let nextPath: string | null = `${path}${path.includes("?") ? "&" : "?"}limit=250`;

  while (nextPath) {
    const url: string = nextPath.startsWith("http") ? nextPath : `${baseUrl()}${nextPath}`;
    const res: Response = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify API ${url} → HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as Record<string, T[]>;
    out.push(...(data[resourceKey] ?? []));

    const link: string | null = res.headers.get("link");
    const next: RegExpMatchArray | null | undefined = link?.match(/<([^>]+)>;\s*rel="next"/);
    nextPath = next ? next[1] : null;
  }
  return out;
}

export function listProducts(): Promise<ShopifyProduct[]> {
  return listAll<ShopifyProduct>("/products.json?status=active", "products");
}

export function listCustomers(): Promise<ShopifyCustomer[]> {
  return listAll<ShopifyCustomer>("/customers.json", "customers");
}

export interface InventoryLevel {
  inventory_item_id: number;
  location_id: number;
  available: number | null;
}

/** Live inventory levels for a set of inventory item ids (max 50 per call). */
export async function getVariantInventory(
  inventoryItemIds: number[]
): Promise<InventoryLevel[]> {
  if (inventoryItemIds.length === 0) return [];
  const levels: InventoryLevel[] = [];
  // Shopify caps inventory_levels lookups at 50 item ids per request.
  for (let i = 0; i < inventoryItemIds.length; i += 50) {
    const chunk = inventoryItemIds.slice(i, i + 50).join(",");
    const data = await shopifyFetch<{ inventory_levels: InventoryLevel[] }>(
      `/inventory_levels.json?inventory_item_ids=${chunk}`
    );
    levels.push(...data.inventory_levels);
  }
  return levels;
}

export interface DraftOrderLineItem {
  variant_id?: number;
  title?: string;
  quantity: number;
  price?: string;
}

export interface DraftOrderResult {
  id: number;
  invoice_url: string;
  name: string;
  total_price: string;
}

/** Create a Shopify draft order and return it plus its invoice (payment) URL. */
export async function createDraftOrder(
  lineItems: DraftOrderLineItem[],
  customer: { id?: number; phone?: string; email?: string },
  note?: string
): Promise<DraftOrderResult> {
  const data = await shopifyFetch<{ draft_order: DraftOrderResult }>(
    "/draft_orders.json",
    {
      method: "POST",
      body: JSON.stringify({
        draft_order: {
          line_items: lineItems,
          customer,
          note,
          use_customer_default_address: true,
        },
      }),
    }
  );
  return data.draft_order;
}

/**
 * Verify Shopify's X-Shopify-Hmac-Sha256 header — base64 HMAC-SHA256 of the
 * raw request body signed with SHOPIFY_WEBHOOK_SECRET.
 * Returns null when the secret isn't configured (verification impossible),
 * matching the soft-mode convention used for Meta webhooks.
 */
export function verifyShopifyWebhook(
  rawBody: string,
  hmacHeader: string | null
): boolean | null {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return null;
  if (!hmacHeader) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(hmacHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
