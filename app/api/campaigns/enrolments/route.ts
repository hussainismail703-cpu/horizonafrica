import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/campaigns/enrolments?campaign_id=<id>
// Returns enrolments for a campaign with lead info joined.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaign_id");
  if (!campaignId) {
    return NextResponse.json({ error: "campaign_id is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("campaign_enrolments")
    .select(`
      *,
      lead:leads(id, full_name, email, status, notes)
    `)
    .eq("campaign_id", campaignId)
    .order("enrolled_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ enrolments: data });
}

// POST /api/campaigns/enrolments
// Enrol contacts into a campaign either by group_id or explicit phone numbers.
// Body: { campaign_id: string, group_id?: number, phone_numbers?: string[] }
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    campaign_id?: string;
    group_id?: number | null;
    phone_numbers?: string[];
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

  const campaignId = body.campaign_id;
  if (!campaignId) {
    return NextResponse.json({ error: "campaign_id is required" }, { status: 400 });
  }

  // Verify the campaign exists
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, status")
    .eq("id", campaignId)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  // Resolve phone numbers from group_id or explicit list
  let phoneNumbers: string[] = [];

  if (body.phone_numbers && Array.isArray(body.phone_numbers)) {
    phoneNumbers = body.phone_numbers
      .map((p) => p.replace(/\D/g, ""))
      .filter((p) => p.length > 0);
  } else if (body.group_id) {
    const { data: contacts, error: contactsErr } = await supabase
      .from("broadcast_contacts")
      .select("phone_number")
      .eq("group_id", body.group_id)
      .eq("opt_in", true);

    if (contactsErr) {
      return NextResponse.json(
        { error: `Failed to load group contacts: ${contactsErr.message}` },
        { status: 500 }
      );
    }

    phoneNumbers = (contacts ?? [])
      .map((c) => (c.phone_number ?? "").replace(/\D/g, ""))
      .filter((p) => p.length > 0);
  } else {
    return NextResponse.json(
      { error: "Either group_id or phone_numbers must be provided" },
      { status: 400 }
    );
  }

  if (phoneNumbers.length === 0) {
    return NextResponse.json(
      { error: "No phone numbers to enrol" },
      { status: 400 }
    );
  }

  // Deduplicate
  const uniquePhones = Array.from(new Set(phoneNumbers));

  // Exclude opted-out phone numbers (global opt-out list)
  const { data: optedOut } = await supabase
    .from("opt_out_list")
    .select("phone_number")
    .in("phone_number", uniquePhones);

  const optedOutSet = new Set((optedOut ?? []).map((o) => o.phone_number));
  const enrolablePhones = uniquePhones.filter((p) => !optedOutSet.has(p));
  const excludedOptOut = uniquePhones.length - enrolablePhones.length;

  // Look up existing leads by phone_number to populate lead_id
  const { data: leads } = await supabase
    .from("leads")
    .select("id, phone_number")
    .in("phone_number", enrolablePhones);

  const leadMap = new Map<string, number>();
  for (const lead of leads ?? []) {
    leadMap.set(lead.phone_number.replace(/\D/g, ""), lead.id);
  }

  // Check for existing active enrolments to avoid unique constraint violations
  const { data: existingEnrolments } = await supabase
    .from("campaign_enrolments")
    .select("phone_number, status")
    .eq("campaign_id", campaignId)
    .in("phone_number", enrolablePhones)
    .neq("status", "removed");

  const existingActivePhones = new Set(
    (existingEnrolments ?? []).map((e) => e.phone_number)
  );

  // Build enrolment rows for phones that don't already have an active enrolment
  const rowsToInsert = enrolablePhones
    .filter((phone) => !existingActivePhones.has(phone))
    .map((phone) => ({
      campaign_id: campaignId,
      phone_number: phone,
      lead_id: leadMap.get(phone) ?? null,
      current_step: 0,
      status: "active",
      nurture_flag: false,
    }));

  let enrolled = 0;
  const errors: string[] = [];

  if (rowsToInsert.length > 0) {
    const { error: insertErr } = await supabase
      .from("campaign_enrolments")
      .insert(rowsToInsert);

    if (insertErr) {
      errors.push(insertErr.message);
    } else {
      enrolled = rowsToInsert.length;
    }
  }

  const skipped = enrolablePhones.length - enrolled;

  return NextResponse.json(
    {
      enrolled,
      skipped,
      excluded_opt_out: excludedOptOut,
      errors,
    },
    { status: 201 }
  );
}
