import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone-utils";

const META_API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID!;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN!;

const FOLLOW_UP_TEMPLATE = "horizon_followup_v6";

interface MetaSendResponse {
  messaging_product: string;
  contacts: { input: string; wa_id: string }[];
  messages: { id: string }[];
  error?: { message: string; code: number };
}

interface FollowUpLead {
  id: number;
  phone_number: string;
  full_name: string | null;
  offered_package: string | null;
  product_interest: string | null;
  follow_up_date: string | null;
}

export interface FollowUpResult {
  processed: number;
  sent: number;
  failed: number;
  errors: string[];
}

export async function sendFollowUps(leadId?: number): Promise<FollowUpResult> {
  if (!META_PHONE_NUMBER_ID || !META_ACCESS_TOKEN) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      errors: ["Meta WhatsApp env vars not configured. Set META_PHONE_NUMBER_ID and META_ACCESS_TOKEN."],
    };
  }

  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select("id, phone_number, full_name, offered_package, product_interest, follow_up_date")
    .eq("follow_up_requested", true)
    .eq("follow_up_sent", false)
    .not("status", "in", '("converted","lost")');

  if (leadId) {
    query = query.eq("id", leadId);
  } else {
    query = query.lte("follow_up_date", new Date().toISOString());
  }

  const { data: leads, error } = await query;

  if (error) {
    return { processed: 0, sent: 0, failed: 0, errors: [error.message] };
  }

  const result: FollowUpResult = { processed: 0, sent: 0, failed: 0, errors: [] };

  for (const lead of (leads ?? []) as FollowUpLead[]) {
    result.processed++;
    const phone = normalizePhone(lead.phone_number);
    const name = lead.full_name ?? "there";
    const pkg = lead.offered_package ?? lead.product_interest ?? "fibre";

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "template" as const,
      template: {
        name: FOLLOW_UP_TEMPLATE,
        language: { code: "en_US" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: name },
              { type: "text", text: pkg },
            ],
          },
        ],
      },
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
        result.failed++;
        result.errors.push(`${phone}: ${data.error?.message ?? "Unknown error"}`);
      } else {
        await supabase
          .from("leads")
          .update({
            follow_up_sent: true,
            follow_up_sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", lead.id);
        result.sent++;
      }
    } catch {
      result.failed++;
      result.errors.push(`${phone}: Network error`);
    }
  }

  return result;
}
