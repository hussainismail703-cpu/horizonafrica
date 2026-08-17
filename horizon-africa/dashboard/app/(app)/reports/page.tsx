"use client";

import { useState, useEffect, useCallback } from "react";
import { StatCard } from "@/components/stat-card";
import { ReportsCharts, ReportsData } from "@/components/reports-charts";
import {
  Users,
  Flame,
  MessageSquare,
  TrendingUp,
  AlertCircle,
  Send,
  Loader2,
} from "lucide-react";

type RangeKey = "week" | "month" | "quarter" | "year" | "all";

const rangeOptions: { key: RangeKey; label: string }[] = [
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "quarter", label: "This Quarter" },
  { key: "year", label: "This Year" },
  { key: "all", label: "All Time" },
];

const emptyData: ReportsData = {
  leadsOverTime: [],
  scoreDistribution: [],
  statusBreakdown: [],
  broadcastPerformance: [],
  productInterests: [],
  escalationRate: [],
};

interface ReportsResponse {
  kpis: {
    totalLeads: number;
    totalHot: number;
    totalConversations: number;
    totalBroadcasts: number;
    totalEscalated: number;
    conversionRate: number;
    escalationRate: number;
  };
  leadsOverTime: { date: string; leads: number; conversations: number }[];
  scoreDistribution: { name: string; value: number; color: string }[];
  statusBreakdown: { status: string; count: number }[];
  broadcastPerformance: {
    name: string;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
  }[];
  productInterests: { name: string; count: number }[];
  escalationRate: { type: string; count: number; color: string }[];
}

export default function ReportsPage() {
  const [range, setRange] = useState<RangeKey>("month");
  const [data, setData] = useState<ReportsData>(emptyData);
  const [kpis, setKpis] = useState({
    totalLeads: 0,
    totalHot: 0,
    totalConversations: 0,
    totalBroadcasts: 0,
    totalEscalated: 0,
    conversionRate: 0,
    escalationRate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (r: RangeKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports?range=${r}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401) {
          setError("You must be signed in to view reports.");
        } else {
          setError("Failed to load report data.");
        }
        setLoading(false);
        return;
      }
      const json: ReportsResponse = await res.json();
      setKpis(json.kpis);
      setData({
        leadsOverTime: json.leadsOverTime,
        scoreDistribution: json.scoreDistribution,
        statusBreakdown: json.statusBreakdown,
        broadcastPerformance: json.broadcastPerformance,
        productInterests: json.productInterests,
        escalationRate: json.escalationRate,
      });
    } catch {
      setError("Failed to load report data.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData(range);
  }, [range, fetchData]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Reports &amp; Analytics</h1>
          <p className="text-sm text-on-surface-variant">
            AI performance, lead conversion, and broadcast metrics for management
          </p>
        </div>

        {/* Date Range Selector */}
        <div className="flex items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest p-1">
          {rangeOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={`rounded-md px-3 py-2 text-xs font-semibold transition-all ${
                range === opt.key
                  ? "bg-secondary text-on-secondary shadow-sm"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-error-container/50 bg-error-container/30 px-4 py-3 text-sm text-on-surface-variant">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-96 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-secondary" />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total Leads"
              value={kpis.totalLeads}
              icon={Users}
              iconBg="bg-surface-container-high"
              iconColor="text-secondary"
            />
            <StatCard
              label="Hot Leads"
              value={kpis.totalHot}
              icon={Flame}
              iconBg="bg-secondary-container/20"
              iconColor="text-secondary"
            />
            <StatCard
              label="AI Conversations"
              value={kpis.totalConversations}
              icon={MessageSquare}
              iconBg="bg-secondary-container/30"
              iconColor="text-secondary"
            />
            <StatCard
              label="Conversion Rate"
              value={`${kpis.conversionRate}%`}
              icon={TrendingUp}
              iconBg="bg-tertiary-container/30"
              iconColor="text-tertiary"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Escalated to Human"
              value={kpis.totalEscalated}
              icon={AlertCircle}
              iconBg="bg-primary-container/30"
              iconColor="text-primary"
            />
            <StatCard
              label="Escalation Rate"
              value={`${kpis.escalationRate}%`}
              icon={AlertCircle}
              iconBg="bg-primary-container/30"
              iconColor="text-primary"
            />
            <StatCard
              label="Broadcasts Sent"
              value={kpis.totalBroadcasts}
              icon={Send}
              iconBg="bg-tertiary-container/30"
              iconColor="text-tertiary"
            />
          </div>

          {/* Charts */}
          <ReportsCharts data={data} />
        </>
      )}
    </div>
  );
}
