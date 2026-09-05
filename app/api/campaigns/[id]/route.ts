import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID_STATUSES = ["draft", "active", "paused", "stopped"];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 200;

// PATCH /api/campaigns/[id] — update campaign metadata and/or status
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Validate UUID format before hitting the database
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
    name?: string;
    objective?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    status?: string;
    group_id?: string | number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Handle null body from parsed "null" JSON
  if (body === null || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    // Strip null bytes which Postgres rejects
    const cleanName = body.name.replace(/\x00/g, "").trim();
    if (!cleanName) {
      return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    if (cleanName.length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` },
        { status: 400 }
      );
    }
    // Check duplicate name (excluding this campaign)
    const { data: dup } = await supabase
      .from("campaigns")
      .select("id")
      .eq("name", cleanName)
      .neq("id", id)
      .maybeSingle();
    if (dup) {
      return NextResponse.json(
        { error: "A campaign with this name already exists" },
        { status: 409 }
      );
    }
    patch.name = cleanName;
  }
  if (body.objective !== undefined) {
    patch.objective = typeof body.objective === "string" ? body.objective.replace(/\x00/g, "") : body.objective;
  }
  if (body.start_date !== undefined) patch.start_date = body.start_date;
  if (body.end_date !== undefined) patch.end_date = body.end_date;
  if (body.group_id !== undefined) {
    patch.group_id = body.group_id === "" ? null : body.group_id;
  }

  if (body.status !== undefined) {
    // Validate status against allowed enum values
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }
    // Prevent activating a campaign with zero steps
    if (body.status === "active") {
      const { count } = await supabase
        .from("campaign_steps")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", id);
      if (count === 0) {
        return NextResponse.json(
          { error: "Cannot activate a campaign with zero steps" },
          { status: 400 }
        );
      }
    }
    patch.status = body.status;
  }

  // Set current user for audit context
  await supabase.rpc("set_config", {
    config_name: "app.current_user",
    config_value: user.email ?? "unknown",
    is_local: true,
  });

  const { error } = await supabase.from("campaigns").update(patch).eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
