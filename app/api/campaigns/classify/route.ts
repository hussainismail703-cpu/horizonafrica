import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { classifyResponse } from "@/lib/classification";

// POST /api/campaigns/classify
// Called by n8n or the webhook after an inbound message is received from a
// campaign enrollee. Classifies the response and stores the result.
//
// Body: { phone_number, message_text, campaign_id?, enrol_id? }
// If campaign_id/enrol_id are not provided, they are looked up from the
// most recent active/responded enrolment for this phone number.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Allow either authenticated dashboard users or n8n with the APP_SECRET
  const authHeader = req.headers.get("authorization");
  const appSecret = process.env.APP_SECRET;
  const isAppSecretAuth = appSecret && authHeader === `Bearer ${appSecret}`;

  if (!user && !isAppSecretAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    phone_number?: string;
    message_text?: string;
    campaign_id?: string;
    enrol_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.phone_number || !body.message_text) {
    return NextResponse.json(
      { error: "phone_number and message_text are required" },
      { status: 400 }
    );
  }

  const phone = body.phone_number.replace(/\D/g, "");

  // Look up enrolment if not provided
  let campaignId = body.campaign_id;
  let enrolId = body.enrol_id;

  if (!campaignId || !enrolId) {
    const { data: enrolment } = await supabase
      .from("campaign_enrolments")
      .select("id, campaign_id")
      .eq("phone_number", phone)
      .in("status", ["responded", "active"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (enrolment) {
      campaignId = enrolment.campaign_id;
      enrolId = enrolment.id;
    }
  }

  if (!campaignId || !enrolId) {
    return NextResponse.json(
      { error: "No campaign enrolment found for this phone number" },
      { status: 404 }
    );
  }

  const result = await classifyResponse(
    body.message_text,
    campaignId,
    enrolId,
    phone
  );

  return NextResponse.json(result);
}
