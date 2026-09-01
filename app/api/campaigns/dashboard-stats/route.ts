import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDashboardOverview, getDashboardCampaignRows } from "@/lib/campaign-stats";

export const dynamic = "force-dynamic";

// GET /api/campaigns/dashboard-stats
// Returns aggregate overview + per-campaign summary rows for the campaign dashboard.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [overview, campaigns] = await Promise.all([
      getDashboardOverview(supabase),
      getDashboardCampaignRows(supabase),
    ]);

    return NextResponse.json({ overview, campaigns });
  } catch (err) {
    console.error("dashboard-stats error:", err);
    return NextResponse.json(
      { error: "Failed to load dashboard stats" },
      { status: 500 }
    );
  }
}
