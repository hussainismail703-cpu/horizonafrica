import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("display_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ products: data });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, product_type, speed_down, speed_up, price_cents, billing_period, description, is_uncapped, is_active, display_order } = body;

  if (!name || !product_type) {
    return NextResponse.json(
      { error: "name and product_type are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("products")
    .insert({
      name,
      product_type,
      speed_down: speed_down ?? null,
      speed_up: speed_up ?? null,
      price_cents: price_cents ?? null,
      billing_period: billing_period ?? "monthly",
      description: description ?? null,
      is_uncapped: is_uncapped ?? true,
      is_active: is_active ?? true,
      display_order: display_order ?? 0,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ product: data }, { status: 201 });
}
