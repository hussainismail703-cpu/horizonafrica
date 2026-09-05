"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CallingQueueItem,
  Campaign,
  QueueStatus,
} from "@/lib/types";
import Link from "next/link";
import { Phone, PhoneCall, CheckCircle2, XCircle, CalendarClock, Loader2, PhoneOutgoing } from "lucide-react";

interface CallingQueueClientProps {
  items: (CallingQueueItem & {
    campaign: Pick<Campaign, "id" | "name"> | null;
  })[];
  campaigns: Pick<Campaign, "id" | "name" | "status">[];
}

const QUEUE_STATUS_STYLES: Record<QueueStatus, string> = {
  pending: "bg-secondary-container/40 text-secondary",
  called: "bg-primary-container/40 text-on-primary-container",
  converted: "bg-tertiary-container/40 text-on-tertiary",
  lost: "bg-error-container/40 text-on-error",
  callback_scheduled: "bg-surface-container-high text-on-surface-variant",
};

const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  pending: "Pending",
  called: "Called",
  converted: "Converted",
  lost: "Lost",
  callback_scheduled: "Callback Scheduled",
};

export function CallingQueueClient({ items, campaigns }: CallingQueueClientProps) {
  const router = useRouter();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [filterCampaign, setFilterCampaign] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (filterCampaign && item.campaign_id !== filterCampaign) return false;
      if (filterStatus && item.queue_status !== filterStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.phone_number.includes(q) ||
          (item.full_name?.toLowerCase().includes(q) ?? false) ||
          (item.email?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [items, filterCampaign, filterStatus, searchQuery]);

  const pendingCount = items.filter((i) => i.queue_status === "pending").length;

  async function updateStatus(id: string, status: QueueStatus) {
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/calling-queue/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queue_status: status }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to update status");
        return;
      }
      toast.success(`Marked as ${QUEUE_STATUS_LABELS[status]}`);
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setUpdatingId(null);
    }
  }

  async function saveNotes(id: string, notes: string) {
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/calling-queue/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_notes: notes }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to save notes");
        return;
      }
      toast.success("Notes saved");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Calling Queue</h1>
          <p className="text-sm text-on-surface-variant">
            Sales-qualified leads ready for human follow-up
          </p>
        </div>
        {pendingCount > 0 && (
          <span className="inline-flex items-center gap-2 rounded-full bg-secondary-container/40 px-4 py-2 text-xs font-semibold text-secondary">
            <PhoneOutgoing className="h-4 w-4" />
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Campaign
            </label>
            <select
              value={filterCampaign}
              onChange={(e) => setFilterCampaign(e.target.value)}
              className="w-full rounded-lg border border-surface-variant bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            >
              <option value="">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Status
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full rounded-lg border border-surface-variant bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            >
              <option value="">All statuses</option>
              {(Object.keys(QUEUE_STATUS_LABELS) as QueueStatus[]).map((s) => (
                <option key={s} value={s}>
                  {QUEUE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Search
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Phone, name, or email…"
              className="w-full rounded-lg border border-surface-variant bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            />
          </div>
        </div>
      </div>

      {/* Queue table */}
      {filtered.length === 0 ? (
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-12 text-center">
          <PhoneOutgoing className="mx-auto mb-4 h-12 w-12 text-on-surface-variant/40" />
          <p className="text-sm text-on-surface-variant">
            {items.length === 0
              ? "No leads in the calling queue yet. Sales-qualified leads will appear here when classified as interested or callback_requested."
              : "No items match the current filters."}
          </p>
        </div>
      ) : (
        <div className="card-shadow overflow-hidden rounded-xl border border-surface-variant bg-surface-container-lowest">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-variant bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name / Phone</th>
                  <th className="px-4 py-3 font-semibold">Campaign</th>
                  <th className="px-4 py-3 font-semibold">Package</th>
                  <th className="px-4 py-3 font-semibold">Request</th>
                  <th className="px-4 py-3 font-semibold">Callback Time</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-variant/50">
                {filtered.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    updating={updatingId === item.id}
                    onStatusChange={updateStatus}
                    onSaveNotes={saveNotes}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function QueueRow({
  item,
  updating,
  onStatusChange,
  onSaveNotes,
}: {
  item: CallingQueueItem & { campaign: Pick<Campaign, "id" | "name"> | null };
  updating: boolean;
  onStatusChange: (id: string, status: QueueStatus) => void;
  onSaveNotes: (id: string, notes: string) => void;
}) {
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState(item.call_notes ?? "");

  return (
    <>
      <tr className="hover:bg-surface-container-low">
        <td className="px-4 py-3">
          <div className="font-medium text-on-surface">
            {item.full_name ?? "—"}
          </div>
          {item.campaign_id && (
            <Link
              href={`/campaigns/${item.campaign_id}/customers/${item.phone_number}`}
              className="text-xs text-secondary hover:underline"
            >
              {item.phone_number}
            </Link>
          )}
          {!item.campaign_id && (
            <span className="text-xs text-on-surface-variant">{item.phone_number}</span>
          )}
          {item.email && (
            <div className="text-xs text-on-surface-variant">{item.email}</div>
          )}
        </td>
        <td className="px-4 py-3 text-on-surface-variant">
          {item.campaign?.name ?? "—"}
          {item.campaign_stage && (
            <div className="text-xs text-on-surface-variant/70">{item.campaign_stage}</div>
          )}
        </td>
        <td className="px-4 py-3 text-on-surface-variant">
          {item.preferred_package ?? "—"}
        </td>
        <td className="px-4 py-3 text-on-surface-variant">
          {item.customer_request ? (
            <span className="text-xs line-clamp-2 max-w-xs">{item.customer_request}</span>
          ) : (
            "—"
          )}
        </td>
        <td className="px-4 py-3 text-on-surface-variant">
          {item.preferred_callback_time ?? "—"}
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${QUEUE_STATUS_STYLES[item.queue_status]}`}
          >
            {QUEUE_STATUS_LABELS[item.queue_status]}
          </span>
          {item.called_at && (
            <div className="mt-1 text-xs text-on-surface-variant/70">
              {new Date(item.called_at).toLocaleDateString("en-ZA")}
            </div>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {item.queue_status === "pending" && (
              <button
                onClick={() => onStatusChange(item.id, "called")}
                disabled={updating}
                className="flex items-center gap-1 rounded bg-primary-container/40 px-2 py-1 text-xs font-semibold text-on-primary-container hover:bg-primary-container/60"
              >
                <PhoneCall className="h-3 w-3" />
                Mark Called
              </button>
            )}
            {item.queue_status === "called" && (
              <>
                <button
                  onClick={() => onStatusChange(item.id, "converted")}
                  disabled={updating}
                  className="flex items-center gap-1 rounded bg-tertiary-container/40 px-2 py-1 text-xs font-semibold text-on-tertiary hover:bg-tertiary-container/60"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Converted
                </button>
                <button
                  onClick={() => onStatusChange(item.id, "lost")}
                  disabled={updating}
                  className="flex items-center gap-1 rounded bg-error-container/30 px-2 py-1 text-xs font-semibold text-error hover:bg-error-container/50"
                >
                  <XCircle className="h-3 w-3" />
                  Lost
                </button>
                <button
                  onClick={() => onStatusChange(item.id, "callback_scheduled")}
                  disabled={updating}
                  className="flex items-center gap-1 rounded bg-surface-container-high px-2 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-highest"
                >
                  <CalendarClock className="h-3 w-3" />
                  Callback
                </button>
              </>
            )}
            {(item.queue_status === "callback_scheduled" || item.queue_status === "lost") && (
              <button
                onClick={() => onStatusChange(item.id, "called")}
                disabled={updating}
                className="flex items-center gap-1 rounded bg-primary-container/40 px-2 py-1 text-xs font-semibold text-on-primary-container hover:bg-primary-container/60"
              >
                <PhoneCall className="h-3 w-3" />
                Called
              </button>
            )}
            <button
              onClick={() => setShowNotes(!showNotes)}
              className="rounded bg-surface-container-high px-2 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-highest"
            >
              Notes
            </button>
            {updating && (
              <Loader2 className="h-4 w-4 animate-spin text-on-surface-variant" />
            )}
          </div>
        </td>
      </tr>
      {showNotes && (
        <tr className="bg-surface-container-low/50">
          <td colSpan={7} className="px-4 py-3">
            <div className="flex gap-3">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Call notes…"
                className="flex-1 rounded-lg border border-surface-variant bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
              />
              <button
                onClick={() => onSaveNotes(item.id, notes)}
                disabled={updating}
                className="self-start rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary hover:brightness-110 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
