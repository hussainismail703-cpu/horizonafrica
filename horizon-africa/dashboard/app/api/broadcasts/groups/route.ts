import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [groupsRes, contactsRes] = await Promise.all([
    supabase.from("broadcast_groups").select("*").order("id"),
    supabase.from("broadcast_contacts").select("*"),
  ]);

  if (groupsRes.error) {
    return NextResponse.json({ error: groupsRes.error.message }, { status: 500 });
  }

  const groups = (groupsRes.data ?? []).map((g) => ({
    ...g,
    contact_count: (contactsRes.data ?? []).filter((c) => c.group_id === g.id).length,
  }));

  return NextResponse.json({ groups });
}
