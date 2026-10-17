import { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizePhone } from "@/lib/phone-utils";

/**
 * Human-handover pause (scope freeze §4.6): while `leads.human_takeover` is
 * true, Layla must not reply. The flag is set by the Chatwoot handover flow
 * (via n8n calling /api/handover) or the "Take over" button on the
 * conversations page, and cleared the same way.
 */

/** All the digit formats this phone might be stored under on leads. */
function phoneVariants(phone: string): string[] {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  const variants = new Set<string>([normalized, `+${normalized}`]);
  if (normalized.startsWith("27")) variants.add(`0${normalized.slice(2)}`);
  return [...variants];
}

/** True when a human agent currently owns this phone's conversation. */
export async function isHumanTakeover(
  phone: string,
  supabase?: SupabaseClient
): Promise<boolean> {
  const variants = phoneVariants(phone);
  if (!variants.length) return false;
  const client = supabase ?? createServiceClient();
  try {
    const { data } = await client
      .from("leads")
      .select("id")
      .in("phone_number", variants)
      .eq("human_takeover", true)
      .limit(1)
      .maybeSingle();
    return !!data;
  } catch {
    // Fail closed-safe: when the lookup fails we do not know whether a human
    // is in control. Returning false keeps Layla replying — the alternative
    // (silence) would drop customer messages entirely.
    return false;
  }
}

export interface TakeoverResult {
  ok: boolean;
  matched: number;
  error?: string;
}

/**
 * Set or clear the takeover flag on every lead row matching the phone
 * (normalised + stored variants, so legacy duplicates stay consistent).
 * When taking over and no lead exists yet, a minimal lead row is created so
 * the flag still lands — inbound messages usually arrive before CRM rows.
 */
export async function setHumanTakeover(
  phone: string,
  takeOver: boolean,
  by: string
): Promise<TakeoverResult> {
  const variants = phoneVariants(phone);
  if (!variants.length) return { ok: false, matched: 0, error: "invalid_phone" };
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from("leads")
    .update(
      takeOver
        ? { human_takeover: true, human_takeover_at: now, human_takeover_by: by }
        : { human_takeover: false, human_takeover_at: null, human_takeover_by: null }
    )
    .in("phone_number", variants)
    .select("id");

  if (error) return { ok: false, matched: 0, error: error.message };

  let matched = updated?.length ?? 0;
  let firstLeadId = updated?.[0]?.id ?? null;
  if (takeOver && matched === 0) {
    const { data: inserted, error: insertError } = await supabase
      .from("leads")
      .insert({
        phone_number: normalizePhone(phone),
        human_takeover: true,
        human_takeover_at: now,
        human_takeover_by: by,
      })
      .select("id")
      .single();
    if (insertError) {
      return { ok: false, matched: 0, error: insertError.message };
    }
    matched = 1;
    firstLeadId = inserted?.id ?? null;
  }

  // Scope-freeze §8: one handover_events row per action so the Handover
  // metric survives release (human_takeover_at is nulled on release).
  // Best-effort — a failed audit insert must not block the handover itself.
  try {
    await supabase.from("handover_events").insert({
      phone_number: normalizePhone(phone),
      lead_id: firstLeadId,
      action: takeOver ? "takeover" : "release",
      actor: by,
    });
  } catch {
    // ignore — metric may undercount but the handover still happened
  }

  return { ok: true, matched };
}
