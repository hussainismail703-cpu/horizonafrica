import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { detectAndMarkCampaignResponse, extractInboundMessage } from "@/lib/campaign-detection";
import { classifyResponse } from "@/lib/classification";
import { extractStatusUpdates, recordDeliveryFailures } from "@/lib/delivery-status";
import { createServiceClient } from "@/lib/supabase/service";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? "horizon_africa_verify_2026";
const N8N_WEBHOOK_URL = "https://n8n.horizonafrica.co.za/webhook/whatsapp-webhook";
const N8N_ERROR_WEBHOOK_URL = "https://n8n.horizonafrica.co.za/webhook/webhook-proxy-error";

async function sendErrorAlert(error: string) {
  try {
    await fetch(N8N_ERROR_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error,
        source: "Vercel Webhook Proxy",
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Silent fail - don't block the response
  }
}

/**
 * Verify Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body signed
 * with the app secret). Returns null when META_APP_SECRET is not configured —
 * verification is impossible, so the request is allowed through (soft mode).
 * Returns true/false once configured.
 */
function verifyMetaSignature(rawBody: string, header: string | null): boolean | null {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return null;
  if (!header?.startsWith("sha256=")) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Record an inbound wamid after the message has been fully forwarded. Returns
 * true when the marker was already there (duplicate delivery).
 */
async function isDuplicateDelivery(wamid: string): Promise<boolean> {
  try {
    const { data } = await createServiceClient()
      .from("inbound_webhook_messages")
      .select("wamid")
      .eq("wamid", wamid)
      .maybeSingle();
    return !!data;
  } catch {
    return false; // Dedup unavailable — process anyway (no worse than before)
  }
}

async function markDelivered(wamid: string, phone: string) {
  try {
    await createServiceClient()
      .from("inbound_webhook_messages")
      .insert({ wamid, phone_number: phone });
  } catch {
    // Marker write failure only means a future retry may reprocess — acceptable
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const contentType = request.headers.get("content-type") || "application/json";

    // --- Signature verification ------------------------------------------------
    // Meta signs every webhook delivery. Verification only runs once
    // META_APP_SECRET is configured; rejections additionally require
    // META_WEBHOOK_ENFORCE_SIGNATURE=true so we can soft-launch and confirm
    // Meta's signatures verify before enforcing.
    const sigValid = verifyMetaSignature(body, request.headers.get("x-hub-signature-256"));
    if (sigValid === false) {
      const enforce = process.env.META_WEBHOOK_ENFORCE_SIGNATURE === "true";
      await sendErrorAlert(
        enforce
          ? "Rejected webhook POST: invalid X-Hub-Signature-256"
          : "Webhook POST failed X-Hub-Signature-256 check (soft mode — request allowed)"
      );
      if (enforce) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const parsed = (() => {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    })();

    const inbound = parsed ? extractInboundMessage(parsed) : null;

    // --- Idempotency -----------------------------------------------------------
    // Meta retries webhook deliveries on non-2xx/timeouts. If this wamid was
    // already fully processed, ack it without duplicating interactions,
    // classifications or n8n/AI work. The marker is written only AFTER a
    // successful forward so a retried delivery can never be lost.
    if (inbound?.metaMessageId && (await isDuplicateDelivery(inbound.metaMessageId))) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    // Campaign enrolment detection: if this is an inbound message from a
    // customer enrolled in an active campaign, mark them as 'responded' and
    // record the inbound interaction. This stops further campaign messages.
    // Then run intent classification on the response.
    // The message is still forwarded to n8n for the normal sales flow.
    if (inbound) {
      try {
        const detection = await detectAndMarkCampaignResponse(
          inbound.phoneNumber,
          inbound.messageBody,
          inbound.metaMessageId,
          inbound.messageType
        );
        if (detection && !detection.stop_detected && inbound.messageBody) {
          // Auto-classify the response (keyword-first, AI fallback)
          // STOP replies are already handled as opt-out — skip classification,
          // and empty bodies are not real replies.
          try {
            await classifyResponse(
              inbound.messageBody,
              detection.campaign_id,
              detection.enrolment_id,
              detection.phone_number
            );
          } catch {
            // Classification failure should not block n8n forwarding
          }
        }
      } catch {
        // Detection failure must not block forwarding
      }
    }

    // Meta reports delivery outcomes asynchronously via status callbacks on
    // this same webhook (sent/delivered/read/failed). Persist failures so
    // sends that Meta accepted but could not deliver are visible, and alert
    // staff — otherwise they are silently marked as sent.
    if (parsed) {
      try {
        const failures = await recordDeliveryFailures(extractStatusUpdates(parsed));
        for (const f of failures) {
          await sendErrorAlert(
            `WhatsApp delivery failed to ${f.recipient_phone}: ` +
              `[${f.error_code}] ${f.error_title} — ${f.error_message}`
          );
        }
      } catch {
        // Status logging must never block forwarding
      }
    }

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
      },
      body,
    });

    if (response.ok && inbound?.metaMessageId) {
      // Fully processed — mark the wamid so Meta retries short-circuit above.
      await markDelivered(inbound.metaMessageId, inbound.phoneNumber);
    }

    const responseText = await response.text();
    if (!response.ok) {
      await sendErrorAlert(`n8n returned HTTP ${response.status} - ${responseText.substring(0, 500)}`);
    }

    return new NextResponse(responseText || null, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    await sendErrorAlert(`Failed to reach n8n: ${errorMsg}`);
    return NextResponse.json({ error: "Forwarding failed" }, { status: 502 });
  }
}

export const runtime = "nodejs";
