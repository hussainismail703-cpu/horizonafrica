import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import {
  Campaign,
  CampaignEnrolment,
  CampaignInteraction,
  CampaignClassification,
  Lead,
} from "@/lib/types";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

function formatDateTime(d: string): string {
  return new Date(d).toLocaleString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DELIVERY_STYLES: Record<string, string> = {
  pending: "text-on-surface-variant",
  sent: "text-secondary",
  delivered: "text-secondary",
  read: "text-tertiary",
  failed: "text-error",
};

export default async function CustomerJourneyPage({
  params,
}: {
  params: Promise<{ id: string; phone: string }>;
}) {
  const { id, phone } = await params;
  const supabase = await createClient();

  const [campRes, enrolRes, interactRes, classRes] = await Promise.all([
    supabase.from("campaigns").select("*").eq("id", id).single(),
    supabase
      .from("campaign_enrolments")
      .select("*")
      .eq("campaign_id", id)
      .eq("phone_number", phone)
      .limit(1)
      .single(),
    supabase
      .from("campaign_interactions")
      .select("*")
      .eq("campaign_id", id)
      .eq("phone_number", phone)
      .order("occurred_at", { ascending: true }),
    supabase
      .from("campaign_classifications")
      .select("*")
      .eq("phone_number", phone)
      .order("created_at", { ascending: false }),
  ]);

  if (campRes.error || !campRes.data) notFound();
  if (enrolRes.error || !enrolRes.data) notFound();

  const campaign = campRes.data as Campaign;
  const enrolment = enrolRes.data as CampaignEnrolment;
  const interactions = (interactRes.data ?? []) as CampaignInteraction[];
  const classifications = (classRes.data ?? []) as CampaignClassification[];

  // Fetch lead info
  let lead: Lead | null = null;
  if (enrolment.lead_id) {
    const { data: leadData } = await supabase
      .from("leads")
      .select("*")
      .eq("id", enrolment.lead_id)
      .single();
    lead = leadData as Lead;
  }

  const latestClass = classifications[0];
  const lastInbound = [...interactions]
    .reverse()
    .find((i) => i.message_type === "inbound");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href={`/campaigns/${campaign.id}/enrolments`}
          className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant hover:text-on-surface"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Enrolments
        </Link>
        <h1 className="text-lg font-semibold text-on-surface">
          Customer Journey — {phone}
        </h1>
      </div>

      {/* Customer Info */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-base font-semibold text-on-surface">Customer Info</h2>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-on-surface-variant">Phone</p>
            <p className="font-medium text-on-surface">{phone}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-on-surface-variant">Name</p>
            <p className="font-medium text-on-surface">{lead?.full_name ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-on-surface-variant">Email</p>
            <p className="font-medium text-on-surface">{lead?.email ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-on-surface-variant">Lead Status</p>
            <p className="font-medium text-on-surface">{lead?.status ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-on-surface-variant">Last Campaign Contact</p>
            <p className="font-medium text-on-surface">
              {lead?.last_campaign_contact_date
                ? formatDateTime(lead.last_campaign_contact_date)
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-on-surface-variant">Last Campaign Response</p>
            <p className="font-medium text-on-surface">
              {lead?.last_campaign_response ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-on-surface-variant">Rejection Reason</p>
            <p className="font-medium capitalize text-on-surface">
              {lead?.rejection_reason ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-on-surface-variant">Nurture Flag</p>
            <p className="font-medium text-on-surface">
              {enrolment.nurture_flag ? "Yes" : "No"}
            </p>
          </div>
        </div>
        {lead?.notes && (
          <div className="mt-4 border-t border-surface-variant pt-4">
            <p className="text-xs uppercase tracking-wider text-on-surface-variant">Notes</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-on-surface">{lead.notes}</p>
          </div>
        )}
      </div>

      {/* Campaign Info */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-base font-semibold text-on-surface">Campaign</h2>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-on-surface-variant">Campaign</p>
            <p className="font-medium text-on-surface">{campaign.name}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-on-surface-variant">Enrolled</p>
            <p className="font-medium text-on-surface">{formatDateTime(enrolment.enrolled_at)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-on-surface-variant">Current Step</p>
            <p className="font-medium text-on-surface">{enrolment.current_step}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-on-surface-variant">Status</p>
            <p className="font-medium capitalize text-on-surface">{enrolment.status}</p>
          </div>
        </div>
      </div>

      {/* Classification */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-base font-semibold text-on-surface">Classification</h2>
        {latestClass ? (
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-on-surface-variant">Classification</p>
              <p className="font-medium capitalize text-on-surface">{latestClass.classification}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-on-surface-variant">Rejection Reason</p>
              <p className="font-medium capitalize text-on-surface">
                {latestClass.rejection_reason ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-on-surface-variant">Confidence</p>
              <p className="font-medium text-on-surface">
                {latestClass.confidence !== null
                  ? `${(latestClass.confidence * 100).toFixed(0)}%`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-on-surface-variant">Classified By</p>
              <p className="font-medium capitalize text-on-surface">
                {latestClass.classified_by}
                {latestClass.corrected_by && ` (by ${latestClass.corrected_by})`}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-on-surface-variant">No classification recorded yet.</p>
        )}
      </div>

      {/* Interactions */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-base font-semibold text-on-surface">
          Interactions ({interactions.length})
        </h2>
        {interactions.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No interactions recorded.</p>
        ) : (
          <div className="space-y-3">
            {interactions.map((i) => (
              <div
                key={i.id}
                className={`rounded-lg border p-4 text-sm ${
                  i.message_type === "outbound"
                    ? "border-secondary/30 bg-secondary-container/10"
                    : "border-primary/30 bg-primary-container/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold capitalize text-on-surface">
                    {i.message_type}
                    {i.step_number !== null && ` — Step ${i.step_number}`}
                  </span>
                  <span className="text-xs text-on-surface-variant">
                    {formatDateTime(i.occurred_at)}
                  </span>
                </div>
                {i.template_name && (
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Template: <span className="font-mono">{i.template_name}</span>
                  </p>
                )}
                {i.message_body && (
                  <p className="mt-2 text-sm text-on-surface">{i.message_body}</p>
                )}
                <p className={`mt-2 text-xs font-semibold ${DELIVERY_STYLES[i.delivery_status] ?? ""}`}>
                  {i.delivery_status}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Last Response */}
      {lastInbound && (
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
          <h2 className="mb-4 text-base font-semibold text-on-surface">Last Response</h2>
          <p className="text-xs text-on-surface-variant">{formatDateTime(lastInbound.occurred_at)}</p>
          <p className="mt-2 text-sm text-on-surface">
            {lastInbound.message_body ?? "(no text content)"}
          </p>
        </div>
      )}
    </div>
  );
}
