import { createServiceClient } from "@/lib/supabase/service";
import { normalizePhone } from "@/lib/phone-utils";
import { withRetry, logCampaignWriteError } from "@/lib/campaign-detection";
import {
  Classification,
  RejectionReason,
  CampaignClassification,
} from "@/lib/types";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  classification: Classification;
  rejection_reason?: RejectionReason;
  confidence: number;
  method: "keyword" | "ai" | "combined";
}

interface AiClassificationResponse {
  classification?: string;
  rejection_reason?: string;
  confidence?: number;
}

// ---------------------------------------------------------------------------
// Keyword detection (fast, free)
// ---------------------------------------------------------------------------

interface KeywordRule {
  patterns: RegExp;
  classification: Classification;
  rejection_reason?: RejectionReason;
}

const KEYWORD_RULES: KeywordRule[] = [
  // Specific objections FIRST — so a message like "Not interested, it's too
  // expensive" captures the rejection_reason instead of matching the generic
  // "not interested" rule and losing the reason.
  {
    patterns: /too expensive|too pricey|can'?t afford|out of my budget|costs too much|too much money|price is too high|too high|too costly|over my budget/i,
    classification: "not_interested",
    rejection_reason: "price",
  },
  {
    patterns: /won'?t fit|doesn'?t fit|don'?t fit|no (size|stock)|size not available|out of stock|wrong size|size (issue|problem)|doesn'?t come in my size|not in my size|don'?t have my size|not available in my size/i,
    classification: "not_interested",
    rejection_reason: "sizing_fit",
  },
  {
    patterns: /too long|takes too long|delivery (takes|time|too)|can'?t wait|6 weeks|six weeks|wait too long|shipping takes/i,
    classification: "not_interested",
    rejection_reason: "delivery_time",
  },
  {
    patterns: /not my style|don'?t like the (style|design|pattern|colour|color)|not my taste|prefer (a )?different (style|design|colour|color)|don'?t like it|ugly/i,
    classification: "not_interested",
    rejection_reason: "style_design",
  },
  {
    patterns: /already (bought|have|ordered|got|purchased)|bought (one|it|from)|got it (from|elsewhere)|ordered (one|it|from)|have one already|have (a|the|one) already|shopped at/i,
    classification: "not_interested",
    rejection_reason: "competitor",
  },
  // Not now / need to think — soft decline
  {
    patterns: /maybe later|not now|need to think|think about it|ask my (husband|wife|partner)|another time|not this month/i,
    classification: "not_interested",
    rejection_reason: "not_now",
  },
  // Not interested — generic (after specific objections so reasons are captured)
  {
    patterns: /not interested|don'?t need|no thanks|no longer interested|not for me|leave me alone|remove me/i,
    classification: "not_interested",
  },
  // Callback requested — wants to speak to a consultant at a later time
  // (distinct from "interested/ready to proceed").
  {
    patterns: /speak to a consultant|speak to someone|have someone call|call me back|callback|i'?d like to speak|want to speak to (a|someone)|consultant to call|call me please|someone (to )?call me/i,
    classification: "callback_requested",
  },
  {
    patterns: /^2\b/i, // numbered menu response "2 – I'd like to speak to a consultant"
    classification: "callback_requested",
  },
  // Needs information — engagement, not sales-qualified.
  // Checked BEFORE buy-intent rules so that a question like
  // "How much is the black abaya?" classifies as needs_information
  // (asking about price) rather than interested (mentions a garment).
  {
    patterns: /how much|what'?s the price|what does it cost|pricing|tell me more|more info|more information|send (me )?details|what sizes|what (colours|colors)|is it available|do you have|in stock|what'?s the material|what fabric|can i return|exchange|refund|how long/i,
    classification: "needs_information",
  },
  {
    patterns: /^1\b/i, // numbered menu response "1 – I'd like more information"
    classification: "needs_information",
  },
  // Interested — explicit purchase intent / ready to proceed
  {
    patterns: /^(yes|interested|let'?s do it|sign me up|i'?m in|yes please)\b/i,
    classification: "interested",
  },
  {
    patterns: /i want to (buy|order|purchase|get)|how do i (order|buy)|i'?ll take (it|the|one|this|that)|i want (the|that|this|it|one)|i want to apply|please contact me|contact me|please call me|can someone contact me|someone contact me|place an order|ready to order|proceed to (pay|checkout|order)/i,
    classification: "interested",
  },
  {
    patterns: /^3\b/i, // numbered menu response "3 – I'm interested, please contact me"
    classification: "interested",
  },
  // Not interested — numbered menu response "4"
  {
    patterns: /^4\b/i, // numbered menu response "4 – I'm not interested"
    classification: "not_interested",
  },
];

function keywordClassify(text: string): ClassificationResult | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.test(trimmed)) {
      return {
        classification: rule.classification,
        rejection_reason: rule.rejection_reason,
        confidence: 0.85,
        method: "keyword",
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// AI classification (OpenRouter)
// ---------------------------------------------------------------------------

const AI_PROMPT = `You are a WhatsApp response classifier for an Eastern Wear by Kersh clothing sales campaign in South Africa. Eastern Wear sells women's eastern clothing (abayas, dresses, modest wear, scarves) via WhatsApp.

Classify the customer's WhatsApp response into exactly one of these categories:
- interested: Customer explicitly wants to buy, order, or get a specific garment
- callback_requested: Customer wants to speak to a consultant or be called back (not yet ready to buy, but wants human contact)
- not_interested: Customer clearly declines or rejects the offer
- already_has_service: Customer already owns the item or bought it elsewhere
- needs_information: Customer is asking a question or wants more details before deciding (engagement, not sales-qualified)
- no_response: Empty or no meaningful content
- other: Doesn't fit any category
- uncertain: Ambiguous, can't determine intent

Key distinction:
- "How much is the black abaya?" → needs_information (engagement)
- "I'd like to speak to a consultant" → callback_requested (wants human contact)
- "I want the dress in size 34, please contact me" → interested (sales-qualified, ready to buy)

If the classification is "not_interested" or "already_has_service", also identify the rejection_reason (one of):
- price: Too expensive / budget concerns
- sizing_fit: Size/fit concerns — won't fit, size not available, out of stock in their size
- delivery_time: Delivery takes too long / can't wait the lead time
- style_design: Doesn't like the style, design, colour or pattern
- competitor: Already bought it elsewhere / bought from a competitor
- not_now: Not interested right now but maybe later (need to think, ask spouse)
- needs_more_info: Needs more information before deciding
- not_needed: Doesn't need the item
- other: Other reason

Return ONLY valid JSON in this exact format:
{"classification":"interested","rejection_reason":null,"confidence":0.9}

Do not include any other text, markdown, or explanation.`;

async function aiClassify(text: string): Promise<ClassificationResult | null> {
  if (!OPENROUTER_API_KEY) return null;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: AI_PROMPT },
          { role: "user", content: `Classify this WhatsApp response: "${text}"` },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed: AiClassificationResponse = JSON.parse(content);

    const validClassifications: Classification[] = [
      "interested",
      "not_interested",
      "already_has_service",
      "needs_information",
      "no_response",
      "other",
      "uncertain",
      "callback_requested",
    ];

    if (!parsed.classification || !validClassifications.includes(parsed.classification as Classification)) {
      return null;
    }

    const validReasons: RejectionReason[] = [
      "price",
      "sizing_fit",
      "delivery_time",
      "style_design",
      "competitor",
      "not_now",
      "needs_more_info",
      "not_needed",
      "other",
      "already_has_service",
      "not_eligible",
    ];

    const rejection_reason =
      parsed.rejection_reason && validReasons.includes(parsed.rejection_reason as RejectionReason)
        ? (parsed.rejection_reason as RejectionReason)
        : undefined;

    return {
      classification: parsed.classification as Classification,
      rejection_reason,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.6,
      method: "ai",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a WhatsApp response using keyword detection first, then AI fallback.
 * Stores the result in campaign_classifications and returns it.
 */
export async function classifyResponse(
  messageText: string,
  campaignId: string,
  enrolId: string,
  phoneNumber: string,
  interactionId?: string
): Promise<ClassificationResult> {
  // 1. Try keyword detection first
  let result = keywordClassify(messageText);

  // 2. If inconclusive, try AI
  if (!result) {
    const aiResult = await aiClassify(messageText);
    if (aiResult) {
      result = aiResult;
    } else {
      // 3. If both fail, mark as uncertain
      result = {
        classification: "uncertain",
        confidence: 0.0,
        method: "keyword",
      };
    }
  }

  // 4. If uncertain and confidence < 0.5, flag for human review
  if (result.classification === "uncertain" || (result.confidence < 0.5 && result.method === "ai")) {
    result = {
      ...result,
      classification: "uncertain",
    };
  }

  // 5. Store in campaign_classifications
  const supabase = createServiceClient();

  // We need an interaction_id. If not provided, we need to find or create one.
  let interactionIdLocal = interactionId;
  if (!interactionIdLocal) {
    // Find the most recent inbound interaction for this enrolment
    const { data: interaction } = await supabase
      .from("campaign_interactions")
      .select("id")
      .eq("enrol_id", enrolId)
      .eq("message_type", "inbound")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .single();

    interactionIdLocal = interaction?.id;
  }

  if (interactionIdLocal) {
    const { error: insertErr } = await withRetry(() =>
      supabase.from("campaign_classifications").insert({
        interaction_id: interactionIdLocal!,
        phone_number: normalizePhone(phoneNumber),
        classification: result.classification,
        rejection_reason: result.rejection_reason ?? null,
        confidence: result.confidence,
        classified_by: "ai", // both keyword and AI classification are automated
        original_ai_classification: result.classification,
      })
    );
    if (insertErr) {
      await logCampaignWriteError(
        campaignId, enrolId, phoneNumber,
        "classification_insert_failed", insertErr.message
      );
    }
  }

  // 6. Update enrolment status based on classification + insert into calling queue
  const enrolmentStatusMap: Record<string, { status: string; final_outcome: string }> = {
    interested: { status: "interested", final_outcome: "INTERESTED – CALLING QUEUE" },
    callback_requested: { status: "callback_requested", final_outcome: "CALLBACK REQUESTED – CALLING QUEUE" },
    not_interested: { status: "not_interested", final_outcome: "NOT INTERESTED" },
    already_has_service: { status: "not_interested", final_outcome: "NOT INTERESTED" },
  };

  const outcome = enrolmentStatusMap[result.classification];
  if (outcome) {
    const { error: enrolErr } = await withRetry(() =>
      supabase
        .from("campaign_enrolments")
        .update({ status: outcome.status, final_outcome: outcome.final_outcome })
        .eq("id", enrolId)
    );
    if (enrolErr) {
      await logCampaignWriteError(
        campaignId, enrolId, phoneNumber,
        "enrolment_status_update_failed", enrolErr.message
      );
    }
  }

  // 7. Update lead profile with campaign context
  const { data: enrolment } = await supabase
    .from("campaign_enrolments")
    .select("lead_id")
    .eq("id", enrolId)
    .single();

  if (enrolment?.lead_id) {
    // Fetch existing notes so we can append (not overwrite)
    const { data: existingLead } = await supabase
      .from("leads")
      .select("notes")
      .eq("id", enrolment.lead_id)
      .single();

    const noteText = `Campaign ${campaignId}: ${result.classification}${
      result.rejection_reason ? ` (${result.rejection_reason})` : ""
    }`;
    const updatedNotes = existingLead?.notes
      ? `${existingLead.notes}\n${noteText}`
      : noteText;

    const leadUpdate: Record<string, unknown> = {
      notes: updatedNotes,
      last_campaign_response: messageText,
      updated_at: new Date().toISOString(),
    };

    if (
      result.classification === "not_interested" ||
      result.classification === "already_has_service"
    ) {
      // Rejection — mark lead as lost with rejection reason
      leadUpdate.status = "lost";
      leadUpdate.rejection_reason = result.rejection_reason ?? null;
    } else if (
      result.classification === "interested" ||
      result.classification === "callback_requested"
    ) {
      // Sales-qualified — clear any stale rejection reason from a previous
      // rejection and advance the lead status so it reflects renewed interest
      leadUpdate.rejection_reason = null;
      leadUpdate.status = "qualified";
    }

    const { error: leadErr } = await withRetry(() =>
      supabase
        .from("leads")
        .update(leadUpdate)
        .eq("id", enrolment.lead_id!)
    );
    if (leadErr) {
      await logCampaignWriteError(
        campaignId, enrolId, phoneNumber,
        "lead_update_failed", leadErr.message
      );
    }
  }

  // 8. Insert into calling_queue for sales-qualified leads
  if (result.classification === "interested" || result.classification === "callback_requested") {
    // Fetch lead profile to populate queue entry
    let leadData: { full_name: string | null; email: string | null; preferred_package: string | null } | null = null;
    if (enrolment?.lead_id) {
      const { data: lead } = await supabase
        .from("leads")
        .select("full_name, email, preferred_package")
        .eq("id", enrolment.lead_id)
        .single();
      leadData = lead;
    }

    // Avoid duplicate queue entries for the same enrolment
    const { data: existingQueue } = await supabase
      .from("calling_queue")
      .select("id")
      .eq("enrolment_id", enrolId)
      .neq("queue_status", "converted")
      .neq("queue_status", "lost")
      .maybeSingle();

    if (!existingQueue) {
      const { data: campaign } = await supabase
        .from("campaigns")
        .select("name")
        .eq("id", campaignId)
        .single();

      const { error: queueErr } = await withRetry(() =>
        supabase.from("calling_queue").insert({
          campaign_id: campaignId,
          enrolment_id: enrolId,
          phone_number: normalizePhone(phoneNumber),
          lead_id: enrolment?.lead_id ?? null,
          full_name: leadData?.full_name ?? null,
          email: leadData?.email ?? null,
          preferred_package: leadData?.preferred_package ?? null,
          customer_request: messageText,
          campaign_source: campaign?.name ?? null,
          campaign_stage: result.classification === "interested" ? "INTERESTED" : "CALLBACK REQUESTED",
          final_outcome: outcome?.final_outcome ?? null,
          queue_status: "pending",
        })
      );
      if (queueErr) {
        await logCampaignWriteError(
          campaignId, enrolId, phoneNumber,
          "calling_queue_insert_failed", queueErr.message
        );
      }
    }
  }

  return result;
}

/**
 * Get the latest classification for a phone number in a campaign.
 */
export async function getLatestClassification(
  phoneNumber: string,
  campaignId: string
): Promise<CampaignClassification | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("campaign_classifications")
    .select("*")
    .eq("phone_number", normalizePhone(phoneNumber))
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return (data as CampaignClassification) ?? null;
}
