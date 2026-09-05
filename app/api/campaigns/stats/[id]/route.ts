import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCampaignStats } from "@/lib/campaign-stats";

export const dynamic = "force-dynamic";

// GET /api/campaigns/stats/[id]
// Returns detailed performance statistics for a single campaign.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Campaign id is required" }, { status: 400 });
  }

  try {
    const stats = await getCampaignStats(supabase, id);
    if (!stats) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    return NextResponse.json({ stats });
  } catch (err) {
    console.error("campaign stats error:", err);
    return NextResponse.json(
      { error: "Failed to load campaign stats" },
      { status: 500 }
    );
  }
}
