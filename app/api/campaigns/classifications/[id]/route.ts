import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/campaigns/classifications/[id]
// Manually correct a classification. Preserves the original AI classification.
// Body: { classification, rejection_reason? }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { classification?: string; rejection_reason?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validClassifications = [
    "interested", "not_interested", "already_has_service",
    "needs_information", "no_response", "other", "uncertain",
  ];
  if (!body.classification || !validClassifications.includes(body.classification)) {
    return NextResponse.json({ error: "Invalid classification" }, { status: 400 });
  }

  // Fetch current record to preserve original_ai_classification
  const { data: existing } = await supabase
    .from("campaign_classifications")
    .select("original_ai_classification, classification")
    .eq("id", id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Classification not found" }, { status: 404 });
  }

  // Set audit context
  await supabase.rpc("set_config", {
    config_name: "app.current_user",
    config_value: user.email ?? "unknown",
    is_local: true,
  });

  const patch: Record<string, unknown> = {
    classification: body.classification,
    classified_by: "manual",
    corrected_by: user.email ?? "unknown",
    corrected_at: new Date().toISOString(),
  };

  // Preserve the original AI classification if not already set
  if (!existing.original_ai_classification && existing.classification) {
    patch.original_ai_classification = existing.classification;
  }

  if (body.rejection_reason !== undefined) {
    patch.rejection_reason = body.rejection_reason;
  }

  const { error } = await supabase
    .from("campaign_classifications")
    .update(patch)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
