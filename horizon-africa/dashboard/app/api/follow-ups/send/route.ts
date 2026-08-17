import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendFollowUps } from "@/lib/follow-ups";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendFollowUps();

  return NextResponse.json(result);
}
