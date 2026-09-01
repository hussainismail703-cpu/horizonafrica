"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Campaign,
  CampaignEnrolment,
  CampaignClassification,
  EnrolmentStatus,
  Classification,
  RejectionReason,
  Lead,
} from "@/lib/types";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";

interface EnrolmentsManagerProps {
  campaign: Campaign;
  enrolments: (CampaignEnrolment & { lead: Lead | null })[];
  classificationsByPhone: Record<string, CampaignClassification>;
}

const STATUS_OPTIONS: EnrolmentStatus[] = [
  "active",
  "responded",
  "completed",
  "removed",
];

const CLASSIFICATION_OPTIONS: Classification[] = [
  "interested",
  "not_interested",
  "already_has_service",
  "needs_information",
  "no_response",
  "other",
  "uncertain",
];

const REJECTION_REASONS: RejectionReason[] = [
  "price",
  "already_has_service",
  "not_needed",
  "not_now",
  "needs_more_info",
  "competitor",
  "not_eligible",
  "other",
];

const STATUS_STYLES: Record<EnrolmentStatus, string> = {
  active: "bg-secondary-container/40 text-secondary",
  responded: "bg-primary-container/40 text-on-primary-container",
  completed: "bg-tertiary-container/40 text-on-tertiary",
  removed: "bg-error-container/40 text-on-error",
};

export function EnrolmentsManager({
  campaign,
  enrolments,
  classificationsByPhone,
}: EnrolmentsManagerProps) {
  const router = useRouter();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function overrideStatus(enrolId: string, status: EnrolmentStatus) {
    setUpdatingId(enrolId);
    try {
      const res = await fetch(`/api/campaigns/enrolments/${enrolId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to update status");
        return;
      }
      toast.success(`Status changed to ${status}`);
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setUpdatingId(null);
    }
  }

  async function correctClassification(
    classificationId: string,
    classification: Classification,
    rejectionReason: RejectionReason | null
  ) {
    setUpdatingId(classificationId);
    try {
      const res = await fetch(`/api/campaigns/classifications/${classificationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classification,
          rejection_reason: rejectionReason,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to correct classification");
        return;
      }
      toast.success("Classification corrected");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href={`/campaigns/${campaign.id}`}
          className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant hover:text-on-surface"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Campaign
        </Link>
        <h1 className="text-lg font-semibold text-on-surface">
          Enrolments — {campaign.name}
        </h1>
      </div>

      {enrolments.length === 0 ? (
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-12 text-center">
          <p className="text-sm text-on-surface-variant">
            No enrolments yet for this campaign.
          </p>
        </div>
      ) : (
        <div className="card-shadow overflow-hidden rounded-xl border border-surface-variant bg-surface-container-lowest">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-surface-variant bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant">
              <tr>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Step</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Classification</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-variant/50">
              {enrolments.map((enrol) => {
                const cls = classificationsByPhone[enrol.phone_number];
                return (
                  <tr key={enrol.id} className="hover:bg-surface-container-low">
                    <td className="px-4 py-3">
                      <Link
                        href={`/campaigns/${campaign.id}/customers/${enrol.phone_number}`}
                        className="font-medium text-secondary hover:underline"
                      >
                        {enrol.phone_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {enrol.lead?.full_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {enrol.current_step}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[enrol.status]}`}
                      >
                        {enrol.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {cls ? (
                        <span className="text-xs">
                          {cls.classification}
                          {cls.rejection_reason && ` (${cls.rejection_reason})`}
                          {cls.classified_by === "manual" && (
                            <span className="ml-1 text-primary">✎</span>
                          )}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              overrideStatus(enrol.id, e.target.value as EnrolmentStatus);
                              e.target.value = "";
                            }
                          }}
                          disabled={updatingId === enrol.id}
                          className="rounded border border-surface-variant bg-surface px-2 py-1 text-xs"
                        >
                          <option value="">Override status…</option>
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        {cls && (
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) {
                                const [c, r] = e.target.value.split("|");
                                correctClassification(
                                  cls.id,
                                  c as Classification,
                                  r ? (r as RejectionReason) : null
                                );
                                e.target.value = "";
                              }
                            }}
                            disabled={updatingId === cls.id}
                            className="rounded border border-surface-variant bg-surface px-2 py-1 text-xs"
                          >
                            <option value="">Correct classification…</option>
                            {CLASSIFICATION_OPTIONS.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                            {CLASSIFICATION_OPTIONS.filter(
                              (c) => c === "not_interested" || c === "already_has_service"
                            ).map((c) =>
                              REJECTION_REASONS.map((r) => (
                                <option key={`${c}|${r}`} value={`${c}|${r}`}>
                                  {c} — {r}
                                </option>
                              ))
                            )}
                          </select>
                        )}
                        {enrol.status !== "removed" && (
                          <button
                            onClick={() => overrideStatus(enrol.id, "removed")}
                            disabled={updatingId === enrol.id}
                            className="rounded bg-error-container/30 px-2 py-1 text-xs font-semibold text-error hover:bg-error-container/50"
                          >
                            Remove
                          </button>
                        )}
                        {updatingId === enrol.id && (
                          <Loader2 className="h-4 w-4 animate-spin text-on-surface-variant" />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
