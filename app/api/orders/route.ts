import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { OrderStatus, OrderTrack } from "@/lib/types";

const VALID_STATUSES: OrderStatus[] = [
  "pending_payment",
  "paid",
  "payment_failed",
  "cancelled",
  "expired",
  "handed_to_orders",
];
const VALID_TRACKS: OrderTrack[] = ["stock_on_hand", "imported"];

// GET /api/orders?status=<status>&track=<track>&search=<query>&limit=<n>
// Cookie-authenticated order list for the Orders dashboard.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const track = searchParams.get("track");
  const search = searchParams.get("search")?.trim().replace(/\x00/g, "").slice(0, 100);
  const limitParam = Number(searchParams.get("limit") ?? "200");
  const limit = Number.isInteger(limitParam)
    ? Math.min(Math.max(limitParam, 1), 500)
    : 200;

  if (status && !VALID_STATUSES.includes(status as OrderStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  if (track && !VALID_TRACKS.includes(track as OrderTrack)) {
    return NextResponse.json({ error: "Invalid track" }, { status: 400 });
  }

  let query = supabase
    .from("orders")
    .select("*, lead:leads(id, full_name, email)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (track) query = query.eq("order_track", track);
  if (search) {
    const escaped = search.replace(/[%_,()]/g, "");
    const clauses = [
      `phone_number.ilike.%${escaped}%`,
      `customer_name.ilike.%${escaped}%`,
      `customer_email.ilike.%${escaped}%`,
    ];
    if (/^\d+$/.test(escaped)) clauses.push(`order_number.eq.${escaped}`);
    if (escaped) query = query.or(clauses.join(","));
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ orders: data ?? [] });
}
