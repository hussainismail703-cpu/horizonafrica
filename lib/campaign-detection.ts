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
  messageBody: string | null,
  metaMessageId: string | null = null,
  contentType: string | null = null
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

  // Record the inbound interaction (always, even for STOP or empty bodies)
  const { error: interactionErr } = await supabase.from("campaign_interactions").insert({
    campaign_id: enrolment.campaign_id,
    enrol_id: enrolment.id,
    phone_number: phone,
    step_number: null,
    message_type: "inbound",
    template_name: null,
    message_body: messageBody,
    delivery_status: "delivered",
    meta_message_id: metaMessageId,
    content_type: contentType,
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

  // An empty body (e.g. a text message with no text) is not a real reply —
  // the interaction is recorded above for audit but the enrolment stays active
  // so campaign steps are not suppressed by a content-free webhook.
  if (!messageBody || !messageBody.trim()) {
    return {
      enrolment_id: enrolment.id,
      campaign_id: enrolment.campaign_id,
      phone_number: phone,
      stop_detected: false,
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

export interface InboundMessage {
  phoneNumber: string;
  messageBody: string;
  messageType: string;
  metaMessageId: string | null;
}

interface MetaWebhookMessage {
  from: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    type?: string;
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  audio?: Record<string, unknown>;
  sticker?: Record<string, unknown>;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string }; phones?: Array<{ phone?: string }> }>;
  reaction?: { emoji?: string };
}

/**
 * Extract the phone number, message text, type and Meta message id from a
 * WhatsApp webhook payload. Non-text messages produce a descriptive body so
 * detection, classification and the AI flow can see what arrived — e.g. a
 * customer pinning their address as a location becomes readable text.
 * A message with no extractable content returns an empty messageBody; callers
 * must not treat that as a real reply.
 */
export function extractInboundMessage(payload: unknown): InboundMessage | null {
  try {
    const entry = (payload as { entry?: Array<{ changes?: Array<{ value?: { messages?: MetaWebhookMessage[] } }> }> })?.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];
    if (!message || !message.from) return null;

    const phoneNumber = message.from;
    const messageType = message.type ?? "text";
    const metaMessageId = message.id ?? null;
    let messageBody = "";

    switch (messageType) {
      case "text":
        messageBody = message.text?.body ?? "";
        break;
      case "button":
        messageBody = message.button?.text ?? "[Button]";
        break;
      case "interactive":
        messageBody =
          message.interactive?.button_reply?.title ??
          message.interactive?.list_reply?.title ??
          "[Interactive reply]";
        break;
      case "image":
        messageBody = `[Image]${message.image?.caption ? ` ${message.image.caption}` : ""}`;
        break;
      case "video":
        messageBody = `[Video]${message.video?.caption ? ` ${message.video.caption}` : ""}`;
        break;
      case "document":
        messageBody = `[Document]${message.document?.caption ? ` ${message.document.caption}` : message.document?.filename ? ` ${message.document.filename}` : ""}`;
        break;
      case "audio":
        messageBody = "[Voice note]";
        break;
      case "voice":
        messageBody = "[Voice note]";
        break;
      case "sticker":
        messageBody = "[Sticker]";
        break;
      case "location": {
        const loc = message.location ?? {};
        const parts = ["[Location]"];
        if (loc.name) parts.push(loc.name);
        if (loc.address) parts.push(loc.address);
        if (loc.latitude != null && loc.longitude != null) {
          parts.push(`(${loc.latitude}, ${loc.longitude})`);
        }
        messageBody = parts.join(" ");
        break;
      }
      case "contacts": {
        const contact = message.contacts?.[0];
        const name = contact?.name?.formatted_name ?? "";
        const phone = contact?.phones?.[0]?.phone ?? "";
        messageBody = `[Contact]${name ? ` ${name}` : ""}${phone ? ` ${phone}` : ""}`;
        break;
      }
      case "reaction":
        messageBody = `[Reaction]${message.reaction?.emoji ? ` ${message.reaction.emoji}` : ""}`;
        break;
      default:
        messageBody = `[Message: ${messageType}]`;
    }

    return { phoneNumber, messageBody, messageType, metaMessageId };
  } catch {
    return null;
  }
}
