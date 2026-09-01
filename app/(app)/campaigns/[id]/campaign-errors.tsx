"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";

interface CampaignErrorRow {
  id: string;
  error_type: string;
  error_message: string | null;
  phone_number: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
}

interface Props {
  campaignId: string;
}

export function CampaignErrors({ campaignId }: Props) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<CampaignErrorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fetchErrors = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/campaigns/errors?campaign_id=${campaignId}&limit=20`
      );
      if (res.ok) {
        const data = await res.json();
        setErrors(data.errors ?? []);
      }
    } catch {
      // keep empty
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [campaignId]);

  useEffect(() => {
    if (open && !loaded) {
      fetchErrors();
    }
  }, [open, loaded, fetchErrors]);

  return (
    <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-error" />
          <h2 className="text-lg font-semibold text-on-surface">
            Error Monitoring
          </h2>
        </div>
        {open ? (
          <ChevronDown className="h-5 w-5 text-on-surface-variant" />
        ) : (
          <ChevronRight className="h-5 w-5 text-on-surface-variant" />
        )}
      </button>

      {open && (
        <div className="mt-5">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-on-surface-variant" />
            </div>
          ) : errors.length === 0 ? (
            <p className="py-8 text-center text-sm text-on-surface-variant">
              No errors recorded for this campaign.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-surface-variant text-xs uppercase tracking-wider text-on-surface-variant">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Phone</th>
                    <th className="px-4 py-3 font-semibold">Message</th>
                    <th className="px-4 py-3 font-semibold">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-variant/50">
                  {errors.map((e) => (
                    <tr
                      key={e.id}
                      className="transition-colors hover:bg-surface-container-low"
                    >
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-error-container/30 px-2 py-0.5 text-xs font-semibold text-error">
                          {e.error_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-on-surface-variant">
                        {e.phone_number ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-on-surface-variant">
                        {e.error_message ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-on-surface-variant">
                        {new Date(e.created_at).toLocaleString("en-ZA", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
