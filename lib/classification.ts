import { createServiceClient } from "@/lib/supabase/service";
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
  // Specific objections FIRST — so a message like "Not interested, price is
  // too high" captures the rejection_reason instead of matching the generic
  // "not interested" rule and losing the reason.
  {
    patterns: /too expensive|too pricey|can'?t afford|out of my budget|costs too much|too much money|price is too high|too high|too costly/i,
    classification: "not_interested",
    rejection_reason: "price",
  },
  {
    patterns: /already have (fibre|telkom|internet|wifi)|already got fibre|i have (telkom|fibre) already/i,
    classification: "already_has_service",
    rejection_reason: "already_has_service",
  },
  {
    patterns: /have (vodacom|mtn|cell c|websquad|rocketnet|octotel|openserve) fibre/i,
    classification: "already_has_service",
    rejection_reason: "competitor",
  },
  // Not interested — generic (after specific objections so reasons are captured)
  {
    patterns: /not interested|don'?t need|no thanks|not now|no longer interested|not interested/i,
    classification: "not_interested",
  },
  // Callback requested — wants to speak to a consultant (distinct from "interested/ready to proceed")
  {
    patterns: /speak to a consultant|speak to someone|have someone call|call me back|callback|please call me|i'?d like to speak|want to speak to a consultant|consultant to call/i,
    classification: "callback_requested",
  },
  {
    patterns: /^2\b/i, // numbered menu response "2 – I'd like to speak to a consultant"
    classification: "callback_requested",
  },
  // Interested — explicit purchase intent / ready to proceed.
  // "fibre" is included standalone because the telkom_reengagement template
  // asks customers to reply "FIBRE" to signal interest.
  {
    patterns: /^(yes|interested|i want fibre|fibre|let'?s do it|sign me up|i'?m in)\b/i,
    classification: "interested",
  },
  {
    patterns: /i want to apply|how do i apply|send someone|i want the package|please contact me|contact me to apply/i,
    classification: "interested",
  },
  {
    patterns: /^3\b/i, // numbered menu response "3 – I'm interested, please contact me"
    classification: "interested",
  },
  {
    patterns: /i'?ll take|i want the|r425 package|50 mbps package|25 mbps package|40 mbps package|i want that package/i,
    classification: "interested",
  },
  // Needs information — engagement, not sales-qualified
  {
    patterns: /how much|what'?s the price|what does it cost|pricing|tell me more|more info|more information|send details|what packages|what speeds|is fibre available|coverage/i,
    classification: "needs_information",
  },
  {
    patterns: /^1\b/i, // numbered menu response "1 – I'd like more information"
    classification: "needs_information",
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

const AI_PROMPT = `You are a WhatsApp response classifier for a Telkom Fibre sales campaign in South Africa.

Classify the customer's WhatsApp response into exactly one of these categories:
- interested: Customer explicitly wants to proceed, apply, or wants a specific package
- callback_requested: Customer wants to speak to a consultant or be called back (not yet ready to apply, but wants human contact)
- not_interested: Customer clearly declines or rejects the offer
- already_has_service: Customer already has fibre/internet service
- needs_information: Customer is asking a question or wants more details before deciding (engagement, not sales-qualified)
- no_response: Empty or no meaningful content
- other: Doesn't fit any category
- uncertain: Ambiguous, can't determine intent

Key distinction:
- "How much is the 50 Mbps package?" → needs_information (engagement)
- "I'd like to speak to a consultant" → callback_requested (wants human contact)
- "I want the R425 package, please contact me" → interested (sales-qualified, ready to proceed)

If the classification is "not_interested", also identify the rejection_reason (one of):
- price: Too expensive / budget concerns
- already_has_service: Already has fibre/internet
- not_needed: Doesn't need fibre
- not_now: Not interested right now but maybe later
- needs_more_info: Needs more information before deciding
- competitor: Using a competitor's service
- not_eligible: Doesn't qualify (credit, area, etc.)
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
      "already_has_service",
      "not_needed",
      "not_now",
      "needs_more_info",
      "competitor",
      "not_eligible",
      "other",
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
    await supabase.from("campaign_classifications").insert({
      interaction_id: interactionIdLocal,
      phone_number: phoneNumber,
      classification: result.classification,
      rejection_reason: result.rejection_reason ?? null,
      confidence: result.confidence,
      classified_by: "ai", // both keyword and AI classification are automated
      original_ai_classification: result.classification,
    });
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
    await supabase
      .from("campaign_enrolments")
      .update({ status: outcome.status, final_outcome: outcome.final_outcome })
      .eq("id", enrolId);
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

    // Set rejection reason if classified as not_interested or already_has_service
    if (
      result.classification === "not_interested" ||
      result.classification === "already_has_service"
    ) {
      leadUpdate.status = "lost";
      leadUpdate.rejection_reason = result.rejection_reason ?? null;
    }

    await supabase
      .from("leads")
      .update(leadUpdate)
      .eq("id", enrolment.lead_id);
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
      await supabase.from("calling_queue").insert({
        campaign_id: campaignId,
        enrolment_id: enrolId,
        phone_number: phoneNumber,
        lead_id: enrolment?.lead_id ?? null,
        full_name: leadData?.full_name ?? null,
        email: leadData?.email ?? null,
        preferred_package: leadData?.preferred_package ?? null,
        customer_request: messageText,
        campaign_source: "Fibre Lead Re-Engagement",
        campaign_stage: result.classification === "interested" ? "INTERESTED" : "CALLBACK REQUESTED",
        final_outcome: outcome?.final_outcome ?? null,
        queue_status: "pending",
      });
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
    .eq("phone_number", phoneNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return (data as CampaignClassification) ?? null;
}
