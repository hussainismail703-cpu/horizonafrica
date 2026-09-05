"use client";

import { CampaignStats } from "@/lib/campaign-stats";
import { StatCard } from "@/components/stat-card";
import {
  Send,
  CheckCheck,
  MessageSquareReply,
  TrendingUp,
  Target,
  AlertTriangle,
  Users,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

interface Props {
  stats: CampaignStats;
}

function rateLabel(rate: number | null): string {
  return rate === null ? "N/A" : `${rate}%`;
}

export function CampaignReportClient({ stats }: Props) {
  const hasMessages = stats.messagesSent > 0;

  const chartData = stats.stepBreakdown.map((s) => ({
    step: `Step ${s.step}`,
    Sent: s.sent,
    Delivered: s.delivered,
    Responses: s.responses,
  }));

  return (
    <div className="space-y-6">
      {/* Headline metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Messages Sent"
          value={stats.messagesSent}
          icon={Send}
          iconBg="bg-tertiary-container/30"
          iconColor="text-tertiary"
        />
        <StatCard
          label="Delivery Rate"
          value={rateLabel(stats.deliveryRate)}
          icon={CheckCheck}
          iconBg="bg-secondary-container/30"
          iconColor="text-secondary"
        />
        <StatCard
          label="Response Rate"
          value={rateLabel(stats.responseRate)}
          icon={MessageSquareReply}
          iconBg="bg-secondary-container/20"
          iconColor="text-secondary"
        />
        <StatCard
          label="Entered Sales Flow"
          value={stats.enteredSalesFlow}
          icon={TrendingUp}
          iconBg="bg-secondary-container/30"
          iconColor="text-secondary"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Converted"
          value={stats.converted}
          icon={Target}
          iconBg="bg-secondary-container/20"
          iconColor="text-secondary"
        />
        <StatCard
          label="Failed Messages"
          value={stats.failedMessages}
          icon={AlertTriangle}
          iconBg="bg-error-container/30"
          iconColor="text-error"
        />
        <StatCard
          label="Total Enrolled"
          value={stats.totalEnrolled}
          icon={Users}
          iconBg="bg-surface-container-high"
          iconColor="text-secondary"
        />
        <StatCard
          label="Active Enrolled"
          value={stats.activeEnrolled}
          icon={Users}
          iconBg="bg-secondary-container/20"
          iconColor="text-secondary"
        />
      </div>

      {/* Sales Funnel Visualization */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h2 className="mb-5 text-lg font-semibold text-on-surface">
          Sales Funnel
        </h2>
        <p className="mb-4 text-xs text-on-surface-variant">
          Leads &rarr; Responses &rarr; Engaged &rarr; Interested &rarr; Calling Queue &rarr; Converted
        </p>
        <FunnelBar
          stages={[
            { label: "Leads", value: stats.totalEnrolled, color: "bg-primary" },
            { label: "Responses", value: stats.responses, color: "bg-secondary" },
            { label: "Engaged", value: stats.engagedCount, color: "bg-tertiary" },
            { label: "Interested", value: stats.interestedCount + stats.callbackRequestedCount, color: "bg-secondary" },
            { label: "Calling Queue", value: stats.callingQueueCount, color: "bg-primary" },
            { label: "Converted", value: stats.converted, color: "bg-tertiary" },
          ]}
        />
      </div>

      {/* Classification breakdown */}
      {stats.classificationBreakdown.length > 0 && (
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
          <h2 className="mb-5 text-lg font-semibold text-on-surface">
            Classification Breakdown
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-variant text-xs uppercase tracking-wider text-on-surface-variant">
                <tr>
                  <th className="px-4 py-3 font-semibold">Classification</th>
                  <th className="px-4 py-3 font-semibold">Count</th>
                  <th className="px-4 py-3 font-semibold">Percentage</th>
                  <th className="px-4 py-3 font-semibold">Distribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-variant/50">
                {stats.classificationBreakdown.map((row) => (
                  <tr key={row.classification} className="hover:bg-surface-container-low">
                    <td className="px-4 py-3 font-medium text-on-surface capitalize">
                      {row.classification.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">{row.count}</td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {row.percentage === null ? "N/A" : `${row.percentage}%`}
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-2 w-full max-w-xs rounded-full bg-surface-container-high">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${row.percentage ?? 0}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Final outcome distribution */}
      {stats.finalOutcomeBreakdown.length > 0 && (
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
          <h2 className="mb-5 text-lg font-semibold text-on-surface">
            Final Outcome Distribution
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {stats.finalOutcomeBreakdown.map((row) => (
              <div
                key={row.outcome}
                className="rounded-lg border border-surface-variant bg-surface-container-low p-4 text-center"
              >
                <p className="text-3xl font-bold text-on-surface">{row.count}</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wider text-on-surface-variant">
                  {row.outcome}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enrolment status breakdown */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h2 className="mb-5 text-lg font-semibold text-on-surface">
          Enrolment Status Breakdown
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
          {[
            { label: "Active", value: stats.statusCounts.active, color: "text-secondary" },
            { label: "Responded", value: stats.statusCounts.responded, color: "text-tertiary" },
            { label: "Interested", value: stats.statusCounts.interested, color: "text-secondary" },
            { label: "Callback Req.", value: stats.statusCounts.callback_requested, color: "text-secondary" },
            { label: "Not Interested", value: stats.statusCounts.not_interested, color: "text-error" },
            { label: "Opted Out", value: stats.statusCounts.opted_out, color: "text-error" },
            { label: "No Response", value: stats.statusCounts.no_response_final, color: "text-on-surface-variant" },
            { label: "Completed", value: stats.statusCounts.completed, color: "text-on-surface" },
            { label: "Removed", value: stats.statusCounts.removed, color: "text-error" },
            { label: "Other/Invalid", value: stats.statusCounts.other_invalid, color: "text-on-surface-variant" },
          ].map((row) => (
            <div
              key={row.label}
              className="rounded-lg border border-surface-variant bg-surface-container-low p-4 text-center"
            >
              <p className={`text-3xl font-bold ${row.color}`}>{row.value}</p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wider text-on-surface-variant">
                {row.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Step performance chart */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h2 className="mb-5 text-lg font-semibold text-on-surface">
          Per-Step Performance
        </h2>
        {chartData.length === 0 ? (
          <p className="py-8 text-center text-sm text-on-surface-variant">
            No interactions yet for this campaign.
          </p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                <XAxis dataKey="step" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Sent" fill="#6750A4" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Delivered" fill="#006C4C" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Responses" fill="#005AC1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Rate summary */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h2 className="mb-5 text-lg font-semibold text-on-surface">Rate Summary</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-surface-variant bg-surface-container-low p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
              Delivery Rate
            </p>
            <p className="mt-1 text-2xl font-bold text-on-surface">
              {rateLabel(stats.deliveryRate)}
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {stats.deliveredCount} delivered / {stats.messagesSent} sent
            </p>
          </div>
          <div className="rounded-lg border border-surface-variant bg-surface-container-low p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
              Read Rate
            </p>
            <p className="mt-1 text-2xl font-bold text-on-surface">
              {rateLabel(stats.readRate)}
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {stats.readCount} read / {stats.deliveredCount} delivered
            </p>
          </div>
          <div className="rounded-lg border border-surface-variant bg-surface-container-low p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
              Response Rate
            </p>
            <p className="mt-1 text-2xl font-bold text-on-surface">
              {rateLabel(stats.responseRate)}
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {stats.responses} responses / {stats.messagesSent} sent
            </p>
          </div>
          <div className="rounded-lg border border-surface-variant bg-surface-container-low p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
              Conversion Rate
            </p>
            <p className="mt-1 text-2xl font-bold text-on-surface">
              {hasMessages ? rateLabel(stats.converted > 0 ? Math.round((stats.converted / stats.messagesSent) * 1000) / 10 : 0) : "N/A"}
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {stats.converted} converted / {stats.messagesSent} sent
            </p>
          </div>
        </div>
      </div>

      {/* Recent interactions */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h2 className="mb-5 text-lg font-semibold text-on-surface">
          Recent Interactions
        </h2>
        {stats.recentInteractions.length === 0 ? (
          <p className="py-8 text-center text-sm text-on-surface-variant">
            No interactions recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-variant text-xs uppercase tracking-wider text-on-surface-variant">
                <tr>
                  <th className="px-4 py-3 font-semibold">Phone</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Template</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-variant/50">
                {stats.recentInteractions.map((i) => (
                  <tr key={i.id} className="transition-colors hover:bg-surface-container-low">
                    <td className="px-4 py-3 font-medium text-on-surface">
                      {i.phone_number}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                          i.message_type === "outbound"
                            ? "bg-tertiary-container/30 text-tertiary"
                            : "bg-secondary-container/30 text-secondary"
                        }`}
                      >
                        {i.message_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {i.template_name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                          i.delivery_status === "failed"
                            ? "bg-error-container/30 text-error"
                            : i.delivery_status === "delivered" || i.delivery_status === "read"
                            ? "bg-secondary-container/30 text-secondary"
                            : "bg-surface-container-high text-on-surface-variant"
                        }`}
                      >
                        {i.delivery_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {new Date(i.occurred_at).toLocaleString("en-ZA", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Failed messages */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-on-surface">Failed Messages</h2>
          <span className="text-xs text-on-surface-variant">
            {stats.failedInteractions.length} failure
            {stats.failedInteractions.length === 1 ? "" : "s"}
          </span>
        </div>
        {stats.failedInteractions.length === 0 ? (
          <p className="py-8 text-center text-sm text-on-surface-variant">
            No failed messages. All sends delivered successfully.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-variant text-xs uppercase tracking-wider text-on-surface-variant">
                <tr>
                  <th className="px-4 py-3 font-semibold">Phone</th>
                  <th className="px-4 py-3 font-semibold">Step</th>
                  <th className="px-4 py-3 font-semibold">Template</th>
                  <th className="px-4 py-3 font-semibold">Error</th>
                  <th className="px-4 py-3 font-semibold">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-variant/50">
                {stats.failedInteractions.map((f) => (
                  <tr key={f.id} className="transition-colors hover:bg-surface-container-low">
                    <td className="px-4 py-3 font-medium text-on-surface">
                      {f.phone_number}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {f.step_number ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {f.template_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-error">
                      {f.meta_error ?? "Unknown error"}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {new Date(f.occurred_at).toLocaleString("en-ZA", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Engine errors */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-on-surface">Engine Error Log</h2>
          <span className="text-xs text-on-surface-variant">
            {stats.recentErrors.length} recent error
            {stats.recentErrors.length === 1 ? "" : "s"}
          </span>
        </div>
        {stats.recentErrors.length === 0 ? (
          <p className="py-8 text-center text-sm text-on-surface-variant">
            No engine errors recorded for this campaign.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-variant text-xs uppercase tracking-wider text-on-surface-variant">
                <tr>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Phone</th>
                  <th className="px-4 py-3 font-semibold">Message</th>
                  <th className="px-4 py-3 font-semibold">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-variant/50">
                {stats.recentErrors.map((e) => (
                  <tr key={e.id} className="transition-colors hover:bg-surface-container-low">
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-error-container/30 px-2 py-0.5 text-xs font-semibold text-error">
                        {e.error_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {e.phone_number ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-on-surface-variant">
                      {e.error_message ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {new Date(e.created_at).toLocaleString("en-ZA", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
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

// ---------------------------------------------------------------------------
// FunnelBar — horizontal funnel visualization
// ---------------------------------------------------------------------------

interface FunnelStage {
  label: string;
  value: number;
  color: string;
}

function FunnelBar({ stages }: { stages: FunnelStage[] }) {
  const maxValue = Math.max(...stages.map((s) => s.value), 1);

  return (
    <div className="space-y-2">
      {stages.map((stage, idx) => {
        const widthPct = Math.max((stage.value / maxValue) * 100, 2);
        const prevValue = idx > 0 ? stages[idx - 1].value : null;
        const conversionRate =
          prevValue !== null && prevValue > 0
            ? Math.round((stage.value / prevValue) * 1000) / 10
            : null;

        return (
          <div key={stage.label} className="flex items-center gap-4">
            <div className="w-32 shrink-0 text-right text-xs font-semibold text-on-surface-variant">
              {stage.label}
            </div>
            <div className="flex-1">
              <div className="relative h-10 rounded-lg bg-surface-container-low">
                <div
                  className={`flex h-10 items-center justify-end rounded-lg px-3 text-xs font-bold text-on-primary ${stage.color}`}
                  style={{ width: `${widthPct}%` }}
                >
                  {stage.value}
                </div>
              </div>
            </div>
            <div className="w-16 shrink-0 text-xs text-on-surface-variant">
              {conversionRate !== null ? `${conversionRate}%` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
