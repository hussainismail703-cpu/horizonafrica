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

      {/* Enrolment status breakdown */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h2 className="mb-5 text-lg font-semibold text-on-surface">
          Enrolment Status Breakdown
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Active", value: stats.activeEnrolled, color: "text-secondary" },
            { label: "Responded", value: stats.respondedEnrolled, color: "text-tertiary" },
            { label: "Completed", value: stats.completedEnrolled, color: "text-on-surface" },
            { label: "Removed", value: stats.removedEnrolled, color: "text-error" },
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
    </div>
  );
}
