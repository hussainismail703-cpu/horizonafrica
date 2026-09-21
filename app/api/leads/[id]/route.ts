import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const VALID_SCORES = ["HOT", "WARM", "COLD"];
  const VALID_STATUSES = ["new", "contacted", "qualified", "converted", "lost"];
  if (body.lead_score !== undefined && !VALID_SCORES.includes(body.lead_score)) {
    return NextResponse.json({ error: "Invalid lead_score" }, { status: 400 });
  }
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const allowedFields = ["lead_score", "status", "full_name", "email", "notes"];
  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  // Manual edits take precedence over AI re-scoring: lock the field so the
  // n8n workflow leaves it alone until explicitly unlocked via the flags below.
  if (updates.lead_score !== undefined) updates.score_locked = true;
  if (updates.status !== undefined) updates.status_locked = true;
  for (const lock of ["score_locked", "status_locked"]) {
    if (typeof body[lock] === "boolean") updates[lock] = body[lock];
  }

  updates.updated_at = new Date().toISOString();

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("leads")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lead: data });
}
