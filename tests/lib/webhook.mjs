/**
 * Shared helpers for calling /api/whatsapp-webhook in tests.
 *
 * The webhook route verifies Meta's X-Hub-Signature-256 header (HMAC-SHA256 of
 * the raw body signed with META_APP_SECRET). When the secret is configured and
 * META_WEBHOOK_ENFORCE_SIGNATURE=true, unsigned requests are rejected with 401,
 * so tests must sign payloads exactly like Meta does.
 *
 * META_APP_SECRET comes from --env-file=.env.local. When it is absent these
 * helpers return no signature header and the server runs in soft mode.
 */
import crypto from "node:crypto";

const APP_SECRET = process.env.META_APP_SECRET || "";

/** Returns "sha256=<hmac hex>" for the exact raw body string, or null. */
export function webhookSignature(rawBody) {
  if (!APP_SECRET) return null;
  return "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(rawBody, "utf8").digest("hex");
}

/**
 * Signature headers to merge into a webhook POST. `rawBody` must be the exact
 * string sent on the wire — pass JSON.stringify(payload), not the object.
 */
export function webhookHeaders(rawBody, extra = {}) {
  const sig = webhookSignature(rawBody);
  return sig ? { ...extra, "x-hub-signature-256": sig } : { ...extra };
}

/** Signed POST to /api/whatsapp-webhook. Returns { status, response }. */
export async function postWebhook(baseUrl, payload, extraHeaders = {}) {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${baseUrl}/api/whatsapp-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...webhookHeaders(raw), ...extraHeaders },
    body: raw,
  });
  const text = await res.text();
  return { status: res.status, response: text };
}
