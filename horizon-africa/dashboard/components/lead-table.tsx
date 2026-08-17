"use client";

import { useState, useMemo } from "react";
import { Lead, LeadScore, LeadStatus } from "@/lib/types";
import { ScoreBadge } from "@/components/score-badge";
import { Search, Download, X, Save, ChevronLeft, ChevronRight } from "lucide-react";

interface LeadTableProps {
  leads: Lead[];
}

const scoreOptions: (LeadScore | "ALL")[] = ["ALL", "HOT", "WARM", "COLD"];
const statusOptions: (LeadStatus | "ALL")[] = ["ALL", "new", "contacted", "qualified", "converted", "lost"];
const PAGE_SIZE = 8;

export function LeadTable({ leads }: LeadTableProps) {
  const [search, setSearch] = useState("");
  const [scoreFilter, setScoreFilter] = useState<LeadScore | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "ALL">("ALL");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    return leads.filter((lead) => {
      const matchesSearch =
        !search ||
        lead.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        lead.phone_number.includes(search);
      const matchesScore = scoreFilter === "ALL" || lead.lead_score === scoreFilter;
      const matchesStatus = statusFilter === "ALL" || lead.status === statusFilter;
      return matchesSearch && matchesScore && matchesStatus;
    });
  }, [leads, search, scoreFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  function exportCSV() {
    const params = new URLSearchParams();
    if (scoreFilter !== "ALL") params.set("score", scoreFilter);
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (search) params.set("search", search);
    window.open(`/api/leads/export?${params.toString()}`, "_blank");
  }

  return (
    <div className="space-y-5">
      {/* Filters Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant/50" />
            <input
              type="text"
              placeholder="Search by name or phone..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-4 text-sm focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/10"
            />
          </div>
          <select
            value={scoreFilter}
            onChange={(e) => { setScoreFilter(e.target.value as LeadScore | "ALL"); setPage(0); }}
            className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm focus:border-secondary focus:outline-none"
          >
            {scoreOptions.map((s) => (
              <option key={s} value={s}>{s === "ALL" ? "All Scores" : s}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as LeadStatus | "ALL"); setPage(0); }}
            className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm focus:border-secondary focus:outline-none"
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>{s === "ALL" ? "All Statuses" : s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <button
          onClick={exportCSV}
          className="flex items-center gap-2 rounded-lg bg-secondary px-4 py-2.5 text-sm font-semibold text-on-secondary transition hover:opacity-90"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Data Table */}
      <div className="card-shadow overflow-x-auto rounded-xl border border-surface-variant bg-surface-container-lowest">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outline-variant bg-surface-container-low text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              <th className="px-5 py-4">Name</th>
              <th className="px-5 py-4">Phone</th>
              <th className="px-5 py-4">Product Interest</th>
              <th className="px-5 py-4">Score</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4">Follow-Up</th>
              <th className="px-5 py-4">Created</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length > 0 ? (
              paginated.map((lead) => (
                <tr
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  className="cursor-pointer border-b border-outline-variant/30 transition hover:bg-surface-container-low last:border-0"
                >
                  <td className="px-5 py-3.5 text-on-surface">{lead.full_name ?? "—"}</td>
                  <td className="px-5 py-3.5 text-on-surface-variant">{lead.phone_number}</td>
                  <td className="px-5 py-3.5 text-on-surface-variant">{lead.product_interest ?? "—"}</td>
                  <td className="px-5 py-3.5"><ScoreBadge score={lead.lead_score} /></td>
                  <td className="px-5 py-3.5 capitalize text-on-surface-variant">{lead.status}</td>
                  <td className="px-5 py-3.5">
                    {lead.follow_up_requested ? (
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        lead.follow_up_sent
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-700"
                      }`}>
                        {lead.follow_up_sent ? "Sent" : "Pending"}
                      </span>
                    ) : (
                      <span className="text-on-surface-variant">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-on-surface-variant">
                    {new Date(lead.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-on-surface-variant">
                  No leads found matching your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-on-surface-variant">
          Showing {paginated.length} of {filtered.length} leads
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant transition hover:bg-surface-container-low disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-medium text-on-surface-variant">
              {currentPage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage === totalPages - 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant transition hover:bg-surface-container-low disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {selectedLead && (
        <LeadDetailDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} />
      )}
    </div>
  );
}

function LeadDetailDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editScore, setEditScore] = useState<LeadScore>(lead.lead_score);
  const [editStatus, setEditStatus] = useState<LeadStatus>(lead.status);
  const [editNotes, setEditNotes] = useState<string>(lead.notes ?? "");
  const [currentLead, setCurrentLead] = useState(lead);

  async function saveLead() {
    setSaving(true);
    const res = await fetch(`/api/leads/${currentLead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_score: editScore,
        status: editStatus,
        notes: editNotes,
      }),
    });
    if (res.ok) {
      const { lead: updated } = await res.json();
      setCurrentLead(updated);
      setEditing(false);
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-y-auto bg-surface-container-lowest shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-outline-variant bg-surface-container-lowest px-6 py-4">
          <h2 className="text-lg font-semibold text-on-surface">Lead Details</h2>
          <div className="flex items-center gap-2">
            {editing ? (
              <button
                onClick={saveLead}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-sm font-semibold text-on-secondary transition hover:opacity-90 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save"}
              </button>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="rounded-lg border border-outline-variant px-3 py-1.5 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-low"
              >
                Edit
              </button>
            )}
            <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary-container/20 text-lg font-semibold text-secondary">
              {(currentLead.full_name ?? currentLead.phone_number).charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-on-surface">{currentLead.full_name ?? "Unknown"}</p>
              <p className="text-sm text-on-surface-variant">{currentLead.phone_number}</p>
            </div>
            <div className="ml-auto">
              {editing ? (
                <select
                  value={editScore}
                  onChange={(e) => setEditScore(e.target.value as LeadScore)}
                  className="rounded-lg border border-outline-variant bg-surface-container-lowest px-2 py-1 text-xs focus:border-secondary focus:outline-none"
                >
                  <option value="HOT">HOT</option>
                  <option value="WARM">WARM</option>
                  <option value="COLD">COLD</option>
                </select>
              ) : (
                <ScoreBadge score={currentLead.lead_score} />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            {editing ? (
              <>
                <div>
                  <p className="text-xs font-medium text-on-surface-variant">Status</p>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as LeadStatus)}
                    className="mt-0.5 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-sm focus:border-secondary focus:outline-none"
                  >
                    <option value="new">New</option>
                    <option value="contacted">Contacted</option>
                    <option value="qualified">Qualified</option>
                    <option value="converted">Converted</option>
                    <option value="lost">Lost</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <p className="text-xs font-medium text-on-surface-variant">Notes</p>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={3}
                    className="mt-0.5 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/10"
                  />
                </div>
              </>
            ) : (
              <>
                <Field label="Status" value={currentLead.status} capitalize />
                <Field label="Email" value={currentLead.email} />
                <Field label="Product Interest" value={currentLead.product_interest} />
                <Field label="Recommended Package" value={currentLead.recommended_package} />
                <Field label="Offered Package" value={currentLead.offered_package} />
                <Field label="Household Size" value={currentLead.household_size} />
                <Field label="Internet Usage" value={currentLead.internet_usage} />
                <Field label="Physical Address" value={currentLead.physical_address} fullWidth />
                <Field label="Notes" value={currentLead.notes} fullWidth />
                {currentLead.follow_up_requested && (
                  <>
                    <Field label="Follow-Up Requested" value="Yes" />
                    <Field label="Follow-Up Date" value={currentLead.follow_up_date ? new Date(currentLead.follow_up_date).toLocaleDateString() : null} />
                    <Field label="Follow-Up Sent" value={currentLead.follow_up_sent ? "Yes" : "No"} />
                    <Field label="Follow-Up Sent At" value={currentLead.follow_up_sent_at ? new Date(currentLead.follow_up_sent_at).toLocaleString() : null} />
                  </>
                )}
                {currentLead.needs_escalation && (
                  <Field label="Needs Escalation" value="Yes" fullWidth />
                )}
              </>
            )}
            <Field label="Created" value={new Date(currentLead.created_at).toLocaleString()} />
            <Field label="Updated" value={new Date(currentLead.updated_at).toLocaleString()} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, fullWidth, capitalize }: { label: string; value: string | null; fullWidth?: boolean; capitalize?: boolean }) {
  return (
    <div className={fullWidth ? "col-span-2" : ""}>
      <p className="text-xs font-medium text-on-surface-variant">{label}</p>
      <p className={`mt-0.5 text-on-surface ${capitalize ? "capitalize" : ""}`}>{value ?? "—"}</p>
    </div>
  );
}
