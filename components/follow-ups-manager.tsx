"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Lead, OrderFollowUp } from "@/lib/types";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import {
  Bell,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  ShoppingBag,
} from "lucide-react";

interface OrderNudge extends OrderFollowUp {
  orders: { order_number: number; status: string } | null;
}

interface FollowUpsManagerProps {
  initialLeads: Lead[];
  orderNudges?: OrderNudge[];
}

interface SendResult {
  processed: number;
  sent: number;
  failed: number;
  errors: string[];
}

function getStatusBadge(lead: Lead) {
  if (lead.follow_up_sent) {
    return {
      label: "Sent",
      icon: CheckCircle2,
      color: "text-green-700",
      bg: "bg-green-100",
    };
  }
  const isOverdue =
    lead.follow_up_date && new Date(lead.follow_up_date) < new Date();
  if (isOverdue) {
    return {
      label: "Overdue",
      icon: AlertCircle,
      color: "text-red-700",
      bg: "bg-red-100",
    };
  }
  return {
    label: "Pending",
    icon: Clock,
    color: "text-amber-700",
    bg: "bg-amber-100",
  };
}

const NUDGE_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "Scheduled", color: "text-amber-700", bg: "bg-amber-100" },
  sending: { label: "Sending", color: "text-blue-700", bg: "bg-blue-100" },
  sent: { label: "Sent", color: "text-green-700", bg: "bg-green-100" },
  failed: { label: "Failed", color: "text-red-700", bg: "bg-red-100" },
  cancelled: { label: "Stopped", color: "text-on-surface-variant", bg: "bg-surface-container-high" },
};

export function FollowUpsManager({ initialLeads, orderNudges = [] }: FollowUpsManagerProps) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [sending, setSending] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshLeads = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch("/api/leads?follow_up=true", {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads ?? data ?? []);
        setLastRefresh(new Date());
        if (isManual) toast.success("Follow-ups refreshed");
      } else if (isManual) {
        toast.error("Failed to refresh follow-ups");
      }
    } catch {
      if (isManual) toast.error("Network error refreshing follow-ups");
    }
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const interval = setInterval(refreshLeads, 30000);
    return () => clearInterval(interval);
  }, [refreshLeads]);

  async function sendAllFollowUps() {
    setSending(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/follow-ups/send", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to send follow-ups");
        toast.error(data.error ?? "Failed to send follow-ups");
      } else {
        setResult(data);
        toast.success(`Follow-ups sent: ${data.sent} sent, ${data.failed} failed`);
        await refreshLeads();
      }
    } catch {
      setError("Network error sending follow-ups");
      toast.error("Network error sending follow-ups");
    }

    setSending(false);
  }

  async function sendSingleFollowUp(leadId: number) {
    setSendingId(leadId);
    setError(null);

    try {
      const res = await fetch("/api/follow-ups/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to send follow-up");
        toast.error(data.error ?? "Failed to send follow-up");
      } else {
        toast.success("Follow-up sent");
        await refreshLeads();
      }
    } catch {
      setError("Network error sending follow-up");
      toast.error("Network error sending follow-up");
    }

    setSendingId(null);
  }

  const pendingCount = leads.filter(
    (l) => !l.follow_up_sent && l.follow_up_date && new Date(l.follow_up_date) > new Date()
  ).length;
  const overdueCount = leads.filter(
    (l) => !l.follow_up_sent && l.follow_up_date && new Date(l.follow_up_date) <= new Date()
  ).length;
  const sentCount = leads.filter((l) => l.follow_up_sent).length;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Pending
              </p>
              <p className="text-2xl font-bold text-on-surface">{pendingCount}</p>
            </div>
          </div>
        </div>
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Overdue
              </p>
              <p className="text-2xl font-bold text-on-surface">{overdueCount}</p>
            </div>
          </div>
        </div>
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Sent
              </p>
              <p className="text-2xl font-bold text-on-surface">{sentCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-on-surface">Follow-Up Reminders</h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              Send WhatsApp reminders to leads who asked for time to decide
              {lastRefresh && (
                <span className="ml-2 text-xs text-on-surface-variant/60">
                  · Last updated: {formatTime(lastRefresh)} · Auto-refreshing every 30s
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshLeads(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-2 text-xs font-semibold text-on-surface-variant transition hover:bg-surface-container disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={sendAllFollowUps}
              disabled={sending || overdueCount === 0}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send Follow-Ups Now
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-semibold">Follow-Ups Processed</span>
            </div>
            <div className="mt-2 space-y-1 text-on-surface-variant">
              <p>Processed: {result.processed}</p>
              <p>Sent: {result.sent}</p>
              {result.failed > 0 && <p className="text-red-700">Failed: {result.failed}</p>}
              {result.errors.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-xs text-red-700">
                  {result.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Follow-Ups Table */}
      <div className="card-shadow overflow-x-auto rounded-xl border border-surface-variant bg-surface-container-lowest">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outline-variant bg-surface-container-low text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              <th className="px-5 py-4">Name</th>
              <th className="px-5 py-4">Phone</th>
              <th className="px-5 py-4">Item</th>
              <th className="px-5 py-4">Follow-Up Date</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.length > 0 ? (
              leads.map((lead) => {
                const status = getStatusBadge(lead);
                const StatusIcon = status.icon;
                const canSend = !lead.follow_up_sent;
                return (
                  <tr
                    key={lead.id}
                    className="border-b border-outline-variant/30 transition hover:bg-surface-container-low last:border-0"
                  >
                    <td className="px-5 py-3.5 text-on-surface">
                      {lead.full_name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-on-surface-variant">
                      {lead.phone_number}
                    </td>
                    <td className="px-5 py-3.5 text-on-surface-variant">
                      {lead.offered_package ?? lead.product_interest ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-on-surface-variant">
                      {formatDate(lead.follow_up_date)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${status.bg} ${status.color}`}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {status.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {canSend ? (
                        <button
                          onClick={() => sendSingleFollowUp(lead.id)}
                          disabled={sendingId === lead.id}
                          className="flex items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-semibold text-on-surface-variant transition hover:bg-surface-container disabled:opacity-50"
                        >
                          {sendingId === lead.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Send className="h-3 w-3" />
                          )}
                          Send Now
                        </button>
                      ) : (
                        <span className="text-xs text-on-surface-variant/60">
                          {lead.follow_up_sent_at
                            ? formatDate(lead.follow_up_sent_at)
                            : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-on-surface-variant">
                  <Bell className="mx-auto mb-2 h-8 w-8 opacity-30" />
                  No follow-ups scheduled. Schedule a follow-up from a lead&apos;s detail view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Order Payment Reminders */}
      <div className="card-shadow overflow-x-auto rounded-xl border border-surface-variant bg-surface-container-lowest">
        <div className="flex items-center gap-3 border-b border-outline-variant bg-surface-container-low px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShoppingBag className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-on-surface">Order Payment Reminders</h2>
            <p className="text-xs text-on-surface-variant">
              Automated nudges for orders still awaiting payment
            </p>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outline-variant bg-surface-container-low text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              <th className="px-5 py-4">Phone</th>
              <th className="px-5 py-4">Order</th>
              <th className="px-5 py-4">Nudge</th>
              <th className="px-5 py-4">Scheduled</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4">Error</th>
            </tr>
          </thead>
          <tbody>
            {orderNudges.length > 0 ? (
              orderNudges.map((nudge) => {
                const badge = NUDGE_STATUS[nudge.status] ?? NUDGE_STATUS.pending;
                return (
                  <tr
                    key={nudge.id}
                    className="border-b border-outline-variant/30 transition hover:bg-surface-container-low last:border-0"
                  >
                    <td className="px-5 py-3.5 text-on-surface">{nudge.phone_number}</td>
                    <td className="px-5 py-3.5 text-on-surface-variant">
                      {nudge.orders?.order_number
                        ? `#${nudge.orders.order_number}`
                        : "—"}
                    </td>
                    <td className="px-5 py-3.5 text-on-surface-variant">
                      #{nudge.sequence_step} · {nudge.template_name}
                    </td>
                    <td className="px-5 py-3.5 text-on-surface-variant">
                      {formatDateTime(nudge.scheduled_for)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${badge.bg} ${badge.color}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-red-700">
                      {nudge.error ?? ""}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-on-surface-variant">
                  <ShoppingBag className="mx-auto mb-2 h-8 w-8 opacity-30" />
                  No order payment reminders. They are scheduled automatically when an order is created.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
