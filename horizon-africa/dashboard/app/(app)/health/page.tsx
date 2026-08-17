"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Database,
  MessageSquare,
  Bot,
  Workflow,
  Radio,
  Globe,
  Clock,
  Bell,
  Loader2,
} from "lucide-react";

interface ServiceCheck {
  name: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number | null;
  message: string;
  details?: Record<string, unknown>;
}

interface HealthResponse {
  timestamp: string;
  overall: {
    status: "healthy" | "degraded" | "down";
    healthy: number;
    degraded: number;
    down: number;
    total: number;
  };
  services: ServiceCheck[];
  issues: {
    overdueFollowUps: number;
    failedBroadcasts: number;
    escalatedLeads: number;
    staleLeads: number;
  };
}

const statusConfig = {
  healthy: {
    icon: CheckCircle2,
    color: "text-secondary",
    bg: "bg-secondary-container/30",
    border: "border-secondary/30",
    label: "Healthy",
  },
  degraded: {
    icon: AlertTriangle,
    color: "text-primary",
    bg: "bg-primary-container/30",
    border: "border-primary/30",
    label: "Degraded",
  },
  down: {
    icon: XCircle,
    color: "text-error",
    bg: "bg-error-container/30",
    border: "border-error/30",
    label: "Down",
  },
};

const serviceIcons: Record<string, typeof Database> = {
  "Supabase Database": Database,
  "Meta WhatsApp API": Radio,
  "n8n Workflow Engine": Workflow,
  "OpenRouter AI": Bot,
  "Chatwoot Live Chat": MessageSquare,
  "WhatsApp Webhook Proxy": Globe,
};

export default function HealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401) {
          setError("You must be signed in to view system health.");
        } else {
          setError("Failed to fetch health data.");
        }
        setLoading(false);
        return;
      }
      const json: HealthResponse = await res.json();
      setData(json);
      setLastRefreshed(new Date());
    } catch {
      setError("Failed to fetch health data.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const overallConfig = data ? statusConfig[data.overall.status] : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">System Health</h1>
          <p className="text-sm text-on-surface-variant">
            Monitor the status of all integrated services and application health
          </p>
        </div>
        <button
          onClick={fetchHealth}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-xs font-semibold text-on-surface transition-all hover:bg-surface-container disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-error-container/50 bg-error-container/30 px-4 py-3 text-sm text-on-surface-variant">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex h-96 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-secondary" />
        </div>
      ) : data ? (
        <>
          {/* Overall Status Banner */}
          <div
            className={`card-shadow flex items-center gap-4 rounded-xl border ${overallConfig?.border ?? "border-outline-variant"} bg-surface-container-lowest p-6`}
          >
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-xl ${overallConfig?.bg}`}
            >
              {overallConfig && (
                <overallConfig.icon className={`h-7 w-7 ${overallConfig.color}`} />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-on-surface">
                  {data.overall.status === "healthy"
                    ? "All Systems Operational"
                    : data.overall.status === "degraded"
                    ? "Some Systems Degraded"
                    : "Critical Issues Detected"}
                </h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${overallConfig?.bg} ${overallConfig?.color}`}
                >
                  {overallConfig?.label}
                </span>
              </div>
              <p className="mt-1 text-sm text-on-surface-variant">
                {data.overall.healthy} healthy, {data.overall.degraded} degraded,{" "}
                {data.overall.down} down — of {data.overall.total} services checked
              </p>
            </div>
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
                Last Checked
              </p>
              <p className="mt-1 text-sm font-semibold text-on-surface">
                {lastRefreshed
                  ? lastRefreshed.toLocaleTimeString("en-ZA", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })
                  : "—"}
              </p>
            </div>
          </div>

          {/* Issues Summary */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <IssueCard
              label="Overdue Follow-Ups"
              value={data.issues.overdueFollowUps}
              icon={Clock}
              severity={data.issues.overdueFollowUps > 0 ? "warning" : "ok"}
            />
            <IssueCard
              label="Failed Broadcasts"
              value={data.issues.failedBroadcasts}
              icon={Radio}
              severity={data.issues.failedBroadcasts > 0 ? "error" : "ok"}
            />
            <IssueCard
              label="Pending Escalations"
              value={data.issues.escalatedLeads}
              icon={Bell}
              severity={data.issues.escalatedLeads > 0 ? "warning" : "ok"}
            />
            <IssueCard
              label="Stale Leads (3+ days)"
              value={data.issues.staleLeads}
              icon={Activity}
              severity={data.issues.staleLeads > 5 ? "warning" : "ok"}
            />
          </div>

          {/* Service Status Grid */}
          <div>
            <h2 className="mb-3 text-lg font-semibold text-on-surface">
              Service Status
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {data.services.map((service) => {
                const cfg = statusConfig[service.status];
                const ServiceIcon = serviceIcons[service.name] ?? Activity;
                const StatusIcon = cfg.icon;
                return (
                  <div
                    key={service.name}
                    className={`card-shadow rounded-xl border ${cfg.border} bg-surface-container-lowest p-5`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-surface-container-high p-2.5">
                          <ServiceIcon className="h-5 w-5 text-secondary" />
                        </div>
                        <div>
                          <p className="font-semibold text-on-surface">
                            {service.name}
                          </p>
                          <p className="mt-0.5 text-sm text-on-surface-variant">
                            {service.message}
                          </p>
                        </div>
                      </div>
                      <div
                        className={`flex items-center gap-1.5 rounded-full ${cfg.bg} px-3 py-1 text-xs font-semibold ${cfg.color}`}
                      >
                        <StatusIcon className="h-3.5 w-3.5" />
                        {cfg.label}
                      </div>
                    </div>

                    {/* Service Details */}
                    <div className="mt-4 flex items-center gap-4 text-xs text-on-surface-variant">
                      {service.latencyMs !== null && (
                        <span className="flex items-center gap-1">
                          <Activity className="h-3.5 w-3.5" />
                          {service.latencyMs}ms
                        </span>
                      )}
                      {service.details && Object.entries(service.details).map(([key, value]) => (
                        <span key={key} className="capitalize">
                          {key.replace(/([A-Z])/g, " $1").trim()}:{" "}
                          <span className="font-semibold text-on-surface">
                            {String(value)}
                          </span>
                        </span>
                      )).slice(0, 3)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Auto-refresh note */}
          <p className="text-center text-xs text-on-surface-variant">
            Health data is fetched on demand. Click Refresh to check again.
          </p>
        </>
      ) : null}
    </div>
  );
}

function IssueCard({
  label,
  value,
  icon: Icon,
  severity,
}: {
  label: string;
  value: number;
  icon: typeof Activity;
  severity: "ok" | "warning" | "error";
}) {
  const styles = {
    ok: { bg: "bg-secondary-container/20", color: "text-secondary", border: "border-secondary/20" },
    warning: { bg: "bg-primary-container/30", color: "text-primary", border: "border-primary/30" },
    error: { bg: "bg-error-container/30", color: "text-error", border: "border-error/30" },
  };
  const s = styles[severity];

  return (
    <div className={`card-shadow rounded-xl border ${s.border} bg-surface-container-lowest p-5`}>
      <div className="mb-3 flex items-center justify-between">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${s.bg}`}>
          <Icon className={`h-4.5 w-4.5 ${s.color}`} />
        </div>
        {severity !== "ok" && (
          <span className={`rounded-full ${s.bg} px-2 py-0.5 text-[10px] font-bold uppercase ${s.color}`}>
            {severity}
          </span>
        )}
      </div>
      <p className="text-3xl font-bold text-on-surface">{value}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-on-surface-variant">
        {label}
      </p>
    </div>
  );
}
