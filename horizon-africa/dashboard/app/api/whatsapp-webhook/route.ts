import { NextRequest, NextResponse } from "next/server";

const VERIFY_TOKEN = "horizon_africa_verify_2026";
const N8N_WEBHOOK_URL = "https://n8n.horizonafrica.co.za/webhook/whatsapp-webhook";
const ERROR_ALERT_URL = "https://n8n.horizonafrica.co.za/webhook/webhook-proxy-error";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://gbchhzipbbxpvgtaheze.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

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

function extractMessageData(body: any) {
  let phoneNumber = "";
  let messageText = "";
  let messageId = "";
  let contactName = "";

  if (body?.entry?.[0]?.changes?.[0]?.value) {
    const value = body.entry[0].changes[0].value;
    if (value.messages?.[0]) {
      const msg = value.messages[0];
      phoneNumber = msg.from || "";
      messageId = msg.id || "";
      messageText = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || "";
    }
    if (value.contacts?.[0]) {
      contactName = value.contacts[0].profile?.name || "";
    }
  }

  return { phoneNumber, messageText, messageId, contactName };
}

async function saveToSupabase(phoneNumber: string, contactName: string, messageText: string, messageId: string) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/conversations`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        phone_number: phoneNumber,
        contact_name: contactName,
        incoming_message: messageText,
        ai_response: null,
        lead_score: "COLD",
        message_id: messageId,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (e) {
    // Non-blocking - we still want to forward to n8n even if Supabase fails
    console.error("Failed to save to Supabase:", e);
  }
}

async function sendErrorAlert(error: string) {
  try {
    await fetch(ERROR_ALERT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: error,
        source: "Vercel Webhook Proxy",
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Non-blocking
  }
}

export async function POST(request: NextRequest) {
  try {
    const bodyText = await request.text();
    const body = JSON.parse(bodyText);

    // Extract message data and save to Supabase BEFORE forwarding to n8n
    // This ensures the message is preserved even if n8n is down
    const { phoneNumber, messageText, messageId, contactName } = extractMessageData(body);

    // Only save and forward if this is an actual message (not a status update)
    if (phoneNumber && messageText) {
      await saveToSupabase(phoneNumber, contactName, messageText, messageId);
    }

    // Forward to n8n
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: bodyText,
    });

    // If n8n returned an error, send an alert
    if (!response.ok) {
      await sendErrorAlert(`n8n returned status ${response.status} when forwarding webhook from ${phoneNumber}`);
    }

    return new NextResponse(null, { status: response.status });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    await sendErrorAlert(`Vercel proxy failed to forward webhook: ${errorMsg}`);
    return NextResponse.json({ error: "Forwarding failed" }, { status: 502 });
  }
}
