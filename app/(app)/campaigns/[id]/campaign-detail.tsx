"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Campaign, CampaignStep, CampaignStatus } from "@/lib/types";
import {
  Loader2,
  Plus,
  Trash2,
  Save,
  Play,
  Pause,
  Square,
  ArrowLeft,
  Users,
  ScrollText,
} from "lucide-react";
import Link from "next/link";

interface CampaignDetailProps {
  campaign: Campaign;
  initialSteps: CampaignStep[];
}

interface Template {
  name: string;
  label: string;
  status: string;
}

const STATUS_OPTIONS: CampaignStatus[] = [
  "draft",
  "active",
  "paused",
  "completed",
  "stopped",
];

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: "bg-surface-container-high text-on-surface-variant",
  active: "bg-secondary-container/40 text-secondary",
  paused: "bg-primary-container/40 text-on-primary-container",
  completed: "bg-tertiary-container/40 text-on-tertiary",
  stopped: "bg-error-container/40 text-on-error",
};

interface StepRow {
  id?: string;
  step_number: number;
  delay_days: number;
  template_name: string;
}

export function CampaignDetail({ campaign, initialSteps }: CampaignDetailProps) {
  const router = useRouter();
  const [name, setName] = useState(campaign.name);
  const [objective, setObjective] = useState(campaign.objective ?? "");
  const [startDate, setStartDate] = useState(
    campaign.start_date ? campaign.start_date.slice(0, 10) : ""
  );
  const [endDate, setEndDate] = useState(
    campaign.end_date ? campaign.end_date.slice(0, 10) : ""
  );
  const [status, setStatus] = useState<CampaignStatus>(campaign.status);
  const [steps, setSteps] = useState<StepRow[]>(
    initialSteps.map((s) => ({
      id: s.id,
      step_number: s.step_number,
      delay_days: s.delay_days,
      template_name: s.template_name,
    }))
  );
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [savingMeta, setSavingMeta] = useState(false);
  const [savingSteps, setSavingSteps] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/broadcasts/templates");
      if (res.ok) {
        const data = await res.json();
        if (data.templates && data.templates.length > 0) {
          const approved = data.templates.filter(
            (t: Template) => t.status === "approved"
          );
          setTemplates(approved.length > 0 ? approved : data.templates);
        }
      }
    } catch {
      // keep empty list
    }
    setTemplatesLoading(false);
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  function addStep() {
    const nextNum = steps.length === 0 ? 1 : Math.max(...steps.map((s) => s.step_number)) + 1;
    setSteps([
      ...steps,
      {
        step_number: nextNum,
        delay_days: steps.length === 0 ? 0 : 1,
        template_name: templates[0]?.name ?? "",
      },
    ]);
  }

  function removeStep(idx: number) {
    setSteps(
      steps
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, step_number: i + 1 }))
    );
  }

  function updateStep(idx: number, patch: Partial<StepRow>) {
    setSteps(steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  async function saveMetadata() {
    setSavingMeta(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          objective: objective.trim() || null,
          start_date: startDate ? new Date(startDate).toISOString() : null,
          end_date: endDate ? new Date(endDate).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to save campaign");
        return;
      }
      toast.success("Campaign saved");
      router.refresh();
    } catch {
      toast.error("Network error saving campaign");
    } finally {
      setSavingMeta(false);
    }
  }

  async function saveSteps() {
    if (steps.some((s) => !s.template_name)) {
      toast.error("Every step needs a template");
      return;
    }
    setSavingSteps(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/steps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: steps.map((s) => ({
            step_number: s.step_number,
            delay_days: s.delay_days,
            template_name: s.template_name,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to save sequence");
        return;
      }
      toast.success("Sequence saved");
      router.refresh();
    } catch {
      toast.error("Network error saving sequence");
    } finally {
      setSavingSteps(false);
    }
  }

  async function updateStatus(newStatus: CampaignStatus) {
    if (newStatus === "stopped") {
      if (
        !confirm(
          "Are you sure you want to stop this campaign? Enrolled contacts will no longer receive messages."
        )
      ) {
        return;
      }
    }
    if (newStatus === "active" && steps.length === 0) {
      toast.error("Add at least one step before activating");
      return;
    }
    setStatusUpdating(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to update status");
        return;
      }
      setStatus(newStatus);
      toast.success(`Campaign ${newStatus}`);
      router.refresh();
    } catch {
      toast.error("Network error updating status");
    } finally {
      setStatusUpdating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/campaigns"
          className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant hover:text-on-surface"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Campaigns
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href={`/campaigns/${campaign.id}/enrolments`}
            className="flex items-center gap-1.5 rounded-lg bg-surface-container-high px-3 py-1.5 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-highest"
          >
            <Users className="h-3.5 w-3.5" />
            Enrolments
          </Link>
          <Link
            href={`/campaigns/${campaign.id}/audit`}
            className="flex items-center gap-1.5 rounded-lg bg-surface-container-high px-3 py-1.5 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-highest"
          >
            <ScrollText className="h-3.5 w-3.5" />
            Audit Trail
          </Link>
          <span
            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[status]}`}
          >
            {status}
          </span>
        </div>
      </div>

      {/* Metadata */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h2 className="mb-5 text-lg font-semibold text-on-surface">Campaign Details</h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className="w-full rounded-lg border border-surface-variant bg-surface px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Objective
            </label>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-surface-variant bg-surface px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-surface-variant bg-surface px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg border border-surface-variant bg-surface px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            onClick={saveMetadata}
            disabled={savingMeta}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-on-primary shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
          >
            {savingMeta && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Details
          </button>
        </div>
      </div>

      {/* Sequence Builder */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-on-surface">Message Sequence</h2>
          <button
            onClick={addStep}
            className="flex items-center gap-2 rounded-lg bg-surface-container-high px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-highest"
          >
            <Plus className="h-4 w-4" />
            Add Step
          </button>
        </div>

        {steps.length === 0 ? (
          <p className="py-8 text-center text-sm text-on-surface-variant">
            No steps yet. Click &quot;Add Step&quot; to build your follow-up sequence.
          </p>
        ) : (
          <div className="space-y-3">
            {steps.map((step, idx) => (
              <div
                key={idx}
                className="flex flex-col gap-3 rounded-lg border border-surface-variant bg-surface-container-low p-4 sm:flex-row sm:items-center"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {step.step_number}
                </div>
                <div className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr]">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
                      Delay (days)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={step.delay_days}
                      onChange={(e) =>
                        updateStep(idx, {
                          delay_days: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="w-full rounded-lg border border-surface-variant bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
                      WhatsApp Template
                    </label>
                    <select
                      value={step.template_name}
                      onChange={(e) =>
                        updateStep(idx, { template_name: e.target.value })
                      }
                      disabled={templatesLoading}
                      className="w-full rounded-lg border border-surface-variant bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                    >
                      {templatesLoading && <option value="">Loading templates…</option>}
                      {!templatesLoading && templates.length === 0 && (
                        <option value="">No templates available</option>
                      )}
                      {templates.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  onClick={() => removeStep(idx)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-lg text-on-surface-variant transition-colors hover:bg-error-container/30 hover:text-error sm:self-center"
                  aria-label="Remove step"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="flex justify-end pt-2">
              <button
                onClick={saveSteps}
                disabled={savingSteps}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-on-primary shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
              >
                {savingSteps ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Sequence
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Status Controls */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h2 className="mb-5 text-lg font-semibold text-on-surface">Campaign Status</h2>
        <div className="flex flex-wrap gap-3">
          {status !== "active" && (
            <button
              onClick={() => updateStatus("active")}
              disabled={statusUpdating || steps.length === 0}
              className="flex items-center gap-2 rounded-lg bg-secondary px-4 py-2.5 text-xs font-semibold text-on-secondary shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              Activate
            </button>
          )}
          {status === "active" && (
            <button
              onClick={() => updateStatus("paused")}
              disabled={statusUpdating}
              className="flex items-center gap-2 rounded-lg bg-primary-container px-4 py-2.5 text-xs font-semibold text-on-primary-container shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
            >
              <Pause className="h-4 w-4" />
              Pause
            </button>
          )}
          {(status === "active" || status === "paused") && (
            <button
              onClick={() => updateStatus("stopped")}
              disabled={statusUpdating}
              className="flex items-center gap-2 rounded-lg bg-error-container px-4 py-2.5 text-xs font-semibold text-on-error-container shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
            >
              {statusUpdating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              Stop
            </button>
          )}
          {status === "stopped" && (
            <p className="text-xs text-on-surface-variant">
              This campaign has been stopped. Create a new campaign to re-engage these leads.
            </p>
          )}
        </div>
        {steps.length === 0 && status !== "stopped" && (
          <p className="mt-3 text-xs text-on-surface-variant">
            Add at least one sequence step before activating.
          </p>
        )}
      </div>
    </div>
  );
}
