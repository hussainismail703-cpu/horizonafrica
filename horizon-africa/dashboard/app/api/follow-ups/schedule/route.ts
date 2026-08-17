import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { lead_id?: number; follow_up_date?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { lead_id, follow_up_date } = body;

  if (!lead_id || !follow_up_date) {
    return NextResponse.json(
      { error: "lead_id and follow_up_date are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("leads")
    .update({
      follow_up_requested: true,
      follow_up_date: follow_up_date,
      follow_up_sent: false,
      follow_up_sent_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", Number(lead_id))
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lead: data });
}
