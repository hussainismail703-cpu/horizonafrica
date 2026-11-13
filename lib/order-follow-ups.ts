import { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizePhone } from "@/lib/phone-utils";
import type { FollowUpResult } from "@/lib/follow-ups";
import type { Order, OrderFollowUp } from "@/lib/types";

const META_API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID!;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN!;

/**
 * Nudge cadence for unpaid orders, in hours since order creation.
 * FOLLOWUP_HOURS="4,24,72" → 3 nudges at +4h, +24h, +72h.
 */
export function followUpHours(): number[] {
  const raw = process.env.FOLLOWUP_HOURS ?? "4,24,72";
  const hours = raw
    .split(",")
    .map((h) => Number(h.trim()))
    .filter((h) => Number.isFinite(h) && h > 0);
  return hours.length ? hours : [4, 24, 72];
}

/**
 * Template per nudge step. The approved Eastern Wear sequence is used unless
 * ORDER_FOLLOWUP_TEMPLATES explicitly overrides it.
 */
const DEFAULT_ORDER_FOLLOWUP_TEMPLATES = [
  "ew_payment_reminder_1",
  "ew_payment_reminder_2",
  "ew_payment_reminder_3",
];

export function followUpTemplates(): string[] {
  const raw =
    process.env.ORDER_FOLLOWUP_TEMPLATES ?? DEFAULT_ORDER_FOLLOWUP_TEMPLATES.join(",");
  const names = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return names.length ? names : DEFAULT_ORDER_FOLLOWUP_TEMPLATES;
}

function templateForStep(step: number): string {
  const templates = followUpTemplates();
  return templates[Math.min(step, templates.length) - 1];
}

interface MetaSendResponse {
  messaging_product: string;
  contacts: { input: string; wa_id: string }[];
  messages: { id: string }[];
  error?: { message: string; code: number };
}

function orderItemSummary(order: Order): string {
  const names = (order.items ?? [])
    .map((i) => (i.qty && i.qty > 1 ? `${i.qty}× ${i.product_title}` : i.product_title))
    .filter(Boolean);
  return names.join(", ") || "your order";
}

/** Queue the first nudge for a pending_payment order. Idempotent. */
export async function scheduleOrderFollowUps(
  supabase: SupabaseClient,
  order: Order
): Promise<void> {
  if (order.status !== "pending_payment") return;

  const hours = followUpHours();
  const base = new Date(order.created_at).getTime();
  const scheduledFor = new Date(base + hours[0] * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.from("follow_ups").upsert(
    {
      order_id: order.id,
      lead_id: order.lead_id ?? null,
      phone_number: normalizePhone(order.phone_number),
      sequence_step: 1,
      template_name: templateForStep(1),
      scheduled_for: scheduledFor,
      status: "pending",
    },
    { onConflict: "order_id,sequence_step", ignoreDuplicates: true }
  );

  if (error) {
    console.error(`[order-followups] schedule failed for order ${order.id}:`, error.message);
  }
}

/** Cancel all pending nudges for an order (paid/cancelled/expired/opt-out). */
export async function cancelOrderFollowUps(
  supabase: SupabaseClient,
  orderId: string
): Promise<void> {
  await supabase
    .from("follow_ups")
    .update({ status: "cancelled" })
    .eq("order_id", orderId)
    .eq("status", "pending");
}

async function isOptedOut(
  supabase: SupabaseClient,
  phone: string
): Promise<boolean> {
  const { data } = await supabase
    .from("opt_out_list")
    .select("phone_number")
    .eq("phone_number", phone)
    .maybeSingle();
  return Boolean(data);
}

async function isDeclined(
  supabase: SupabaseClient,
  leadId: number | null
): Promise<boolean> {
  if (!leadId) return false;
  const { data } = await supabase
    .from("leads")
    .select("status")
    .eq("id", leadId)
    .maybeSingle();
  return data?.status === "lost";
}

async function sendNudge(
  phone: string,
  name: string,
  summary: string,
  templateName: string
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${META_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${META_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone,
          type: "template",
          template: {
            name: templateName,
            language: { code: "en_US" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: name },
                  { type: "text", text: summary },
                ],
              },
            ],
          },
        }),
      }
    );
    const data: MetaSendResponse = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: data.error?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

/**
 * Process due order follow-ups: send the next nudge, then either schedule
 * the following step (relative to the order's creation time) or stop when
 * the sequence is exhausted / the order resolved / the customer opted out.
 */
export async function sendOrderFollowUps(): Promise<FollowUpResult> {
  const result: FollowUpResult = { processed: 0, sent: 0, failed: 0, errors: [] };

  if (!META_PHONE_NUMBER_ID || !META_ACCESS_TOKEN) {
    return { ...result, errors: ["Meta WhatsApp env vars not configured."] };
  }

  const supabase = createServiceClient();
  const { data: due, error } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(200);

  if (error) {
    return { ...result, errors: [error.message] };
  }

  const hours = followUpHours();
  const followUps = (due ?? []) as OrderFollowUp[];

  for (const nudge of followUps) {
    result.processed++;

    // Claim the row so a concurrent cron invocation can't double-send.
    const { data: claimed } = await supabase
      .from("follow_ups")
      .update({ status: "sending" })
      .eq("id", nudge.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const finish = async (status: "sent" | "failed" | "cancelled", extra: Record<string, unknown> = {}) =>
      supabase.from("follow_ups").update({ status, ...extra }).eq("id", nudge.id);

    // Stop condition 1: order no longer awaiting payment.
    const { data: order } = nudge.order_id
      ? await supabase
          .from("orders")
          .select("*")
          .eq("id", nudge.order_id)
          .maybeSingle()
      : { data: null };

    if (!order || order.status !== "pending_payment") {
      await finish("cancelled");
      continue;
    }

    // Stop condition 2: global opt-out (STOP) or declined lead.
    const phone = normalizePhone(nudge.phone_number);
    if ((await isOptedOut(supabase, phone)) || (await isDeclined(supabase, nudge.lead_id))) {
      await finish("cancelled");
      continue;
    }

    const sent = await sendNudge(
      phone,
      order.customer_name ?? "there",
      orderItemSummary(order as Order),
      nudge.template_name
    );

    if (!sent.ok) {
      await finish("failed", { error: sent.error });
      result.failed++;
      result.errors.push(`${phone}: ${sent.error}`);
      continue;
    }

    await finish("sent", {
      sent_at: new Date().toISOString(),
      meta_message_id: sent.messageId ?? null,
    });
    result.sent++;

    // Schedule the next nudge, timed from order creation (FOLLOWUP_HOURS).
    const nextStep = nudge.sequence_step + 1;
    if (nextStep <= hours.length) {
      const base = new Date((order as Order).created_at).getTime();
      const scheduledFor = new Date(
        base + hours[nextStep - 1] * 60 * 60 * 1000
      ).toISOString();
      await supabase.from("follow_ups").upsert(
        {
          order_id: nudge.order_id,
          lead_id: nudge.lead_id,
          phone_number: phone,
          sequence_step: nextStep,
          template_name: templateForStep(nextStep),
          scheduled_for: scheduledFor,
          status: "pending",
        },
        { onConflict: "order_id,sequence_step", ignoreDuplicates: true }
      );
    }
  }

  return result;
}
