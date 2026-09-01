import { createClient } from "@/lib/supabase/server";
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
  // Not interested
  {
    patterns: /not interested|don'?t need|no thanks|not now|no longer interested|not interested/i,
    classification: "not_interested",
  },
  {
    patterns: /too expensive|too pricey|can'?t afford|out of my budget|costs too much|too much money/i,
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
  {
    patterns: /stop|unsubscribe|opt out|do not contact|don'?t contact me|remove me/i,
    classification: "not_interested",
    rejection_reason: "not_needed",
  },
  // Interested
  {
    patterns: /^(yes|interested|i want fibre|let'?s do it|sign me up|i'?m in)\b/i,
    classification: "interested",
  },
  {
    patterns: /please call me|contact me|have someone call|i want to apply|how do i apply|send someone|consultant|call me back/i,
    classification: "interested",
  },
  {
    patterns: /i'?ll take|i want the|r425 package|50 mbps package|25 mbps package|40 mbps package|i want that package/i,
    classification: "interested",
  },
  // Needs information
  {
    patterns: /how much|what'?s the price|what does it cost|pricing|tell me more|more info|more information|send details|what packages|what speeds|is fibre available|coverage/i,
    classification: "needs_information",
  },
  {
    patterns: /^(1|2|3)\b/i, // numbered menu responses from the campaign template
    classification: "needs_information",
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
- interested: Customer explicitly wants to proceed, apply, or be contacted by sales
- not_interested: Customer clearly declines or rejects the offer
- already_has_service: Customer already has fibre/internet service
- needs_information: Customer is asking a question or wants more details before deciding
- no_response: Empty or no meaningful content
- other: Doesn't fit any category
- uncertain: Ambiguous, can't determine intent

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
  const supabase = await createClient();

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
      classified_by: result.method === "keyword" ? "ai" : "ai", // both are automated
      original_ai_classification: result.classification,
    });
  }

  // 6. Update lead profile if not_interested
  if (result.classification === "not_interested" || result.classification === "already_has_service") {
    const { data: enrolment } = await supabase
      .from("campaign_enrolments")
      .select("lead_id")
      .eq("id", enrolId)
      .single();

    if (enrolment?.lead_id) {
      const noteText = `Campaign ${campaignId}: ${result.classification}${
        result.rejection_reason ? ` (${result.rejection_reason})` : ""
      }`;
      await supabase
        .from("leads")
        .update({
          notes: noteText,
          status: "lost",
          updated_at: new Date().toISOString(),
        })
        .eq("id", enrolment.lead_id);
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
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaign_classifications")
    .select("*")
    .eq("phone_number", phoneNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return (data as CampaignClassification) ?? null;
}
