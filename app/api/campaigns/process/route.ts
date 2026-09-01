import { NextRequest, NextResponse } from "next/server";
import { processCampaigns } from "@/lib/campaign-engine";

// POST /api/campaigns/process
// Triggered by Vercel Cron or n8n. Requires Authorization: Bearer <APP_SECRET>.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expected = process.env.APP_SECRET;

  if (!expected) {
    return NextResponse.json(
      { error: "APP_SECRET env var is not configured" },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${expected}`) {
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
