"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BroadcastGroup } from "@/lib/types";
import { Loader2 } from "lucide-react";

interface CreateCampaignFormProps {
  groups: BroadcastGroup[];
}

export function CreateCampaignForm({ groups }: CreateCampaignFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [groupId, setGroupId] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Campaign name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          objective: objective.trim() || null,
          start_date: startDate ? new Date(startDate).toISOString() : null,
          end_date: endDate ? new Date(endDate).toISOString() : null,
          group_id: groupId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to create campaign");
        return;
      }
      toast.success("Campaign created");
      router.push(`/campaigns/${data.id}`);
      router.refresh();
    } catch {
      toast.error("Network error creating campaign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
          Campaign Name <span className="text-error">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
          placeholder="e.g. Fibre Lead Re-Engagement"
          className="w-full rounded-lg border border-surface-variant bg-surface px-4 py-2.5 text-sm text-on-surface outline-none transition-colors focus:border-primary"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
          Objective
        </label>
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="What is this campaign trying to achieve?"
          className="w-full rounded-lg border border-surface-variant bg-surface px-4 py-2.5 text-sm text-on-surface outline-none transition-colors focus:border-primary"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
            Start Date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg border border-surface-variant bg-surface px-4 py-2.5 text-sm text-on-surface outline-none transition-colors focus:border-primary"
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
            className="w-full rounded-lg border border-surface-variant bg-surface px-4 py-2.5 text-sm text-on-surface outline-none transition-colors focus:border-primary"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
          Target Group (optional)
        </label>
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="w-full rounded-lg border border-surface-variant bg-surface px-4 py-2.5 text-sm text-on-surface outline-none transition-colors focus:border-primary"
        >
          <option value="">— None —</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.group_label} ({g.group_name})
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-on-surface-variant/70">
          Used as a reference. Enrolment happens from the campaign detail page.
        </p>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg px-4 py-2.5 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-container"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-xs font-semibold text-on-primary shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? "Creating…" : "Create Campaign"}
        </button>
      </div>
    </form>
  );
}
