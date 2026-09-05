import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_QUEUE_STATUSES = ["pending", "called", "converted", "lost", "callback_scheduled"];

// PATCH /api/calling-queue/[id]
// Update a calling queue item's status, call notes, etc.
// Body: { queue_status?, called_by?, call_notes?, preferred_callback_time?, preferred_package? }
// When queue_status → "converted", also update the linked lead's status to "converted".
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: "Invalid queue item ID format" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    queue_status?: string;
    called_by?: string;
    call_notes?: string;
    preferred_callback_time?: string;
    preferred_package?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body === null || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if (body.queue_status !== undefined) {
    if (!VALID_QUEUE_STATUSES.includes(body.queue_status)) {
      return NextResponse.json(
        { error: `Invalid queue_status. Must be one of: ${VALID_QUEUE_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }
    update.queue_status = body.queue_status;

    // Set called_at timestamp when transitioning to called/converted/lost
    if (["called", "converted", "lost"].includes(body.queue_status)) {
      update.called_at = new Date().toISOString();
    }
  }

  if (body.called_by !== undefined) {
    update.called_by = typeof body.called_by === "string" ? body.called_by.replace(/\x00/g, "").slice(0, 255) : null;
  }

  if (body.call_notes !== undefined) {
    update.call_notes = typeof body.call_notes === "string" ? body.call_notes.replace(/\x00/g, "").slice(0, 5000) : null;
  }

  if (body.preferred_callback_time !== undefined) {
    update.preferred_callback_time =
      typeof body.preferred_callback_time === "string" ? body.preferred_callback_time.replace(/\x00/g, "").slice(0, 255) : null;
  }

  if (body.preferred_package !== undefined) {
    update.preferred_package =
      typeof body.preferred_package === "string" ? body.preferred_package.replace(/\x00/g, "").slice(0, 255) : null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Set audit context
  await supabase.rpc("set_config", {
    config_name: "app.current_user",
    config_value: user.email ?? "unknown",
    is_local: true,
  });

  const { data: updated, error } = await supabase
    .from("calling_queue")
    .update(update)
    .eq("id", id)
    .select("lead_id, queue_status")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If marking as converted, update the linked lead's status to "converted"
  if (updated.queue_status === "converted" && updated.lead_id) {
    await supabase
      .from("leads")
      .update({ status: "converted", updated_at: new Date().toISOString() })
      .eq("id", updated.lead_id);
  }

  return NextResponse.json({ ok: true });
}
