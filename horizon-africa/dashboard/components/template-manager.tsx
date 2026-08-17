"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Template } from "@/lib/types";
import {
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Send,
  AlertCircle,
  ArrowUpDown,
  Filter,
} from "lucide-react";

const CATEGORIES = [
  { value: "MARKETING", label: "Marketing" },
  { value: "UTILITY", label: "Utility" },
  { value: "AUTHENTICATION", label: "Authentication" },
];

const LANGUAGES = [
  { value: "en_US", label: "English (US)" },
  { value: "en_GB", label: "English (UK)" },
  { value: "af_ZA", label: "Afrikaans" },
  { value: "zu_ZA", label: "Zulu" },
];

const STATUS_CONFIG = {
  approved: {
    icon: CheckCircle2,
    color: "text-secondary",
    bg: "bg-secondary-container/30",
    label: "Approved",
  },
  pending: {
    icon: Clock,
    color: "text-amber-600",
    bg: "bg-amber-50",
    label: "Pending Review",
  },
  rejected: {
    icon: XCircle,
    color: "text-error",
    bg: "bg-error-container/30",
    label: "Rejected",
  },
};

function getStatusConfig(status: string) {
  return (
    STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? {
      icon: AlertCircle,
      color: "text-on-surface-variant",
      bg: "bg-surface-container-high",
      label: status.charAt(0).toUpperCase() + status.slice(1),
    }
  );
}

export function TemplateManager() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("name");

  // Form fields
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en_US");
  const [category, setCategory] = useState("MARKETING");
  const [bodyText, setBodyText] = useState("");
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [bodyExample, setBodyExample] = useState("");
  const [headerExample, setHeaderExample] = useState("");

  const hasBodyParams = /\{\{\d+\}\}/.test(bodyText);
  const hasHeaderParams = /\{\{\d+\}\}/.test(headerText);

  // Track status changes for notifications
  const [prevStatuses, setPrevStatuses] = useState<Record<string, string>>({});
  const [statusChanges, setStatusChanges] = useState<
    Array<{ name: string; from: string; to: string }>
  >([]);

  const fetchTemplates = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch("/api/broadcasts/templates");
      if (res.ok) {
        const data = await res.json();
        const newTemplates: Template[] = data.templates ?? [];
        setTemplates(newTemplates);

        // Detect status changes
        const newStatuses: Record<string, string> = {};
        newTemplates.forEach((t) => {
          newStatuses[t.name] = t.status;
        });

        if (Object.keys(prevStatuses).length > 0) {
          const changes: Array<{ name: string; from: string; to: string }> = [];
          newTemplates.forEach((t) => {
            const prev = prevStatuses[t.name];
            if (prev && prev !== t.status) {
              changes.push({ name: t.name, from: prev, to: t.status });
            }
          });
          if (changes.length > 0) {
            setStatusChanges(changes);
          }
        }

        setPrevStatuses(newStatuses);
        setLastRefresh(new Date());
        if (isManual) toast.success("Templates refreshed");
      } else if (isManual) {
        toast.error("Failed to refresh templates");
      }
    } catch {
      if (isManual) toast.error("Network error refreshing templates");
    }
    setLoading(false);
    setRefreshing(false);
  }, [prevStatuses]);

  // Initial fetch
  useEffect(() => {
    fetchTemplates();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-poll every 15 seconds for status updates
  useEffect(() => {
    const interval = setInterval(() => {
      fetchTemplates();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchTemplates]);

  async function submitTemplate() {
    if (!name || !bodyText) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    setStatusChanges([]);

    try {
      const res = await fetch("/api/broadcasts/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim().toLowerCase().replace(/\s+/g, "_"),
          language,
          category,
          body_text: bodyText,
          header_text: headerText || undefined,
          footer_text: footerText || undefined,
          body_example: hasBodyParams && bodyExample.trim()
            ? bodyExample.split(",").map((s) => s.trim())
            : undefined,
          header_example: hasHeaderParams && headerExample.trim()
            ? headerExample.trim()
            : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to submit template");
        toast.error(data.error ?? "Failed to submit template");
      } else {
        setSuccess(
          `Template "${name}" submitted to Meta for review. Status will update automatically.`
        );
        toast.success(`Template "${name}" submitted to Meta for review`);
        // Reset form
        setName("");
        setBodyText("");
        setHeaderText("");
        setFooterText("");
        setBodyExample("");
        setHeaderExample("");
        setShowForm(false);
        // Immediately refresh templates
        fetchTemplates();
      }
    } catch {
      setError("Network error submitting template");
      toast.error("Network error submitting template");
    }

    setSubmitting(false);
  }

  const filteredTemplates = templates
    .filter((t) => statusFilter === "all" || t.status === statusFilter)
    .filter((t) => categoryFilter === "all" || t.category === categoryFilter)
    .sort((a, b) => {
      switch (sortBy) {
        case "name_desc":
          return b.label.localeCompare(a.label);
        case "status":
          const order: Record<string, number> = { approved: 0, pending: 1, rejected: 2 };
          return (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.label.localeCompare(b.label);
        case "category":
          return a.category.localeCompare(b.category) || a.label.localeCompare(b.label);
        default:
          return a.label.localeCompare(b.label);
      }
    });

  const pendingCount = templates.filter((t) => t.status === "pending").length;

  return (
    <div className="space-y-6">
      {/* Status Change Notifications */}
      {statusChanges.length > 0 && (
        <div className="rounded-xl border border-secondary/30 bg-secondary-container/10 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-secondary">
            <AlertCircle className="h-4 w-4" />
            Template Status Updates
          </div>
          <div className="mt-2 space-y-1">
            {statusChanges.map((change, i) => {
              const config = getStatusConfig(change.to);
              return (
                <p key={i} className="text-sm text-on-surface-variant">
                  <span className="font-medium">{change.name}</span> changed from{" "}
                  <span className="capitalize">{change.from}</span> to{" "}
                  <span className={`font-semibold ${config.color}`}>
                    {config.label}
                  </span>
                </p>
              );
            })}
          </div>
          <button
            onClick={() => setStatusChanges([])}
            className="mt-2 text-xs text-on-surface-variant hover:text-on-surface"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header + Actions */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-on-surface">
              WhatsApp Templates
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              Create and submit message templates for Meta approval
              {pendingCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-600">
                  <Clock className="h-3 w-3" />
                  {pendingCount} pending
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchTemplates(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-2 text-xs font-semibold text-on-surface-variant transition hover:bg-surface-container disabled:opacity-50"
              title="Refresh templates"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary shadow-sm transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              New Template
            </button>
          </div>
        </div>

        {lastRefresh && (
          <p className="mt-2 text-xs text-on-surface-variant/60">
            Last updated: {lastRefresh.toLocaleTimeString()} · Auto-refreshing
            every 15s
          </p>
        )}
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
          <h3 className="mb-4 text-base font-semibold text-on-surface">
            Create New Template
          </h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Template Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. horizon_followup_v2"
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/10"
              />
              <p className="mt-1 text-xs text-on-surface-variant">
                Use snake_case. Spaces will be converted to underscores.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Language
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm focus:border-secondary focus:outline-none"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm focus:border-secondary focus:outline-none"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Header (optional)
              </label>
              <input
                type="text"
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                placeholder="e.g. Welcome to Horizon Africa"
                maxLength={60}
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/10"
              />
              {hasHeaderParams && (
                <input
                  type="text"
                  value={headerExample}
                  onChange={(e) => setHeaderExample(e.target.value)}
                  placeholder="Header example value (e.g. Summer Sale)"
                  className="mt-2 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/10"
                />
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Body Text
              </label>
              <textarea
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder="Hi {{1}}, we saved the {{2}} package we discussed. Still thinking it over? Just reply here and we will pick up where we left off."
                rows={4}
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/10"
              />
              <p className="mt-1 text-xs text-on-surface-variant">
                Use {"{{1}}"}, {"{{2}}"}, etc. for variable placeholders.
              </p>
            </div>

            {hasBodyParams && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Body Example Values <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  value={bodyExample}
                  onChange={(e) => setBodyExample(e.target.value)}
                  placeholder="e.g. John, Premium Fiber"
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/10"
                />
                <p className="mt-1 text-xs text-on-surface-variant">
                  Comma-separated sample values for each variable. Required by Meta for approval.
                </p>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Footer (optional)
              </label>
              <input
                type="text"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder="e.g. — Horizon Africa"
                maxLength={60}
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/10"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-error-container/30 px-4 py-3 text-sm text-error">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="flex items-start gap-2 rounded-lg bg-secondary-container/20 px-4 py-3 text-sm text-secondary">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{success}</span>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={submitTemplate}
                disabled={submitting || !name || !bodyText || (hasBodyParams && !bodyExample.trim())}
                className="flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-on-primary shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Submit to Meta
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  setError(null);
                  setSuccess(null);
                }}
                className="rounded-lg border border-outline-variant px-6 py-2.5 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Templates List */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-on-surface">
            All Templates
            <span className="ml-2 text-sm font-normal text-on-surface-variant">
              ({filteredTemplates.length}{filteredTemplates.length !== templates.length ? ` of ${templates.length}` : ""})
            </span>
          </h3>
        </div>

        {/* Filter & Sort Controls */}
        {!loading && templates.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-outline-variant bg-surface-container-low p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              <Filter className="h-3.5 w-3.5" />
              Filter
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs focus:border-secondary focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs focus:border-secondary focus:outline-none"
            >
              <option value="all">All Categories</option>
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utility</option>
              <option value="AUTHENTICATION">Authentication</option>
            </select>
            <div className="ml-auto flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              <ArrowUpDown className="h-3.5 w-3.5" />
              Sort
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs focus:border-secondary focus:outline-none"
            >
              <option value="name">Name (A-Z)</option>
              <option value="name_desc">Name (Z-A)</option>
              <option value="status">Status</option>
              <option value="category">Category</option>
            </select>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-on-surface-variant" />
          </div>
        ) : templates.length === 0 ? (
          <p className="py-8 text-center text-sm text-on-surface-variant">
            No templates found. Create one to get started.
          </p>
        ) : filteredTemplates.length === 0 ? (
          <p className="py-8 text-center text-sm text-on-surface-variant">
            No templates match the current filters.
          </p>
        ) : (
          <div className="space-y-3">
            {filteredTemplates.map((t) => {
              const config = getStatusConfig(t.status);
              const StatusIcon = config.icon;
              return (
                <div
                  key={t.name}
                  className="rounded-lg border border-outline-variant/50 bg-surface-container-low p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold text-on-surface">
                          {t.label}
                        </p>
                        <span className="text-xs text-on-surface-variant/60">
                          ({t.name})
                        </span>
                      </div>
                      {t.body_text && (
                        <p className="mt-1.5 text-sm text-on-surface-variant line-clamp-2">
                          {t.body_text}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
                        <span className="rounded bg-surface-container-high px-2 py-0.5">
                          {t.language}
                        </span>
                        <span className="rounded bg-surface-container-high px-2 py-0.5">
                          {t.category}
                        </span>
                      </div>
                    </div>
                    <div
                      className={`flex shrink-0 items-center gap-1.5 rounded-full ${config.bg} px-3 py-1 text-xs font-semibold ${config.color}`}
                    >
                      <StatusIcon className="h-3.5 w-3.5" />
                      {config.label}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
