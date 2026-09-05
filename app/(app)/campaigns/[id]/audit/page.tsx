import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Campaign, CampaignAuditLog } from "@/lib/types";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

function formatDateTime(d: string): string {
  return new Date(d).toLocaleString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: camp } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (!camp) notFound();
  const campaign = camp as Campaign;

  // Fetch audit log entries related to this campaign's enrolments and classifications
  // We query by entity_ids that belong to this campaign
  const { data: enrolments } = await supabase
    .from("campaign_enrolments")
    .select("id")
    .eq("campaign_id", id);

  const enrolIds = (enrolments ?? []).map((e) => e.id);

  const { data: classifications } = await supabase
    .from("campaign_classifications")
    .select("id, interaction_id")
    .in("interaction_id", (
      await supabase
        .from("campaign_interactions")
        .select("id")
        .eq("campaign_id", id)
    ).data?.map((i) => i.id) ?? []);

  const classIds = (classifications ?? []).map((c) => c.id);

  const allEntityIds = [...enrolIds, ...classIds];

  let auditLogs: CampaignAuditLog[] = [];
  if (allEntityIds.length > 0) {
    const { data } = await supabase
      .from("campaign_audit_log")
      .select("*")
      .in("entity_id", allEntityIds)
      .order("changed_at", { ascending: false });
    auditLogs = (data ?? []) as CampaignAuditLog[];
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href={`/campaigns/${campaign.id}`}
          className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant hover:text-on-surface"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Campaign
        </Link>
        <h1 className="text-lg font-semibold text-on-surface">
          Audit Trail — {campaign.name}
        </h1>
      </div>

      {auditLogs.length === 0 ? (
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-12 text-center">
          <p className="text-sm text-on-surface-variant">
            No audit entries yet. Manual changes to enrolments and classifications will appear here.
          </p>
        </div>
      ) : (
        <div className="card-shadow overflow-hidden rounded-xl border border-surface-variant bg-surface-container-lowest">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-surface-variant bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant">
              <tr>
                <th className="px-4 py-3 font-semibold">Date/Time</th>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Entity</th>
                <th className="px-4 py-3 font-semibold">Field</th>
                <th className="px-4 py-3 font-semibold">Old → New</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-variant/50">
              {auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-surface-container-low">
                  <td className="px-4 py-3 text-xs text-on-surface-variant">
                    {formatDateTime(log.changed_at)}
                  </td>
                  <td className="px-4 py-3 text-xs font-medium text-on-surface">
                    {log.changed_by}
                  </td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">
                    {log.entity_type}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-on-surface">
                    {log.field_changed}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className="text-on-surface-variant">{log.old_value}</span>
                    <span className="mx-2 text-primary">→</span>
                    <span className="font-medium text-on-surface">{log.new_value}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
