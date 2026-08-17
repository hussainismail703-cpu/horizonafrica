import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "alert_emails")
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const emails: string[] = data?.value ?? [];
  return NextResponse.json({ emails });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { emails } = await request.json();

  if (!Array.isArray(emails)) {
    return NextResponse.json({ error: "emails must be an array" }, { status: 400 });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalid = emails.filter((e: string) => !emailRegex.test(e));
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Invalid email(s): ${invalid.join(", ")}` }, { status: 400 });
  }

  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: "alert_emails", value: emails, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ emails });
}
