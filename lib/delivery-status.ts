import { createServiceClient } from "@/lib/supabase/service";
import { normalizePhone } from "@/lib/phone-utils";
import { MessageDeliveryFailure } from "@/lib/types";

interface MetaStatusError {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
}

interface MetaStatus {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: MetaStatusError[];
}

/**
 * Extract Meta delivery-status callbacks (sent/delivered/read/failed) from a
 * webhook payload. Returns [] for payloads with no status updates.
 */
export function extractStatusUpdates(body: unknown): MetaStatus[] {
  const b = body as {
    entry?: { changes?: { value?: { statuses?: MetaStatus[] } }[] }[];
  };
  const statuses: MetaStatus[] = [];
  for (const entry of b?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const s of change?.value?.statuses ?? []) {
        statuses.push(s);
      }
    }
  }
  return statuses;
}

// Delivery statuses only ever move forward. Meta occasionally sends updates
// out of order (e.g. "delivered" after "read"), so each status has a set of
// predecessor states it may legally replace.
const STATUS_PREDECESSORS: Record<string, string[]> = {
  sent: ["pending"],
  delivered: ["pending", "sent"],
  read: ["pending", "sent", "delivered"],
  failed: ["pending", "sent", "delivered"],
};

/**
 * Persist non-failure delivery callbacks (sent/delivered/read, plus Meta-side
 * failures) onto the records that originated the message:
 *   - campaign_interactions (matched on meta_message_id) so campaign
 *     delivery/read-rate metrics reflect reality
 *   - broadcast_messages (matched on wamid) so broadcast_history
 *     total_delivered/total_read counters tick up via the sync trigger.
 * Failed statuses also keep landing in message_delivery_failures via
 * recordDeliveryFailures() for the alert trail.
 */
export async function recordDeliveryStatuses(
  statuses: MetaStatus[]
): Promise<void> {
  const supabase = createServiceClient();

  for (const s of statuses) {
    const wamid = s.id;
    const status = s.status;
    if (!wamid || !status) continue;
    const predecessors = STATUS_PREDECESSORS[status];
    if (!predecessors) continue;

    const err = s.errors?.[0];
    const errText =
      err?.error_data?.details ?? err?.message ?? err?.title ?? null;

    await supabase
      .from("campaign_interactions")
      .update({
        delivery_status: status,
        ...(status === "failed" ? { meta_error: errText } : {}),
      })
      .eq("meta_message_id", wamid)
      .in("delivery_status", predecessors);

    await supabase
      .from("broadcast_messages")
      .update({
        status,
        ...(status === "failed" ? { error: errText } : {}),
      })
      .eq("wamid", wamid)
      .in("status", predecessors);
  }
}

/**
 * Persist failed delivery statuses to message_delivery_failures so sends that
 * Meta accepted but could not deliver are visible instead of silently marked
 * sent. Returns the inserted rows (used for alerting).
 */
export async function recordDeliveryFailures(
  statuses: MetaStatus[]
): Promise<MessageDeliveryFailure[]> {
  const failures = statuses.filter((s) => s.status === "failed");
  if (failures.length === 0) return [];

  const supabase = createServiceClient();
  const rows = failures.map((s) => {
    const err = s.errors?.[0];
    return {
      message_id: s.id ?? null,
      recipient_phone: s.recipient_id ? normalizePhone(s.recipient_id) : null,
      error_code: err?.code ?? null,
      error_title: err?.title ?? null,
      error_message: err?.error_data?.details ?? err?.message ?? null,
      raw_status: s,
    };
  });

  const { data, error } = await supabase
    .from("message_delivery_failures")
    .insert(rows)
    .select();

  if (error) throw new Error(error.message);
  return (data ?? []) as MessageDeliveryFailure[];
}
