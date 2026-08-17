"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BroadcastHistory } from "@/lib/types";

interface BroadcastHistoryListProps {
  history: BroadcastHistory[];
  pageSize?: number;
}

export function BroadcastHistoryList({ history, pageSize = 10 }: BroadcastHistoryListProps) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(history.length / pageSize);
  const start = page * pageSize;
  const pageData = history.slice(start, start + pageSize);

  if (history.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-on-surface-variant">
        No broadcasts sent yet. Campaign history will appear here once WhatsApp is active.
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outline-variant text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              <th className="pb-3">Campaign</th>
              <th className="pb-3">Template</th>
              <th className="pb-3">Sent</th>
              <th className="pb-3">Delivered</th>
              <th className="pb-3">Read</th>
              <th className="pb-3">Failed</th>
              <th className="pb-3">Status</th>
              <th className="pb-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map((h) => (
              <tr key={h.id} className="border-b border-outline-variant/30 last:border-0">
                <td className="py-3 text-on-surface">{h.campaign_name}</td>
                <td className="py-3 text-on-surface-variant">{h.template_name ?? "—"}</td>
                <td className="py-3 text-on-surface-variant">{h.total_sent}</td>
                <td className="py-3 text-on-surface-variant">{h.total_delivered}</td>
                <td className="py-3 text-on-surface-variant">{h.total_read}</td>
                <td className="py-3 text-on-surface-variant">{h.total_failed}</td>
                <td className="py-3 capitalize text-on-surface-variant">{h.status}</td>
                <td className="py-3 text-on-surface-variant">
                  {new Date(h.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-on-surface-variant">
            Showing {start + 1}–{Math.min(start + pageSize, history.length)} of {history.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-1 rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-medium text-on-surface-variant transition hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>
            <span className="text-xs font-medium text-on-surface-variant">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="flex items-center gap-1 rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-medium text-on-surface-variant transition hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
