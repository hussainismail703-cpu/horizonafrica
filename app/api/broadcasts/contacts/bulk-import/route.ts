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
  const normalized = contacts
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

  if (normalized.length === 0) {
    return NextResponse.json({ error: "No valid contacts found. Phone numbers must be at least 10 digits." }, { status: 400 });
  }

  // Dedupe within the payload (last entry wins for a repeated phone) so the
  // same customer can't receive a broadcast twice from one import.
  const deduped = new Map<string, (typeof normalized)[number]>();
  for (const row of normalized) deduped.set(row.phone_number, row);
  const rows = Array.from(deduped.values());
  const dupesInPayload = normalized.length - rows.length;

  // The uq_broadcast_contacts_group_phone unique index makes this safe:
  // rows that already exist in the group are skipped instead of duplicated.
  const { data, error } = await supabase
    .from("broadcast_contacts")
    .upsert(rows, { onConflict: "group_id,phone_number", ignoreDuplicates: true })
    .select("id, contact_name, phone_number, group_id, opt_in, created_at");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const imported = data?.length ?? 0;
  return NextResponse.json({
    imported,
    skipped: contacts.length - imported,
    skipped_duplicates: dupesInPayload + (rows.length - imported),
    contacts: data,
  }, { status: 201 });
}
