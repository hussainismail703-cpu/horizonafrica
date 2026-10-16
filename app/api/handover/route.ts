import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setHumanTakeover } from "@/lib/handover";

// POST /api/handover
// Sets or clears the human-takeover flag on a lead. Two callers:
//   - n8n / Chatwoot automation → Bearer APP_SECRET
//   - dashboard "Take over"/"Release" button → authenticated session cookie
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const appSecret = process.env.APP_SECRET;
  const bearerOk = !!appSecret && authHeader === `Bearer ${appSecret}`;

  if (!bearerOk) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 }
    );
  }

  const phone = body.phone ?? body.phone_number;
  if (typeof phone !== "string" || !phone.trim()) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }
  if (typeof body.take_over !== "boolean") {
    return NextResponse.json(
      { error: "take_over must be a boolean" },
      { status: 400 }
    );
  }

  const by =
    typeof body.by === "string" && body.by.trim()
      ? body.by.replace(/\x00/g, "").trim().slice(0, 120)
      : bearerOk
        ? "n8n"
        : "dashboard";

  const result = await setHumanTakeover(phone.trim(), body.take_over, by);
  if (!result.ok) {
    const status = result.error === "invalid_phone" ? 400 : 500;
    return NextResponse.json(
      { error: result.error === "invalid_phone" ? "Invalid phone number" : "Handover update failed" },
      { status }
    );
  }

  return NextResponse.json({ ok: true, human_takeover: body.take_over, matched: result.matched });
}
