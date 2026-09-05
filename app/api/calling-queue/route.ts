import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_QUEUE_STATUSES = ["pending", "called", "converted", "lost", "callback_scheduled"];

// GET /api/calling-queue?campaign_id=<id>&queue_status=<status>&search=<query>
// Returns calling queue items with optional filters.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaign_id");
  const queueStatus = searchParams.get("queue_status");
  const search = searchParams.get("search")?.trim();

  let query = supabase
    .from("calling_queue")
    .select(`
      *,
      campaign:campaigns(id, name)
    `)
    .order("created_at", { ascending: false });

  if (campaignId) {
    if (!UUID_REGEX.test(campaignId)) {
      return NextResponse.json({ error: "Invalid campaign_id format" }, { status: 400 });
    }
    query = query.eq("campaign_id", campaignId);
  }

  if (queueStatus) {
    if (!VALID_QUEUE_STATUSES.includes(queueStatus)) {
      return NextResponse.json({ error: "Invalid queue_status" }, { status: 400 });
    }
    query = query.eq("queue_status", queueStatus);
  }

  if (search) {
    // Strip null bytes and limit length
    const cleanSearch = search.replace(/\x00/g, "").slice(0, 100);
    query = query.or(
      `phone_number.ilike.%${cleanSearch}%,full_name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data });
}

// POST /api/calling-queue
// Manually add an item to the calling queue (for edge cases).
// Body: { campaign_id?, enrolment_id?, phone_number, lead_id?, full_name?, email?,
//         preferred_package?, customer_request?, preferred_callback_time?,
//         campaign_source?, campaign_stage?, final_outcome? }
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body === null || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const phoneNumber = typeof body.phone_number === "string" ? body.phone_number.replace(/\D/g, "") : "";
  if (!phoneNumber) {
    return NextResponse.json({ error: "phone_number is required" }, { status: 400 });
  }

  // Validate UUIDs if provided
  const campaignId = body.campaign_id;
  if (campaignId && typeof campaignId === "string" && !UUID_REGEX.test(campaignId)) {
    return NextResponse.json({ error: "Invalid campaign_id format" }, { status: 400 });
  }

  const enrolmentId = body.enrolment_id;
  if (enrolmentId && typeof enrolmentId === "string" && !UUID_REGEX.test(enrolmentId)) {
    return NextResponse.json({ error: "Invalid enrolment_id format" }, { status: 400 });
  }

  // Build insert row — strip null bytes from text fields
  const stripNull = (v: unknown) => (typeof v === "string" ? v.replace(/\x00/g, "") : null);

  const row: Record<string, unknown> = {
    phone_number: phoneNumber,
    queue_status: "pending",
  };

  if (campaignId) row.campaign_id = campaignId;
  if (enrolmentId) row.enrolment_id = enrolmentId;
  if (body.lead_id !== undefined) row.lead_id = body.lead_id;
  if (body.full_name !== undefined) row.full_name = stripNull(body.full_name);
  if (body.email !== undefined) row.email = stripNull(body.email);
  if (body.preferred_package !== undefined) row.preferred_package = stripNull(body.preferred_package);
  if (body.customer_request !== undefined) row.customer_request = stripNull(body.customer_request);
  if (body.preferred_callback_time !== undefined) row.preferred_callback_time = stripNull(body.preferred_callback_time);
  if (body.campaign_source !== undefined) row.campaign_source = stripNull(body.campaign_source);
  if (body.campaign_stage !== undefined) row.campaign_stage = stripNull(body.campaign_stage);
  if (body.final_outcome !== undefined) row.final_outcome = stripNull(body.final_outcome);

  const { data, error } = await supabase
    .from("calling_queue")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
