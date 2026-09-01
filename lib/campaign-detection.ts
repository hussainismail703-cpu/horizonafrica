import { createClient } from "@/lib/supabase/server";

interface EnrolmentDetection {
  enrolment_id: string;
  campaign_id: string;
  phone_number: string;
}

/**
 * Check if a phone number is enrolled in an active campaign.
 * If so, mark the enrolment as 'responded' and record the inbound interaction.
 * Returns the enrolment info if found, or null otherwise.
 */
export async function detectAndMarkCampaignResponse(
  phoneNumber: string,
  messageBody: string | null
): Promise<EnrolmentDetection | null> {
  const supabase = await createClient();
  const phone = phoneNumber.replace(/\D/g, "");

  // Find any active enrolment for this phone number
  const { data: enrolment } = await supabase
    .from("campaign_enrolments")
    .select("id, campaign_id, phone_number")
    .eq("phone_number", phone)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (!enrolment) return null;

  // Mark the enrolment as 'responded' — this stops further campaign messages
  await supabase
    .from("campaign_enrolments")
    .update({ status: "responded" })
    .eq("id", enrolment.id);

  // Record the inbound interaction
  await supabase.from("campaign_interactions").insert({
    campaign_id: enrolment.campaign_id,
    enrol_id: enrolment.id,
    phone_number: phone,
    step_number: null,
    message_type: "inbound",
    template_name: null,
    message_body: messageBody,
    delivery_status: "delivered",
    meta_message_id: null,
  });

  return {
    enrolment_id: enrolment.id,
    campaign_id: enrolment.campaign_id,
    phone_number: phone,
  };
}

/**
 * Extract the phone number and message text from a Meta WhatsApp webhook payload.
 */
export function extractInboundMessage(
  payload: unknown
): { phoneNumber: string; messageBody: string } | null {
  try {
    const entry = (payload as { entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ from: string; text?: { body: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }> } }> }> })?.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];
    if (!message || !message.from) return null;

    const phoneNumber = message.from;
    let messageBody = message.text?.body ?? "";

    // Handle button replies
    if (!messageBody && message.button?.text) {
      messageBody = message.button.text;
    }
    // Handle interactive replies
    if (!messageBody && message.interactive?.button_reply?.title) {
      messageBody = message.interactive.button_reply.title;
    }
    if (!messageBody && message.interactive?.list_reply?.title) {
      messageBody = message.interactive.list_reply.title;
    }

    return { phoneNumber, messageBody };
  } catch {
    return null;
  }
}
