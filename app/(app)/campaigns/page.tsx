import { createClient } from "@/lib/supabase/server";
import { Campaign, CampaignStatus } from "@/lib/types";
import Link from "next/link";
import { Plus, Megaphone, BarChart3 } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: "bg-surface-container-high text-on-surface-variant",
  active: "bg-secondary-container/40 text-secondary",
  paused: "bg-primary-container/40 text-on-primary-container",
  completed: "bg-tertiary-container/40 text-on-tertiary",
  stopped: "bg-error-container/40 text-on-error",
};

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function CampaignsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("*")
    .order("updated_at", { ascending: false });

  const campaigns = (data ?? []) as Campaign[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Campaigns</h1>
          <p className="text-sm text-on-surface-variant">
            Create and manage WhatsApp campaign sequences
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/campaigns/dashboard"
            className="flex items-center gap-2 rounded-lg bg-surface-container-high px-4 py-2.5 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-highest"
          >
            <BarChart3 className="h-4 w-4" />
            Dashboard
          </Link>
          <Link
            href="/campaigns/create"
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-on-primary shadow-sm transition-all hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            Create Campaign
          </Link>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="card-shadow flex flex-col items-center justify-center rounded-xl border border-surface-variant bg-surface-container-lowest p-12 text-center">
          <Megaphone className="mb-4 h-10 w-10 text-on-surface-variant/40" />
          <h2 className="text-lg font-semibold text-on-surface">No campaigns yet</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Create your first campaign to start engaging leads with automated sequences.
          </p>
          <Link
            href="/campaigns/create"
            className="mt-4 flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-on-primary shadow-sm transition-all hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            Create Campaign
          </Link>
        </div>
      ) : (
        <div className="card-shadow overflow-hidden rounded-xl border border-surface-variant bg-surface-container-lowest">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-surface-variant bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant">
              <tr>
                <th className="px-6 py-4 font-semibold">Name</th>
                <th className="px-6 py-4 font-semibold">Objective</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold">Start</th>
                <th className="px-6 py-4 font-semibold">End</th>
                <th className="px-6 py-4 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-variant/50">
              {campaigns.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-surface-container-low">
                  <td className="px-6 py-4 font-medium text-on-surface">{c.name}</td>
                  <td className="px-6 py-4 text-on-surface-variant">
                    {c.objective ? (
                      <span className="line-clamp-1 max-w-xs">{c.objective}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[c.status]}`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-on-surface-variant">{formatDate(c.start_date)}</td>
                  <td className="px-6 py-4 text-on-surface-variant">{formatDate(c.end_date)}</td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="rounded-lg bg-surface-container-high px-3 py-1.5 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-highest"
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
