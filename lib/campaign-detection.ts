import { createServiceClient } from "@/lib/supabase/service";

interface EnrolmentDetection {
  enrolment_id: string;
  campaign_id: string;
  phone_number: string;
  stop_detected: boolean;
}

const STOP_PATTERN = /^\s*(stop|unsubscribe|opt out|opt-out|do not contact me|don'?t contact me|remove me)\s*$/i;

/**
 * Check if a phone number is enrolled in an active campaign.
 * If so, mark the enrolment as 'responded' and record the inbound interaction.
 * If the message is a STOP keyword, mark the enrolment as 'opted_out' and add
 * the phone to the global opt_out_list.
 * Returns the enrolment info if found, or null otherwise.
 */
export async function detectAndMarkCampaignResponse(
  phoneNumber: string,
  messageBody: string | null
): Promise<EnrolmentDetection | null> {
  const supabase = createServiceClient();
  const phone = phoneNumber.replace(/\D/g, "");

  // Find any active or no_response_final enrolment for this phone number.
  // Including no_response_final allows late responses (after the cron grace
  // period) to still be detected, classified, and routed to the calling queue.
  const { data: enrolment } = await supabase
    .from("campaign_enrolments")
    .select("id, campaign_id, phone_number, status")
    .eq("phone_number", phone)
    .in("status", ["active", "no_response_final"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (!enrolment) return null;

  const isStop = messageBody ? STOP_PATTERN.test(messageBody.trim()) : false;

  // Record the inbound interaction (always, even for STOP)
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

  if (isStop) {
    // Mark enrolment as opted_out with final outcome label
    await supabase
      .from("campaign_enrolments")
      .update({
        status: "opted_out",
        final_outcome: "OPTED OUT",
      })
      .eq("id", enrolment.id);

    // Add to global opt_out_list (upsert — phone is unique)
    await supabase
      .from("opt_out_list")
      .upsert(
        {
          phone_number: phone,
          reason: "STOP keyword",
          source_campaign_id: enrolment.campaign_id,
        },
        { onConflict: "phone_number" }
      );

    return {
      enrolment_id: enrolment.id,
      campaign_id: enrolment.campaign_id,
      phone_number: phone,
      stop_detected: true,
    };
  }

  // Normal response — mark as 'responded' to stop further campaign messages.
  // If the enrolment was no_response_final (late response after grace period),
  // clear nurture_flag and final_outcome since the customer did respond.
  const wasNoResponseFinal = enrolment.status === "no_response_final";
  await supabase
    .from("campaign_enrolments")
    .update({
      status: "responded",
      ...(wasNoResponseFinal && { nurture_flag: false, final_outcome: null }),
    })
    .eq("id", enrolment.id);

  return {
    enrolment_id: enrolment.id,
    campaign_id: enrolment.campaign_id,
    phone_number: phone,
    stop_detected: false,
  };
}

/**
 * Check if a phone number is in the global opt-out list.
 */
export async function isOptedOut(phoneNumber: string): Promise<boolean> {
  const supabase = createServiceClient();
  const phone = phoneNumber.replace(/\D/g, "");
  const { data } = await supabase
    .from("opt_out_list")
    .select("id")
    .eq("phone_number", phone)
    .maybeSingle();
  return !!data;
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
