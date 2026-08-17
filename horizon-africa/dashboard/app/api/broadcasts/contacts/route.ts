import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { contact_name, phone_number, group_id } = body;

  if (!phone_number || !group_id) {
    return NextResponse.json(
      { error: "phone_number and group_id are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("broadcast_contacts")
    .insert({
      contact_name: contact_name ?? null,
      phone_number,
      group_id: Number(group_id),
      opt_in: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contact: data }, { status: 201 });
}
