import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone-utils";

// GET /api/conversations?phone=<number>&before=<iso-timestamp>&limit=<n>
// Returns one thread's messages (oldest-first) so the Conversations page can
// lazy-load a chat on selection instead of fetching every row up front.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const phone = normalizePhone(searchParams.get("phone") ?? "");
  if (!phone) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }

  const limitParam = Number(searchParams.get("limit") ?? 200);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.trunc(limitParam), 1), 500)
    : 200;
  const before = searchParams.get("before");

  // Match the thread by canonical number plus common raw variants so
  // historical rows written before normalization still load.
  const variants = Array.from(
    new Set([phone, `+${phone}`, `0${phone.slice(2)}`])
  );

  let query = supabase
    .from("conversations")
    .select("*")
    .in("phone_number", variants)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (before) {
    const ts = new Date(before);
    if (!Number.isNaN(ts.getTime())) {
      query = query.lt("created_at", ts.toISOString());
    }
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  return NextResponse.json({
    messages: page.reverse(),
    has_more: hasMore,
    next_before: hasMore ? page[0]?.created_at ?? null : null,
  });
}
