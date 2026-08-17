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

  let query = supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  if (score && score !== "ALL") {
    query = query.eq("lead_score", score);
  }
  if (status && status !== "ALL") {
    query = query.eq("status", status);
  }
  if (search) {
    query = query.or(`full_name.ilike.%${search}%,phone_number.ilike.%${search}%`);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const headers = ["Name", "Phone", "Email", "Product Interest", "Score", "Status", "Created"];
  const rows = (data ?? []).map((l) => [
    l.full_name ?? "",
    l.phone_number,
    l.email ?? "",
    l.product_interest ?? "",
    l.lead_score,
    l.status,
    new Date(l.created_at).toISOString(),
  ]);

  const csv = [headers, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
