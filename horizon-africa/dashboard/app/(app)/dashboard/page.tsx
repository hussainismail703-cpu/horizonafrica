import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/stat-card";
import { ScoreBadge } from "@/components/score-badge";
import { Users, Flame, MessageSquare, Radio, ArrowRight } from "lucide-react";
import { extractMessageText } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [leadsCount, hotLeadsCount, conversationsCount, broadcastsCount, recentLeads, recentConversations, allLeads] = await Promise.all([
    supabase.from("leads").select("*", { count: "exact", head: true }),
    supabase.from("leads").select("*", { count: "exact", head: true }).eq("lead_score", "HOT"),
    supabase.from("conversations").select("*", { count: "exact", head: true }),
    supabase.from("broadcast_history").select("*", { count: "exact", head: true }),
    supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(5),
    supabase.from("conversations").select("*").order("created_at", { ascending: false }).limit(5),
    supabase.from("leads").select("lead_score"),
  ]);

  const totalLeads = leadsCount.count ?? 0;
  const totalHot = hotLeadsCount.count ?? 0;
  const totalConversations = conversationsCount.count ?? 0;
  const totalBroadcasts = broadcastsCount.count ?? 0;

  const scoreCounts = { HOT: 0, WARM: 0, COLD: 0 };
  allLeads.data?.forEach((lead) => {
    if (lead.lead_score in scoreCounts) {
      scoreCounts[lead.lead_score as keyof typeof scoreCounts]++;
    }
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-on-surface-variant">
          Snapshot of your WhatsApp AI sales pipeline
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Leads"
          value={totalLeads}
          icon={Users}
          iconBg="bg-surface-container-high"
          iconColor="text-secondary"
        />
        <StatCard
          label="Hot Leads"
          value={totalHot}
          icon={Flame}
          iconBg="bg-secondary-container/20"
          iconColor="text-secondary"
        />
        <StatCard
          label="Active Conversations"
          value={totalConversations}
          icon={MessageSquare}
          iconBg="bg-secondary-container/30"
          iconColor="text-secondary"
        />
        <StatCard
          label="Broadcasts Sent"
          value={totalBroadcasts}
          icon={Radio}
          iconBg="bg-tertiary-container/30"
          iconColor="text-tertiary"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Leads Table */}
        <div className="lg:col-span-2 card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-on-surface">Recent Leads</h2>
            <Link
              href="/leads"
              className="flex items-center gap-1 text-xs font-semibold text-secondary transition-colors hover:text-secondary-fixed-dim"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {recentLeads.data && recentLeads.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-outline-variant text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                    <th className="pb-3">Name</th>
                    <th className="pb-3">Phone</th>
                    <th className="pb-3">Score</th>
                    <th className="pb-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentLeads.data.map((lead) => (
                    <tr key={lead.id} className="border-b border-outline-variant/30 last:border-0">
                      <td className="py-3 text-on-surface">{lead.full_name ?? "—"}</td>
                      <td className="py-3 text-on-surface-variant">{lead.phone_number}</td>
                      <td className="py-3"><ScoreBadge score={lead.lead_score as "HOT" | "WARM" | "COLD"} /></td>
                      <td className="py-3 capitalize text-on-surface-variant">{lead.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-on-surface-variant">
              No leads yet. Leads will appear here once the WhatsApp bot is active.
            </p>
          )}
        </div>

        {/* Lead Score Breakdown */}
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
          <h2 className="mb-5 text-lg font-semibold text-on-surface">Lead Score Breakdown</h2>
          <div className="space-y-4">
            {(["HOT", "WARM", "COLD"] as const).map((score) => {
              const count = scoreCounts[score];
              const pct = totalLeads > 0 ? Math.round((count / totalLeads) * 100) : 0;
              return (
                <div key={score}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <ScoreBadge score={score} />
                    <span className="text-xs text-on-surface-variant">{count} ({pct}%)</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-container-high">
                    <div
                      className={`h-full rounded-full transition-all ${
                        score === "HOT" ? "bg-secondary-container" : score === "WARM" ? "bg-secondary-fixed-dim" : "bg-surface-variant"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent Conversations */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-on-surface">Recent Conversations</h2>
          <Link
            href="/conversations"
            className="flex items-center gap-1 text-xs font-semibold text-secondary transition-colors hover:text-secondary-fixed-dim"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {recentConversations.data && recentConversations.data.length > 0 ? (
          <div className="space-y-3">
            {recentConversations.data.map((conv) => (
              <div key={conv.id} className="flex items-center justify-between border-b border-outline-variant/30 pb-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-on-surface">
                    {conv.contact_name ?? conv.phone_number}
                  </p>
                  <p className="truncate text-xs text-on-surface-variant">
                    {extractMessageText(conv.incoming_message) ?? "—"}
                  </p>
                </div>
                <div className="ml-3 flex flex-col items-end gap-1">
                  <ScoreBadge score={conv.lead_score as "HOT" | "WARM" | "COLD"} />
                  <span className="text-xs text-on-surface-variant/60">
                    {new Date(conv.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-on-surface-variant">
            No conversations yet. Messages will appear here once the WhatsApp bot is active.
          </p>
        )}
      </div>
    </div>
  );
}
