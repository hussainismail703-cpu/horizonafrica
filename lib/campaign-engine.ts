import { createClient } from "@/lib/supabase/server";

const META_API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID!;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN!;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CampaignProcessingResult {
  campaigns_processed: number;
  messages_sent: number;
  messages_failed: number;
  enrolments_advanced: number;
  errors: string[];
}

export interface SendResult {
  success: boolean;
  metaMessageId?: string;
  error?: string;
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  end_date: string | null;
}

interface StepRow {
  id: string;
  campaign_id: string;
  step_number: number;
  delay_days: number;
  template_name: string;
}

interface EnrolmentRow {
  id: string;
  campaign_id: string;
  phone_number: string;
  current_step: number;
  status: string;
  enrolled_at: string;
}

interface MetaSendResponse {
  messaging_product: string;
  messages?: { id: string }[];
  error?: { message: string; code: number };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process all active campaigns. Main entry point for the cron job.
 */
export async function processCampaigns(): Promise<CampaignProcessingResult> {
  const supabase = await createClient();
  const result: CampaignProcessingResult = {
    campaigns_processed: 0,
    messages_sent: 0,
    messages_failed: 0,
    enrolments_advanced: 0,
    errors: [],
  };

  // 1. Mark campaigns past their end_date as completed
  const now = new Date().toISOString();
  const { error: completeErr } = await supabase
    .from("campaigns")
    .update({ status: "completed" })
    .eq("status", "active")
    .not("end_date", "is", null)
    .lt("end_date", now);

  if (completeErr) {
    result.errors.push(`Failed to complete expired campaigns: ${completeErr.message}`);
  }

  // 2. Fetch all active campaigns
  const { data: campaigns, error: campErr } = await supabase
    .from("campaigns")
    .select("id, name, status, end_date")
    .eq("status", "active");

  if (campErr) {
    result.errors.push(`Failed to fetch campaigns: ${campErr.message}`);
    return result;
  }

  for (const campaign of (campaigns ?? []) as CampaignRow[]) {
    result.campaigns_processed++;
    try {
      const sub = await processCampaign(campaign.id);
      result.messages_sent += sub.messages_sent;
      result.messages_failed += sub.messages_failed;
      result.enrolments_advanced += sub.enrolments_advanced;
      result.errors.push(...sub.errors);
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : String(err);
      result.errors.push(
        `Campaign ${campaign.id} (${campaign.name}) threw: ${errMsg}`
      );
      await logCampaignError({
        campaignId: campaign.id,
        errorType: "campaign_processing_exception",
        errorMessage: errMsg,
      });
    }
  }

  return result;
}

/**
 * Process a single active campaign: find due enrolments and send their next step.
 */
export async function processCampaign(
  campaignId: string
): Promise<CampaignProcessingResult> {
  const supabase = await createClient();
  const result: CampaignProcessingResult = {
    campaigns_processed: 1,
    messages_sent: 0,
    messages_failed: 0,
    enrolments_advanced: 0,
    errors: [],
  };

  // Load steps ordered by step_number
  const { data: steps, error: stepsErr } = await supabase
    .from("campaign_steps")
    .select("id, campaign_id, step_number, delay_days, template_name")
    .eq("campaign_id", campaignId)
    .order("step_number", { ascending: true });

  if (stepsErr) {
    result.errors.push(`Failed to load steps: ${stepsErr.message}`);
    await logCampaignError({
      campaignId,
      errorType: "load_steps_failed",
      errorMessage: stepsErr.message,
    });
    return result;
  }

  const stepList = (steps ?? []) as StepRow[];
  if (stepList.length === 0) {
    return result; // no steps configured
  }

  // Load active enrolments
  const { data: enrolments, error: enrolErr } = await supabase
    .from("campaign_enrolments")
    .select("id, campaign_id, phone_number, current_step, status, enrolled_at")
    .eq("campaign_id", campaignId)
    .eq("status", "active");

  if (enrolErr) {
    result.errors.push(`Failed to load enrolments: ${enrolErr.message}`);
    await logCampaignError({
      campaignId,
      errorType: "load_enrolments_failed",
      errorMessage: enrolErr.message,
    });
    return result;
  }

  const now = new Date();

  for (const enrol of (enrolments ?? []) as EnrolmentRow[]) {
    // current_step is 0-indexed: 0 means "about to send step 1"
    const stepIndex = enrol.current_step;
    if (stepIndex >= stepList.length) {
      // Already past the last step — mark completed
      await advanceEnrolment(enrol.id, stepList.length);
      result.enrolments_advanced++;
      continue;
    }

    const step = stepList[stepIndex];

    // Check delay: the step should fire `delay_days` after either the
    // enrolment date (for step 0) or after the previous step was sent.
    // We approximate by using enrolled_at + cumulative delay.
    const enrolledAt = new Date(enrol.enrolled_at);
    let cumulativeDelayDays = 0;
    for (let i = 0; i <= stepIndex; i++) {
      cumulativeDelayDays += stepList[i].delay_days;
    }
    const fireAt = new Date(enrolledAt.getTime() + cumulativeDelayDays * 24 * 60 * 60 * 1000);

    if (now < fireAt) {
      continue; // not due yet
    }

    // Duplicate-prevention: skip if we already have an outbound interaction
    // for this enrolment + step_number
    const { data: existing } = await supabase
      .from("campaign_interactions")
      .select("id")
      .eq("enrol_id", enrol.id)
      .eq("step_number", step.step_number)
      .eq("message_type", "outbound")
      .limit(1);

    if (existing && existing.length > 0) {
      continue; // already sent this step
    }

    // Send the message
    const sendRes = await sendCampaignMessage(
      enrol.phone_number,
      step.template_name,
      campaignId,
      enrol.id,
      step.step_number
    );

    if (sendRes.success) {
      result.messages_sent++;
      // Advance enrolment to next step (or mark completed)
      await advanceEnrolment(enrol.id, stepList.length);
      result.enrolments_advanced++;
    } else {
      result.messages_failed++;
      result.errors.push(
        `${enrol.phone_number} step ${step.step_number}: ${sendRes.error ?? "unknown error"}`
      );
    }
  }

  return result;
}

/**
 * Send a single WhatsApp template message to a phone number and record the interaction.
 */
export async function sendCampaignMessage(
  phoneNumber: string,
  templateName: string,
  campaignId: string,
  enrolId: string,
  stepNumber: number
): Promise<SendResult> {
  const supabase = await createClient();

  if (!META_PHONE_NUMBER_ID || !META_ACCESS_TOKEN) {
    return {
      success: false,
      error: "META_PHONE_NUMBER_ID and META_ACCESS_TOKEN must be configured",
    };
  }

  const phone = phoneNumber.replace(/\D/g, "");
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "template" as const,
    template: {
      name: templateName,
      language: { code: "en_US" },
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

    if (!res.ok || data.error || !data.messages?.[0]?.id) {
      const errMsg = data.error?.message ?? `Meta API returned ${res.status}`;
      // Record failed interaction
      await recordInteraction({
        campaignId,
        enrolId,
        phoneNumber: phone,
        stepNumber,
        messageType: "outbound",
        templateName,
        deliveryStatus: "failed",
        metaMessageId: null,
        metaError: errMsg,
      });
      await logCampaignError({
        campaignId,
        enrolId,
        phoneNumber: phone,
        errorType: "send_failed",
        errorMessage: errMsg,
        context: { template: templateName, step: stepNumber, status: res.status },
      });
      return { success: false, error: errMsg };
    }

    const metaMessageId = data.messages[0].id;
    await recordInteraction({
      campaignId,
      enrolId,
      phoneNumber: phone,
      stepNumber,
      messageType: "outbound",
      templateName,
      deliveryStatus: "sent",
      metaMessageId,
    });

    return { success: true, metaMessageId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Network error";
    await recordInteraction({
      campaignId,
      enrolId,
      phoneNumber: phone,
      stepNumber,
      messageType: "outbound",
      templateName,
      deliveryStatus: "failed",
      metaMessageId: null,
      metaError: errMsg,
    });
    await logCampaignError({
      campaignId,
      enrolId,
      phoneNumber: phone,
      errorType: "send_exception",
      errorMessage: errMsg,
      context: { template: templateName, step: stepNumber },
    });
    return {
      success: false,
      error: errMsg,
    };
  }
}

/**
 * Record an interaction row in campaign_interactions.
 */
export async function recordInteraction(args: {
  campaignId: string;
  enrolId: string;
  phoneNumber: string;
  stepNumber: number;
  messageType: "outbound" | "inbound";
  templateName?: string | null;
  messageBody?: string | null;
  deliveryStatus: "pending" | "sent" | "delivered" | "read" | "failed";
  metaMessageId?: string | null;
  metaError?: string | null;
}): Promise<void> {
  const supabase = await createClient();
  await supabase.from("campaign_interactions").insert({
    campaign_id: args.campaignId,
    enrol_id: args.enrolId,
    phone_number: args.phoneNumber,
    step_number: args.stepNumber,
    message_type: args.messageType,
    template_name: args.templateName ?? null,
    message_body: args.messageBody ?? null,
    delivery_status: args.deliveryStatus,
    meta_message_id: args.metaMessageId ?? null,
    meta_error: args.metaError ?? null,
  });
}

/**
 * Log a structured error to the campaign_errors table.
 */
export async function logCampaignError(args: {
  campaignId: string;
  enrolId?: string | null;
  phoneNumber?: string | null;
  errorType: string;
  errorMessage?: string | null;
  context?: Record<string, unknown> | null;
}): Promise<void> {
  const supabase = await createClient();
  await supabase.from("campaign_errors").insert({
    campaign_id: args.campaignId,
    enrol_id: args.enrolId ?? null,
    phone_number: args.phoneNumber ?? null,
    error_type: args.errorType,
    error_message: args.errorMessage ?? null,
    context: args.context ?? {},
  });
}

/**
 * Advance the enrolment to the next step, or mark completed if past the last step.
 */
export async function advanceEnrolment(
  enrolId: string,
  totalSteps: number
): Promise<void> {
  const supabase = await createClient();
  const { data: enrol } = await supabase
    .from("campaign_enrolments")
    .select("current_step")
    .eq("id", enrolId)
    .single();

  if (!enrol) return;

  const nextStep = enrol.current_step + 1;
  if (nextStep >= totalSteps) {
    await supabase
      .from("campaign_enrolments")
      .update({ current_step: nextStep, status: "completed" })
      .eq("id", enrolId);
  } else {
    await supabase
      .from("campaign_enrolments")
      .update({ current_step: nextStep })
      .eq("id", enrolId);
  }
}
