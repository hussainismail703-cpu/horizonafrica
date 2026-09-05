import { NextRequest, NextResponse } from "next/server";
import { detectAndMarkCampaignResponse, extractInboundMessage } from "@/lib/campaign-detection";
import { classifyResponse } from "@/lib/classification";

const VERIFY_TOKEN = "horizon_africa_verify_2026";
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

    // Campaign enrolment detection: if this is an inbound message from a
    // customer enrolled in an active campaign, mark them as 'responded' and
    // record the inbound interaction. This stops further campaign messages.
    // Then run intent classification on the response.
    // The message is still forwarded to n8n for the normal sales flow.
    try {
      const parsed = JSON.parse(body);
      const inbound = extractInboundMessage(parsed);
      if (inbound) {
        const detection = await detectAndMarkCampaignResponse(
          inbound.phoneNumber,
          inbound.messageBody
        );
        if (detection && !detection.stop_detected) {
          // Auto-classify the response (keyword-first, AI fallback)
          // STOP replies are already handled as opt-out — skip classification
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
      }
    } catch {
      // Not JSON or not an inbound message — continue with normal forwarding
    }

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
      },
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      await sendErrorAlert(`n8n returned HTTP ${response.status} - ${errorBody.substring(0, 500)}`);
    }

    const responseText = await response.text();
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
