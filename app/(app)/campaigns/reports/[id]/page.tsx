import { createClient } from "@/lib/supabase/server";
import { getCampaignStats, CampaignStats } from "@/lib/campaign-stats";
import { notFound } from "next/navigation";
import { CampaignReportClient } from "./report-client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CampaignReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  let stats: CampaignStats | null = null;
  try {
    stats = await getCampaignStats(supabase, id);
  } catch (err) {
    console.error("campaign report load error:", err);
  }

  if (!stats) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/campaigns/dashboard"
          className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant hover:text-on-surface"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <Link
          href={`/campaigns/${id}`}
          className="rounded-lg bg-surface-container-high px-3 py-1.5 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-highest"
        >
          Manage Campaign
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-on-surface">
          {stats!.campaignName} — Performance Report
        </h1>
        <p className="text-sm text-on-surface-variant">
          Detailed metrics for this campaign
        </p>
      </div>

      <CampaignReportClient stats={stats!} />
    </div>
  );
}
