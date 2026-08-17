import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const score = searchParams.get("score");
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const page = parseInt(searchParams.get("page") ?? "1");
  const pageSize = parseInt(searchParams.get("pageSize") ?? "50");

  let query = supabase
    .from("leads")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (score && score !== "ALL") {
    query = query.eq("lead_score", score);
  }
  if (status && status !== "ALL") {
    query = query.eq("status", status);
  }
  if (search) {
    query = query.or(`full_name.ilike.%${search}%,phone_number.ilike.%${search}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    leads: data,
    total: count,
    page,
    pageSize,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  });
}
