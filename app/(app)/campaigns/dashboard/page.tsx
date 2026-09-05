import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/stat-card";
import {
  getDashboardOverview,
  getDashboardCampaignRows,
  DashboardOverview,
  CampaignSummaryRow,
} from "@/lib/campaign-stats";
import { CampaignStatus } from "@/lib/types";
import Link from "next/link";
import {
  Megaphone,
  Users,
  Send,
  MessageSquareReply,
  ArrowLeft,
  BarChart3,
  ArrowRight,
} from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: "bg-surface-container-high text-on-surface-variant",
  active: "bg-secondary-container/40 text-secondary",
  paused: "bg-primary-container/40 text-on-primary-container",
  completed: "bg-tertiary-container/40 text-on-tertiary",
  stopped: "bg-error-container/40 text-on-error",
};

function formatStepDistribution(dist: { step: number; count: number }[]): string {
  if (dist.length === 0) return "—";
  return dist
    .map((d) => `S${d.step}: ${d.count}`)
    .join("  ·  ");
}

export default async function CampaignDashboardPage() {
  const supabase = await createClient();

  let overview: DashboardOverview = {
    totalActiveCampaigns: 0,
    totalEnrolledCustomers: 0,
    messagesSentToday: 0,
    responsesToday: 0,
  };
  let campaigns: CampaignSummaryRow[] = [];

  try {
    [overview, campaigns] = await Promise.all([
      getDashboardOverview(supabase),
      getDashboardCampaignRows(supabase),
    ]);
  } catch (err) {
    console.error("campaign dashboard load error:", err);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/campaigns"
          className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant hover:text-on-surface"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Campaigns
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-on-surface">Campaign Dashboard</h1>
        <p className="text-sm text-on-surface-variant">
          Performance overview across all campaigns
        </p>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Campaigns"
          value={overview.totalActiveCampaigns}
          icon={Megaphone}
          iconBg="bg-secondary-container/20"
          iconColor="text-secondary"
        />
        <StatCard
          label="Enrolled Customers"
          value={overview.totalEnrolledCustomers}
          icon={Users}
          iconBg="bg-surface-container-high"
          iconColor="text-secondary"
        />
        <StatCard
          label="Messages Sent Today"
          value={overview.messagesSentToday}
          icon={Send}
          iconBg="bg-tertiary-container/30"
          iconColor="text-tertiary"
        />
        <StatCard
          label="Responses Today"
          value={overview.responsesToday}
          icon={MessageSquareReply}
          iconBg="bg-secondary-container/30"
          iconColor="text-secondary"
        />
      </div>

      {/* Active campaigns table */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-on-surface">All Campaigns</h2>
          <span className="text-xs text-on-surface-variant">
            {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}
          </span>
        </div>

        {campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Megaphone className="mb-3 h-8 w-8 text-on-surface-variant/40" />
            <p className="text-sm text-on-surface-variant">
              No campaigns yet. Create one to see performance here.
            </p>
            <Link
              href="/campaigns/create"
              className="mt-3 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary transition-all hover:brightness-110"
            >
              Create Campaign
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-variant text-xs uppercase tracking-wider text-on-surface-variant">
                <tr>
                  <th className="px-4 py-3 font-semibold">Campaign</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Enrolled</th>
                  <th className="px-4 py-3 font-semibold">Step Distribution</th>
                  <th className="px-4 py-3 font-semibold">Responses</th>
                  <th className="px-4 py-3 font-semibold">Conversions</th>
                  <th className="px-4 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-variant/50">
                {campaigns.map((c) => (
                  <tr
                    key={c.id}
                    className="transition-colors hover:bg-surface-container-low"
                  >
                    <td className="px-4 py-3 font-medium text-on-surface">
                      {c.name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                          STATUS_STYLES[c.status as CampaignStatus] ?? ""
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {c.totalEnrolled}
                    </td>
                    <td className="px-4 py-3 text-xs text-on-surface-variant">
                      {formatStepDistribution(c.stepDistribution)}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {c.responses}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {c.conversions}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/campaigns/reports/${c.id}`}
                          className="flex items-center gap-1 rounded-lg bg-surface-container-high px-2.5 py-1.5 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-highest"
                          title="Performance report"
                        >
                          <BarChart3 className="h-3.5 w-3.5" />
                          Report
                        </Link>
                        <Link
                          href={`/campaigns/${c.id}`}
                          className="flex items-center gap-1 rounded-lg bg-surface-container-high px-2.5 py-1.5 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-highest"
                        >
                          Manage
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
