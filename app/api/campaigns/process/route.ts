import { NextRequest, NextResponse } from "next/server";
import { processCampaigns } from "@/lib/campaign-engine";
import { createServiceClient } from "@/lib/supabase/service";

export const maxDuration = 60;

// /api/campaigns/process
// Triggered by n8n (POST) or Vercel Cron (GET, if re-enabled on Pro plan).
// Requires Authorization: Bearer <APP_SECRET> (or Bearer <CRON_SECRET> if set).
async function handle(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const appSecret = process.env.APP_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  if (!appSecret && !cronSecret) {
    return NextResponse.json(
      { error: "APP_SECRET env var is not configured" },
      { status: 500 }
    );
  }

  const isAuth =
    (appSecret && authHeader === `Bearer ${appSecret}`) ||
    (cronSecret && authHeader === `Bearer ${cronSecret}`);

  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Heartbeat: stamp every authenticated invocation so a dead scheduler
  // (n8n workflow disabled, n8n down, cron removed) is detectable via
  // /api/health rather than silently stopping campaign sends.
  try {
    await createServiceClient()
      .from("system_heartbeats")
      .upsert({ name: "campaign_process", last_run_at: new Date().toISOString() });
  } catch {
    // Heartbeat failure must not block processing
  }

  const result = await processCampaigns();

  return NextResponse.json({
    processed: result.campaigns_processed,
    sent: result.messages_sent,
    failed: result.messages_failed,
    advanced: result.enrolments_advanced,
    errors: result.errors,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
