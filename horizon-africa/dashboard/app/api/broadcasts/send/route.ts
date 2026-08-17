import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const META_API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID!;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN!;

interface MetaSendResponse {
  messaging_product: string;
  contacts: { input: string; wa_id: string }[];
  messages: { id: string }[];
  error?: { message: string; code: number };
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!META_PHONE_NUMBER_ID || !META_ACCESS_TOKEN) {
    return NextResponse.json(
      { error: "Meta WhatsApp env vars not configured. Set META_PHONE_NUMBER_ID and META_ACCESS_TOKEN." },
      { status: 500 }
    );
  }

  const body = await request.json();
  const { template_name, group_id, test_phone, campaign_name, template_parameters, template_language } = body;

  const langCode = template_language || "en_US";

  // template_parameters: array of { source: "contact_name" | "custom", value?: string, component: "header" | "body" }
  // Must match the total number of {{N}} placeholders across all template components
  type TemplateParam = { source: "contact_name" | "custom"; value?: string; component?: string };
  const params: TemplateParam[] = Array.isArray(template_parameters) ? template_parameters : [];

  if (!template_name) {
    return NextResponse.json({ error: "template_name is required" }, { status: 400 });
  }

  // Determine recipients: test_phone (single) or all contacts in a group
  let recipients: { phone_number: string; contact_name: string | null }[] = [];

  if (test_phone) {
    recipients = [{ phone_number: test_phone, contact_name: null }];
  } else if (group_id) {
    const { data: contacts, error: contactsError } = await supabase
      .from("broadcast_contacts")
      .select("phone_number, contact_name")
      .eq("group_id", Number(group_id))
      .eq("opt_in", true);

    if (contactsError) {
      return NextResponse.json({ error: contactsError.message }, { status: 500 });
    }
    recipients = contacts ?? [];
  } else {
    return NextResponse.json({ error: "Either test_phone or group_id is required" }, { status: 400 });
  }

  if (recipients.length === 0) {
    return NextResponse.json({ error: "No recipients found" }, { status: 400 });
  }

  // Create broadcast history record
  const { data: historyRecord, error: historyError } = await supabase
    .from("broadcast_history")
    .insert({
      campaign_name: campaign_name || `Broadcast ${new Date().toLocaleString()}`,
      group_id: group_id ? Number(group_id) : null,
      template_name,
      message_content: null,
      total_sent: 0,
      total_delivered: 0,
      total_read: 0,
      total_failed: 0,
      status: "sending",
      sent_by: user.email ?? null,
    })
    .select()
    .single();

  if (historyError) {
    return NextResponse.json({ error: historyError.message }, { status: 500 });
  }

  const broadcastId = historyRecord.id;
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  // Send messages sequentially to avoid rate limits
  for (const recipient of recipients) {
    const phone = recipient.phone_number.replace(/\D/g, "");

    const template: Record<string, unknown> = {
      name: template_name,
      language: { code: langCode },
    };

    // Build components with parameters if template has them
    if (params.length > 0) {
      // Group params by component type (header, body)
      const byComponent: Record<string, typeof params> = {};
      for (const p of params) {
        const compKey = p.component ?? "body";
        if (!byComponent[compKey]) byComponent[compKey] = [];
        byComponent[compKey].push(p);
      }

      template.components = Object.entries(byComponent).map(([compType, compParams]) => ({
        type: compType,
        parameters: compParams.map((p) => {
          let value: string;
          if (p.source === "contact_name") {
            value = recipient.contact_name?.trim() || "there";
          } else {
            value = p.value ?? "";
          }
          return { type: "text", text: value };
        }),
      }));
    }

    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "template",
      template,
    };

    try {
      const res = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${META_PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${META_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      const data: MetaSendResponse = await res.json();

      if (!res.ok || data.error) {
        failed++;
        errors.push(`${phone}: ${data.error?.message ?? "Unknown error"}`);
      } else {
        sent++;
      }
    } catch {
      failed++;
      errors.push(`${phone}: Network error`);
    }
  }

  // Update broadcast history
  await supabase
    .from("broadcast_history")
    .update({
      total_sent: sent,
      total_failed: failed,
      status: failed === recipients.length ? "failed" : "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", broadcastId);

  return NextResponse.json({
    broadcast_id: broadcastId,
    total_recipients: recipients.length,
    sent,
    failed,
    errors: errors.length > 0 ? errors : undefined,
  });
}
