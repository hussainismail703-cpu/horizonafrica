import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/shopify/products
// Cookie-authenticated list of the synced Shopify catalog (products joined
// with variants) — backs the read-only Products dashboard page.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("shopify_products")
    .select("*, shopify_variants(*)")
    .order("title", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ products: data ?? [] });
}
