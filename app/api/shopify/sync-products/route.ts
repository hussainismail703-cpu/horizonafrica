import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isShopifyConfigured } from "@/lib/shopify";
import { syncAllProducts } from "@/lib/shopify-sync";

export const maxDuration = 60;

// POST /api/shopify/sync-products
// Called by the n8n 15-min scheduler (Bearer APP_SECRET) or by the
// "Sync now" button on the products page (authenticated dashboard user).
export async function POST(req: NextRequest) {
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

  if (!isShopifyConfigured()) {
    return NextResponse.json(
      { error: "Shopify is not configured (SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN)" },
      { status: 503 }
    );
  }

  try {
    const result = await syncAllProducts(supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
