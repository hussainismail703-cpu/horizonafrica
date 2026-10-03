import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone-utils";
import { formatDateTime } from "@/lib/format";

export const maxDuration = 60;

const META_API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID!;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN!;

// Stop claiming new sends before the function timeout so in-flight work can
// finish and broadcast_history always gets written (no rows stuck "sending").
const SEND_BUDGET_MS = 45_000;
// Bounded parallelism: Meta allows ~80 msg/s, we stay deliberately lower.
const SEND_CONCURRENCY = 8;
// Write progress to broadcast_history periodically so a hard kill still
// leaves approximately-correct totals instead of a stuck "sending" row.
const PROGRESS_FLUSH_EVERY = 25;

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

  // Exclude globally opted-out phone numbers (STOP replies from any channel)
  const { data: optedOutRows } = await supabase
    .from("opt_out_list")
    .select("phone_number");

  const optedOutSet = new Set(
    (optedOutRows ?? []).map((o) => normalizePhone(o.phone_number))
  );

  const skippedOptedOut = recipients.filter((r) =>
    optedOutSet.has(normalizePhone(r.phone_number))
  ).length;
  recipients = recipients.filter(
    (r) => !optedOutSet.has(normalizePhone(r.phone_number))
  );

  if (recipients.length === 0) {
    return NextResponse.json(
      {
        error:
          skippedOptedOut > 0
            ? "All recipients have opted out"
            : "No recipients found",
      },
      { status: 400 }
    );
  }

  // Create broadcast history record
  const { data: historyRecord, error: historyError } = await supabase
    .from("broadcast_history")
    .insert({
      campaign_name: campaign_name || `Broadcast ${formatDateTime(new Date())}`,
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
  const deadline = Date.now() + SEND_BUDGET_MS;
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  const messageRows: {
    broadcast_id: number;
    phone_number: string;
    wamid: string | null;
    status: string;
    error: string | null;
  }[] = [];

  const flushProgress = async (finalStatus?: string) => {
    await supabase
      .from("broadcast_history")
      .update({
        total_sent: sent,
        total_failed: failed,
        ...(finalStatus
          ? { status: finalStatus, completed_at: new Date().toISOString() }
          : {}),
      })
      .eq("id", broadcastId);
  };

  const sendOne = async (recipient: {
    phone_number: string;
    contact_name: string | null;
  }) => {
    const phone = normalizePhone(recipient.phone_number);

    const template: Record<string, unknown> = {
      name: template_name,
      language: { code: langCode },
    };

    if (params.length > 0) {
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
      const wamid = data.messages?.[0]?.id ?? null;

      if (!res.ok || data.error) {
        failed++;
        const errMsg = data.error?.message ?? "Unknown error";
        errors.push(`${phone}: ${errMsg}`);
        messageRows.push({
          broadcast_id: broadcastId,
          phone_number: phone,
          wamid,
          status: "failed",
          error: errMsg,
        });
      } else {
        sent++;
        messageRows.push({
          broadcast_id: broadcastId,
          phone_number: phone,
          wamid,
          status: "sent",
          error: null,
        });
      }
    } catch {
      failed++;
      errors.push(`${phone}: Network error`);
      messageRows.push({
        broadcast_id: broadcastId,
        phone_number: phone,
        wamid: null,
        status: "failed",
        error: "Network error",
      });
    }
  };

  // Worker pool over recipients with a wall-clock budget. Deferred
  // recipients are reported so the operator can resend to the remainder.
  let cursor = 0;
  const worker = async () => {
    while (cursor < recipients.length) {
      if (Date.now() >= deadline) break;
      const recipient = recipients[cursor++];
      await sendOne(recipient);
      if ((sent + failed) % PROGRESS_FLUSH_EVERY === 0) {
        await flushProgress();
      }
    }
  };
  await Promise.all(
    Array.from({ length: SEND_CONCURRENCY }, () => worker())
  );

  const deferred = recipients.length - cursor;
  const finalStatus =
    deferred > 0
      ? "partial"
      : failed === recipients.length
        ? "failed"
        : "completed";

  // Persist per-message wamids so Meta delivery-status callbacks can update
  // delivered/read counters on this broadcast.
  for (let i = 0; i < messageRows.length; i += 500) {
    await supabase
      .from("broadcast_messages")
      .insert(messageRows.slice(i, i + 500));
  }

  await flushProgress(finalStatus);

  return NextResponse.json({
    broadcast_id: broadcastId,
    total_recipients: recipients.length,
    skipped_opted_out: skippedOptedOut,
    sent,
    failed,
    ...(deferred > 0
      ? { deferred, note: `${deferred} recipient(s) deferred — resend to reach them` }
      : {}),
    errors: errors.length > 0 ? errors : undefined,
  });
}
