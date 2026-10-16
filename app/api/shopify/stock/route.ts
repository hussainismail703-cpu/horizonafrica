import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getVariantInventory, isShopifyConfigured } from "@/lib/shopify";

// GET /api/shopify/stock?variant_id=<id> | ?query=<garment text>
// Live stock lookup used by the n8n workflow (Bearer APP_SECRET) so Layla can
// answer "do you have this in size 34?" and never sell an out-of-stock item.
// Also callable by authenticated dashboard users.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const appSecret = process.env.APP_SECRET;
  const isAppSecretAuth = appSecret && authHeader === `Bearer ${appSecret}`;

  let supabase;
  if (isAppSecretAuth) {
    supabase = createServiceClient();
  } else {
    supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { searchParams } = new URL(req.url);
  const variantIdParam = searchParams.get("variant_id");
  const query = searchParams.get("query")?.trim();

  if (!variantIdParam && !query) {
    return NextResponse.json(
      { error: "variant_id or query parameter required" },
      { status: 400 }
    );
  }

  if (variantIdParam && !/^\d+$/.test(variantIdParam)) {
    return NextResponse.json({ error: "variant_id must be numeric" }, { status: 400 });
  }

  // Resolve matching variants from the synced catalog first.
  let variantQuery = supabase
    .from("shopify_variants")
    .select("id, shopify_variant_id, title, sku, price_cents, inventory_qty, inventory_item_id, available, shopify_products!inner(title, handle, is_active)")
    .eq("shopify_products.is_active", true);

  if (variantIdParam) {
    variantQuery = variantQuery.eq("shopify_variant_id", Number(variantIdParam));
  } else {
    const safe = query!.replace(/[%_,()]/g, "").slice(0, 100);
    if (!safe) {
      return NextResponse.json({ error: "query is empty" }, { status: 400 });
    }
    // PostgREST can't OR across an embedded resource, so resolve matching
    // product ids first and OR them against variant title/sku.
    const { data: productMatches } = await supabase
      .from("shopify_products")
      .select("id")
      .eq("is_active", true)
      .ilike("title", `%${safe}%`);
    const productIds = (productMatches ?? []).map((p) => p.id);
    const orClauses = [`title.ilike.%${safe}%`, `sku.ilike.%${safe}%`];
    if (productIds.length) orClauses.push(`product_id.in.(${productIds.join(",")})`);
    variantQuery = variantQuery.or(orClauses.join(","));
  }

  const { data: variants, error } = await variantQuery.limit(20);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Overlay live inventory levels when Shopify is configured — the synced
  // copies can be up to 15 minutes stale between product syncs.
  const itemIds = (variants ?? [])
    .map((v) => v.inventory_item_id)
    .filter((id): id is number => typeof id === "number");

  let live: Map<number, number | null> | null = null;
  if (isShopifyConfigured() && itemIds.length) {
    try {
      const levels = await getVariantInventory(itemIds);
      live = new Map(levels.map((l) => [l.inventory_item_id, l.available]));
    } catch {
      live = null; // Fall back to synced values — never fail the stock check
    }
  }

  const results = (variants ?? []).map((v) => {
    const liveQty = live?.has(v.inventory_item_id) ? live.get(v.inventory_item_id) : undefined;
    const qty = liveQty ?? v.inventory_qty;
    const product = v.shopify_products as unknown as { title: string; handle: string };
    return {
      variant_id: v.shopify_variant_id,
      product_title: product.title,
      variant_title: v.title,
      sku: v.sku,
      price_cents: v.price_cents,
      inventory_qty: qty,
      available: (qty ?? 0) > 0,
      live: liveQty !== undefined,
    };
  });

  return NextResponse.json({ results });
}
