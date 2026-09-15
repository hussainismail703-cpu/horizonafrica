import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone-utils";

interface ImportContact {
  contact_name: string | null;
  phone_number: string;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { group_id, contacts } = body as {
    group_id?: number;
    contacts: ImportContact[];
  };

  if (!group_id) {
    return NextResponse.json({ error: "group_id is required" }, { status: 400 });
  }

  if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
    return NextResponse.json({ error: "contacts array is required and must not be empty" }, { status: 400 });
  }

  if (contacts.length > 10000) {
    return NextResponse.json({ error: "Maximum 10,000 contacts per import" }, { status: 400 });
  }

  // Normalize phone numbers and validate
  const rows = contacts
    .map((c) => {
      const phone = normalizePhone(c.phone_number || "");
      if (!phone || phone.length < 10) return null;
      return {
        contact_name: c.contact_name || null,
        phone_number: phone,
        group_id: Number(group_id),
        opt_in: true,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid contacts found. Phone numbers must be at least 10 digits." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("broadcast_contacts")
    .insert(rows)
    .select("id, contact_name, phone_number, group_id, opt_in, created_at");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    imported: data?.length ?? 0,
    skipped: contacts.length - rows.length,
    contacts: data,
  }, { status: 201 });
}
