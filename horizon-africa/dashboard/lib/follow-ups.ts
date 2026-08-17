import { createClient } from "@/lib/supabase/server";

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

function computeExpiryDate(followUpDate: string | null): string {
  const base = followUpDate ? new Date(followUpDate) : new Date();
  const expiry = new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `end of ${months[expiry.getMonth()]}`;
}

export async function sendFollowUps(): Promise<FollowUpResult> {
  if (!META_PHONE_NUMBER_ID || !META_ACCESS_TOKEN) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      errors: ["Meta WhatsApp env vars not configured. Set META_PHONE_NUMBER_ID and META_ACCESS_TOKEN."],
    };
  }

  const supabase = await createClient();

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, phone_number, full_name, offered_package, product_interest, follow_up_date")
    .eq("follow_up_requested", true)
    .eq("follow_up_sent", false)
    .lte("follow_up_date", new Date().toISOString())
    .not("status", "in", '("converted","lost")');

  if (error) {
    return { processed: 0, sent: 0, failed: 0, errors: [error.message] };
  }

  const result: FollowUpResult = { processed: 0, sent: 0, failed: 0, errors: [] };

  for (const lead of (leads ?? []) as FollowUpLead[]) {
    result.processed++;
    const phone = lead.phone_number.replace(/\D/g, "");
    const name = lead.full_name ?? "there";
    const pkg = lead.offered_package ?? lead.product_interest ?? "fibre";
    const expiry = computeExpiryDate(lead.follow_up_date);

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
            type: "header",
            parameters: [
              { type: "text", text: name },
              { type: "text", text: pkg },
            ],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: expiry },
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
