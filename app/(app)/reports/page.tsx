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
  ordersByTrack: {
    track: "stock_on_hand" | "imported";
    label: string;
    total: number;
    paid: number;
    inProgress: number;
    handedToOrders: number;
    revenueCents: number;
  }[];
  followUpConversion: {
    track: "stock_on_hand" | "imported";
    entered: number;
    converted: number;
    rate: number;
  }[];
  handovers: { inRange: number; active: number };
  optOuts: { inRange: number; total: number };
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
  const [ordersByTrack, setOrdersByTrack] = useState<ReportsResponse["ordersByTrack"]>([]);
  const [followUpConversion, setFollowUpConversion] = useState<ReportsResponse["followUpConversion"]>([]);
  const [handovers, setHandovers] = useState({ inRange: 0, active: 0 });
  const [optOuts, setOptOuts] = useState({ inRange: 0, total: 0 });
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
      setOrdersByTrack(json.ordersByTrack ?? []);
      setFollowUpConversion(json.followUpConversion ?? []);
      setHandovers(json.handovers ?? { inRange: 0, active: 0 });
      setOptOuts(json.optOuts ?? { inRange: 0, total: 0 });
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

          {/* Orders by track — stock-on-hand and imported are reported
              separately per scope freeze §6; metrics per §8 */}
          {ordersByTrack.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {ordersByTrack.map((t) => {
                const fu = followUpConversion.find((f) => f.track === t.track);
                return (
                  <div
                    key={t.track}
                    className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-5"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-on-surface">{t.label} orders</h3>
                      <span className="text-xs text-on-surface-variant">{t.total} created</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <p className="text-lg font-bold text-on-surface">{t.paid}</p>
                        <p className="text-[11px] text-on-surface-variant">Paid</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-on-surface">
                          {t.track === "imported" ? t.handedToOrders : t.inProgress}
                        </p>
                        <p className="text-[11px] text-on-surface-variant">
                          {t.track === "imported" ? "With orders team" : "Awaiting payment"}
                        </p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-on-surface">
                          R{(t.revenueCents / 100).toFixed(0)}
                        </p>
                        <p className="text-[11px] text-on-surface-variant">Revenue</p>
                      </div>
                    </div>
                    <div className="mt-3 border-t border-outline-variant/40 pt-3 text-center">
                      <p className="text-lg font-bold text-on-surface">
                        {fu ? `${fu.converted}/${fu.entered}` : "0/0"}
                        <span className="ml-1 text-xs font-normal text-on-surface-variant">
                          ({fu?.rate ?? 0}%)
                        </span>
                      </p>
                      <p className="text-[11px] text-on-surface-variant">
                        Follow-up conversions (unpaid → paid)
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* §8 Handover + Opt-out metrics */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-5">
              <h3 className="text-sm font-semibold text-on-surface">Human handovers</h3>
              <div className="mt-3 grid grid-cols-2 gap-3 text-center">
                <div>
                  <p className="text-lg font-bold text-on-surface">{handovers.inRange}</p>
                  <p className="text-[11px] text-on-surface-variant">In period</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-on-surface">{handovers.active}</p>
                  <p className="text-[11px] text-on-surface-variant">Active now</p>
                </div>
              </div>
            </div>
            <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-5">
              <h3 className="text-sm font-semibold text-on-surface">Opt-outs</h3>
              <div className="mt-3 grid grid-cols-2 gap-3 text-center">
                <div>
                  <p className="text-lg font-bold text-on-surface">{optOuts.inRange}</p>
                  <p className="text-[11px] text-on-surface-variant">In period</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-on-surface">{optOuts.total}</p>
                  <p className="text-[11px] text-on-surface-variant">Total opted out</p>
                </div>
              </div>
            </div>
          </div>

          {/* Charts */}
          <ReportsCharts data={data} />
        </>
      )}
    </div>
  );
}
