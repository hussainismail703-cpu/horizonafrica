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
