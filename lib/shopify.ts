import crypto from "crypto";

/**
 * Server-side Shopify Admin API client (plain fetch — no SDK).
 *
 * Env:
 *   SHOPIFY_STORE_DOMAIN        e.g. "rvadvz-kk.myshopify.com"
 *   SHOPIFY_API_VERSION         e.g. "2026-10"
 *   SHOPIFY_ADMIN_ACCESS_TOKEN  static Admin API token (shpat_…), if used
 *   SHOPIFY_CLIENT_ID           Dev Dashboard app client id (token grant)
 *   SHOPIFY_CLIENT_SECRET       Dev Dashboard app client secret (shpss_…)
 *   SHOPIFY_WEBHOOK_SECRET      webhook signing key — whichever key actually
 *                               signs the registered webhooks (Notifications →
 *                               Webhooks page key, or the client secret for
 *                               app-registered webhooks)
 *
 * Auth: this is a Dev Dashboard app — there is no permanent token. Tokens are
 * obtained via the client_credentials grant and cached in memory; they expire
 * after ~24h so they are refreshed on expiry and retried once on HTTP 401.
 * A static SHOPIFY_ADMIN_ACCESS_TOKEN, if set, takes precedence.
 *
 * `isShopifyConfigured()` lets callers degrade gracefully (503) while
 * credentials are pending, rather than crashing on undefined env vars.
 */

let cachedToken: { token: string; expiresAt: number } | null = null;
let tokenPromise: Promise<string> | null = null;

async function requestToken(): Promise<string> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN!;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Shopify credentials missing: set SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET"
    );
  }
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Shopify token request → HTTP ${res.status}: ${text.slice(0, 300)}`
    );
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  // Refresh 5 minutes before the stated expiry (~24h).
  const ttlMs = Math.max((data.expires_in ?? 86399) - 300, 60) * 1000;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + ttlMs };
  return data.access_token;
}

/** Resolve an Admin API token: static env wins, else cached/refresh grant. */
export function getAccessToken(): Promise<string> {
  const staticToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (staticToken) return Promise.resolve(staticToken);

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return Promise.resolve(cachedToken.token);
  }
  if (!tokenPromise) {
    tokenPromise = requestToken().finally(() => {
      tokenPromise = null;
    });
  }
  return tokenPromise;
}

function invalidateToken(): void {
  cachedToken = null;
}

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
  accepts_marketing?: boolean | null;
  sms_marketing_consent?: { state: string } | null;
}

export function isShopifyConfigured(): boolean {
  return Boolean(
    process.env.SHOPIFY_STORE_DOMAIN &&
      (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
        (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET))
  );
}

function baseUrl(): string {
  const domain = process.env.SHOPIFY_STORE_DOMAIN!;
  const version = process.env.SHOPIFY_API_VERSION ?? "2025-01";
  return `https://${domain}/admin/api/${version}`;
}

async function shopifyFetch<T>(
  path: string,
  init?: RequestInit,
  retried = false
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
      ...init?.headers,
    },
  });
  if (res.status === 401 && !retried && !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    invalidateToken();
    return shopifyFetch<T>(path, init, true);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

interface ShopifyGraphqlResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function shopifyGraphql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const body = await shopifyFetch<ShopifyGraphqlResponse<T>>("/graphql.json", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  if (body.errors?.length) {
    throw new Error(`Shopify GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) throw new Error("Shopify GraphQL returned no data");
  return body.data;
}

/**
 * Follow Shopify's Link-header pagination (page_info cursors) until exhausted.
 * `resourceKey` is the top-level array key in the response body.
 */
async function listAll<T>(path: string, resourceKey: string): Promise<T[]> {
  const out: T[] = [];
  let nextPath: string | null = `${path}${path.includes("?") ? "&" : "?"}limit=250`;

  let retried = false;
  while (nextPath) {
    const url: string = nextPath.startsWith("http") ? nextPath : `${baseUrl()}${nextPath}`;
    const token = await getAccessToken();
    const res: Response = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": token,
      },
    });
    if (res.status === 401 && !retried && !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      invalidateToken();
      retried = true;
      continue;
    }
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
  requires_shipping?: boolean;
}

export interface DraftOrderResult {
  id: number;
  invoice_url: string;
  name: string;
  total_price: string;
}

export interface DraftOrderOptions {
  shippingAddress?: Record<string, string | null | undefined>;
  shippingLine?: { title: string; price: number };
  reserveInventoryUntil?: string;
  customAttributes?: { key: string; value: string }[];
  tags?: string[];
}

interface DraftOrderMutationResult {
  draftOrderCreate: {
    draftOrder: {
      id: string;
      legacyResourceId: string;
      invoiceUrl: string | null;
      name: string;
      totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
    } | null;
    userErrors: { field?: string[]; message: string }[];
  };
}

interface DraftOrderQueryResult {
  draftOrder: { invoiceUrl: string | null } | null;
}

/**
 * Create a Shopify draft order and return its invoice (payment) URL.
 *
 * This uses GraphQL rather than the REST DraftOrder resource because only the
 * GraphQL input supports `reserveInventoryUntil`. Holding the stock while the
 * customer has a payment link prevents two Layla conversations from buying the
 * same last unit.
 */
export async function createDraftOrder(
  lineItems: DraftOrderLineItem[],
  customer: { id?: number; phone?: string; email?: string },
  note?: string,
  options: DraftOrderOptions = {}
): Promise<DraftOrderResult> {
  const input: Record<string, unknown> = {
    lineItems: lineItems.map((item) =>
      item.variant_id
        ? {
            variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
            quantity: item.quantity,
            requiresShipping: item.requires_shipping ?? true,
            ...(item.price ? { originalUnitPrice: item.price } : {}),
          }
        : {
            title: item.title ?? "Custom item",
            quantity: item.quantity,
            requiresShipping: item.requires_shipping ?? true,
            ...(item.price ? { originalUnitPrice: item.price } : {}),
          }
    ),
    note,
    tags: options.tags ?? ["layla", "whatsapp"],
    customAttributes: options.customAttributes ?? [],
    ...(customer.email ? { email: customer.email } : {}),
    ...(customer.phone ? { phone: customer.phone } : {}),
    ...(options.shippingAddress ? { shippingAddress: options.shippingAddress } : {}),
    ...(options.shippingLine ? { shippingLine: options.shippingLine } : {}),
    ...(options.reserveInventoryUntil
      ? { reserveInventoryUntil: options.reserveInventoryUntil }
      : {}),
  };

  const created = await shopifyGraphql<DraftOrderMutationResult>(
    `mutation draftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder {
          id
          legacyResourceId
          invoiceUrl
          name
          totalPriceSet { shopMoney { amount currencyCode } }
        }
        userErrors { field message }
      }
    }`,
    { input }
  );

  const mutation = created.draftOrderCreate;
  if (mutation.userErrors.length) {
    throw new Error(
      `Shopify draft order failed: ${mutation.userErrors.map((e) => e.message).join("; ")}`
    );
  }
  if (!mutation.draftOrder) {
    throw new Error("Shopify draft order failed: no draft order returned");
  }

  const draftOrder = mutation.draftOrder;
  const legacyDraftId = Number(draftOrder.legacyResourceId);
  let invoiceUrl = draftOrder.invoiceUrl;

  if (!invoiceUrl) {
    // invoiceUrl is occasionally absent immediately after creation. Do NOT use
    // draftOrderInvoiceSend here: Layla sends the link over WhatsApp, and that
    // mutation would also email the customer.
    await new Promise((resolve) => setTimeout(resolve, 750));
    try {
      const queried = await shopifyGraphql<DraftOrderQueryResult>(
        `query draftOrderInvoice($id: ID!) {
          draftOrder(id: $id) { invoiceUrl }
        }`,
        { id: draftOrder.id }
      );
      invoiceUrl = queried.draftOrder?.invoiceUrl ?? null;
    } catch (err) {
      try {
        await deleteDraftOrder(legacyDraftId);
      } catch (cleanupError) {
        console.error("[shopify] draft-order cleanup failed:", cleanupError);
      }
      throw err;
    }
  }

  if (!invoiceUrl) {
    try {
      await deleteDraftOrder(legacyDraftId);
    } catch (cleanupError) {
      console.error("[shopify] draft-order cleanup failed:", cleanupError);
    }
    throw new Error("Shopify draft order was created but did not return a payment link");
  }

  return {
    id: legacyDraftId,
    invoice_url: invoiceUrl,
    name: draftOrder.name,
    total_price: draftOrder.totalPriceSet.shopMoney.amount,
  };
}

/** Delete a draft order (used only when local persistence fails after creation). */
export async function deleteDraftOrder(draftOrderId: number): Promise<void> {
  await shopifyFetch(`/draft_orders/${draftOrderId}.json`, { method: "DELETE" });
}

/**
 * Verify Shopify's X-Shopify-Hmac-Sha256 header — base64 HMAC-SHA256 of the
 * raw request body. Webhooks registered under Settings → Notifications are
 * signed with the key shown on that page; app-registered webhooks are signed
 * with the app's client secret. Both are tried so either registration path
 * verifies correctly.
 * Returns null when no signing secret is configured (verification
 * impossible), matching the soft-mode convention used for Meta webhooks.
 */
export function verifyShopifyWebhook(
  rawBody: string,
  hmacHeader: string | null
): boolean | null {
  const secrets = [
    process.env.SHOPIFY_WEBHOOK_SECRET,
    process.env.SHOPIFY_CLIENT_SECRET,
  ].filter((s, i, arr): s is string => Boolean(s) && arr.indexOf(s) === i);
  if (secrets.length === 0) return null;
  if (!hmacHeader) return false;
  const b = Buffer.from(hmacHeader);
  return secrets.some((secret) => {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");
    const a = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}
