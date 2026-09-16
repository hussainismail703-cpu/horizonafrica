import { createServiceClient } from "@/lib/supabase/service";
import { normalizePhone } from "@/lib/phone-utils";
import { logCampaignError } from "@/lib/campaign-engine";

interface EnrolmentDetection {
  enrolment_id: string;
  campaign_id: string;
  phone_number: string;
  stop_detected: boolean;
}

const STOP_PATTERN = /^\s*(stop|unsubscribe|opt out|opt-out|do not contact me|don'?t contact me|remove me)\s*$/i;

/**
 * Run a supabase-js query, retrying once on failure. supabase-js resolves with
 * { error } instead of throwing — including on network-level fetch failures —
 * so callers MUST inspect the error or a failed write is silently dropped.
 */
export async function withRetry<T>(
  fn: () => PromiseLike<{ error: { message: string } | null } & T>
): Promise<{ error: { message: string } | null } & T> {
  let result = await fn();
  if (result.error) {
    await new Promise((r) => setTimeout(r, 500));
    result = await fn();
  }
  return result;
}

export async function logCampaignWriteError(
  campaignId: string | null,
  enrolId: string | null,
  phone: string,
  errorType: string,
  message: string
) {
  console.error(`[campaign-write] ${errorType}: ${message}`);
  try {
    if (campaignId) {
      await logCampaignError({
        campaignId,
        enrolId,
        phoneNumber: phone,
        errorType,
        errorMessage: message,
      });
    }
  } catch {
    // Error logging must never break detection
  }
}

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
  const phone = normalizePhone(phoneNumber);

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
  const { error: interactionErr } = await supabase.from("campaign_interactions").insert({
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
  if (interactionErr) {
    await logCampaignWriteError(
      enrolment.campaign_id,
      enrolment.id,
      phone,
      "interaction_insert_failed",
      interactionErr.message
    );
  }

  if (isStop) {
    // Mark ALL active/no_response_final enrolments for this phone as opted_out,
    // not just the detected one. The customer requested to stop all marketing
    // communication, so every active campaign enrolment should be closed.
    // This write is retried because a silently-dropped opt-out update leaves
    // the enrolment 'active' while the phone is on the global opt-out list.
    const { error: optOutErr } = await withRetry(() =>
      supabase
        .from("campaign_enrolments")
        .update({
          status: "opted_out",
          final_outcome: "OPTED OUT",
        })
        .eq("phone_number", phone)
        .in("status", ["active", "no_response_final"])
    );
    if (optOutErr) {
      await logCampaignWriteError(
        enrolment.campaign_id,
        enrolment.id,
        phone,
        "opt_out_update_failed",
        optOutErr.message
      );
    }

    // Add to global opt_out_list (upsert — phone is unique)
    const { error: optOutListErr } = await withRetry(() =>
      supabase
        .from("opt_out_list")
        .upsert(
          {
            phone_number: phone,
            reason: "STOP keyword",
            source_campaign_id: enrolment.campaign_id,
          },
          { onConflict: "phone_number" }
        )
    );
    if (optOutListErr) {
      await logCampaignWriteError(
        enrolment.campaign_id,
        enrolment.id,
        phone,
        "opt_out_upsert_failed",
        optOutListErr.message
      );
    }

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
  const { error: respondedErr } = await withRetry(() =>
    supabase
      .from("campaign_enrolments")
      .update({
        status: "responded",
        ...(wasNoResponseFinal && { nurture_flag: false, final_outcome: null }),
      })
      .eq("id", enrolment.id)
  );
  if (respondedErr) {
    await logCampaignWriteError(
      enrolment.campaign_id,
      enrolment.id,
      phone,
      "responded_update_failed",
      respondedErr.message
    );
  }

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
  const phone = normalizePhone(phoneNumber);
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
