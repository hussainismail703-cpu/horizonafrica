"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export interface ReportsData {
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

const CHART_COLORS = {
  primary: "#f06000",
  secondary: "#002050",
  tertiary: "#005fa8",
  hot: "#002050",
  warm: "#b9c6ea",
  cold: "#dae2fd",
  success: "#005fa8",
  warning: "#f06000",
  error: "#ba1a1a",
};

const tooltipStyle = {
  backgroundColor: "#ffffff",
  border: "1px solid #b9c6ea",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#001040",
};

export function ReportsCharts({ data }: { data: ReportsData }) {
  return (
    <div className="space-y-6">
      {/* Leads & Conversations Over Time */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h3 className="mb-1 text-lg font-semibold text-on-surface">
          Leads &amp; Conversations Trend
        </h3>
        <p className="mb-5 text-xs text-on-surface-variant">
          Daily new leads and AI conversations over the last 30 days
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data.leadsOverTime}>
            <defs>
              <linearGradient id="leadGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS.secondary} stopOpacity={0.3} />
                <stop offset="95%" stopColor={CHART_COLORS.secondary} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
                <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#dae2fd" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#2a3349" }}
              tickLine={false}
              axisLine={{ stroke: "#b9c6ea" }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#2a3349" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 10 }}
              iconType="circle"
            />
            <Area
              type="monotone"
              dataKey="leads"
              name="New Leads"
              stroke={CHART_COLORS.secondary}
              strokeWidth={2}
              fill="url(#leadGrad)"
            />
            <Area
              type="monotone"
              dataKey="conversations"
              name="Conversations"
              stroke={CHART_COLORS.primary}
              strokeWidth={2}
              fill="url(#convGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Lead Score Distribution - Donut */}
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
          <h3 className="mb-1 text-lg font-semibold text-on-surface">
            Lead Score Distribution
          </h3>
          <p className="mb-5 text-xs text-on-surface-variant">
            Breakdown of all leads by AI-assigned score
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={data.scoreDistribution}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={95}
                paddingAngle={3}
                dataKey="value"
                nameKey="name"
              >
                {data.scoreDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                iconType="circle"
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Lead Status Funnel */}
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
          <h3 className="mb-1 text-lg font-semibold text-on-surface">
            Lead Status Pipeline
          </h3>
          <p className="mb-5 text-xs text-on-surface-variant">
            Current status of all leads in the funnel
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.statusBreakdown} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#dae2fd" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "#2a3349" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="status"
                tick={{ fontSize: 11, fill: "#2a3349" }}
                tickLine={false}
                axisLine={{ stroke: "#b9c6ea" }}
                width={90}
              />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#eaedff" }} />
              <Bar
                dataKey="count"
                name="Leads"
                fill={CHART_COLORS.tertiary}
                radius={[0, 6, 6, 0]}
                barSize={28}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Broadcast Performance */}
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
          <h3 className="mb-1 text-lg font-semibold text-on-surface">
            Broadcast Campaign Performance
          </h3>
          <p className="mb-5 text-xs text-on-surface-variant">
            Sent vs delivered vs read vs failed for each campaign
          </p>
          {data.broadcastPerformance.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.broadcastPerformance}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dae2fd" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: "#2a3349" }}
                  tickLine={false}
                  axisLine={{ stroke: "#b9c6ea" }}
                  angle={-15}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#2a3349" }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#eaedff" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                <Bar dataKey="sent" name="Sent" fill={CHART_COLORS.secondary} radius={[4, 4, 0, 0]} barSize={20} />
                <Bar dataKey="delivered" name="Delivered" fill={CHART_COLORS.tertiary} radius={[4, 4, 0, 0]} barSize={20} />
                <Bar dataKey="read" name="Read" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} barSize={20} />
                <Bar dataKey="failed" name="Failed" fill={CHART_COLORS.error} radius={[4, 4, 0, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[280px] items-center justify-center text-sm text-on-surface-variant">
              No broadcast campaigns yet.
            </div>
          )}
        </div>

        {/* Product Interests */}
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
          <h3 className="mb-1 text-lg font-semibold text-on-surface">
            Top Product Interests
          </h3>
          <p className="mb-5 text-xs text-on-surface-variant">
            What leads are most interested in
          </p>
          {data.productInterests.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.productInterests} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#dae2fd" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "#2a3349" }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#2a3349" }}
                  tickLine={false}
                  axisLine={{ stroke: "#b9c6ea" }}
                  width={120}
                />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#eaedff" }} />
                <Bar
                  dataKey="count"
                  name="Leads"
                  fill={CHART_COLORS.primary}
                  radius={[0, 6, 6, 0]}
                  barSize={24}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[280px] items-center justify-center text-sm text-on-surface-variant">
              No product interest data yet.
            </div>
          )}
        </div>
      </div>

      {/* AI Handover / Escalation Rate */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h3 className="mb-1 text-lg font-semibold text-on-surface">
          AI Handover &amp; Escalation Summary
        </h3>
        <p className="mb-5 text-xs text-on-surface-variant">
          How often the AI escalates conversations to human agents
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data.escalationRate}
              cx="50%"
              cy="50%"
              outerRadius={90}
              dataKey="count"
              nameKey="type"
              label={({ type, count }) => `${type}: ${count}`}
              labelLine={false}
            >
              {data.escalationRate.map((entry, index) => (
                <Cell key={`esc-cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
