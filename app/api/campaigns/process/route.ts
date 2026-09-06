import { NextRequest, NextResponse } from "next/server";
import { processCampaigns } from "@/lib/campaign-engine";

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
