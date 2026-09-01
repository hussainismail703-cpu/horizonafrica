import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PUT /api/campaigns/[id]/steps — replace the full sequence of steps for a campaign
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    steps: { step_number: number; delay_days: number; template_name: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.steps)) {
    return NextResponse.json({ error: "steps must be an array" }, { status: 400 });
  }

  // Validate
  for (const s of body.steps) {
    if (!s.template_name || typeof s.delay_days !== "number" || s.delay_days < 0) {
      return NextResponse.json(
        { error: "Each step needs a template_name and a non-negative delay_days" },
        { status: 400 }
      );
    }
  }

  // Atomic replace: delete existing, insert new
  const { error: delErr } = await supabase
    .from("campaign_steps")
    .delete()
    .eq("campaign_id", id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  if (body.steps.length > 0) {
    const rows = body.steps.map((s, i) => ({
      campaign_id: id,
      step_number: i + 1,
      delay_days: s.delay_days,
      template_name: s.template_name,
    }));
    const { error: insErr } = await supabase
      .from("campaign_steps")
      .insert(rows);
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, count: body.steps.length });
}
