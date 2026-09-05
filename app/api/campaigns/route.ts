import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_NAME_LENGTH = 200;

// POST /api/campaigns — create a new campaign
export async function POST(req: NextRequest) {
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
    group_id?: string | null;
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

  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Strip null bytes which Postgres rejects
  const cleanName = body.name.replace(/\x00/g, "").trim();
  if (!cleanName) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (cleanName.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` },
      { status: 400 }
    );
  }

  // Prevent duplicate names
  const { data: existing } = await supabase
    .from("campaigns")
    .select("id")
    .eq("name", cleanName)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "A campaign with this name already exists" },
      { status: 409 }
    );
  }

  const cleanObjective = typeof body.objective === "string" ? body.objective.replace(/\x00/g, "") : body.objective ?? null;

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      name: cleanName,
      objective: cleanObjective,
      start_date: body.start_date ?? null,
      end_date: body.end_date ?? null,
      group_id: body.group_id ?? null,
      status: "draft",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
