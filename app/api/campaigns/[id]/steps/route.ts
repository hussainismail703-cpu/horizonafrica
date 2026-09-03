import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DELAY_DAYS = 365;
const MAX_STEPS = 100;
const BATCH_SIZE = 50;

// PUT /api/campaigns/[id]/steps — replace the full sequence of steps for a campaign
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Validate UUID format
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: "Invalid campaign ID format" }, { status: 400 });
  }

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

  // Handle null body
  if (body === null || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  if (!Array.isArray(body.steps)) {
    return NextResponse.json({ error: "steps must be an array" }, { status: 400 });
  }

  if (body.steps.length > MAX_STEPS) {
    return NextResponse.json(
      { error: `A campaign can have at most ${MAX_STEPS} steps` },
      { status: 400 }
    );
  }

  // Validate each step
  for (const s of body.steps) {
    if (!s.template_name || typeof s.template_name !== "string") {
      return NextResponse.json(
        { error: "Each step needs a template_name" },
        { status: 400 }
      );
    }
    if (typeof s.delay_days !== "number" || !Number.isFinite(s.delay_days) || s.delay_days < 0) {
      return NextResponse.json(
        { error: "Each step needs a non-negative, finite delay_days" },
        { status: 400 }
      );
    }
    if (s.delay_days > MAX_DELAY_DAYS) {
      return NextResponse.json(
        { error: `delay_days must be ${MAX_DELAY_DAYS} or fewer` },
        { status: 400 }
      );
    }
    if (typeof s.step_number !== "number" || !Number.isInteger(s.step_number) || s.step_number < 1) {
      return NextResponse.json(
        { error: "step_number must be a positive integer" },
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
      template_name: s.template_name.replace(/\x00/g, ""),
    }));

    // Insert in batches to avoid Postgres parameter limits
    const errors: string[] = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error: insErr } = await supabase
        .from("campaign_steps")
        .insert(batch);
      if (insErr) errors.push(insErr.message);
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join("; ") }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, count: body.steps.length });
}
