import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Campaign, CampaignEnrolment, CampaignClassification, Lead, BroadcastGroup } from "@/lib/types";
import { EnrolmentsManager } from "./enrolments-manager";

export const dynamic = "force-dynamic";

export default async function EnrolmentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [campRes, enrolRes, classRes, groupsRes] = await Promise.all([
    supabase.from("campaigns").select("*").eq("id", id).single(),
    supabase
      .from("campaign_enrolments")
      .select(`*, lead:leads(id, full_name, email, status, notes)`)
      .eq("campaign_id", id)
      .order("enrolled_at", { ascending: false }),
    supabase
      .from("campaign_classifications")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("broadcast_groups")
      .select("*")
      .order("group_label", { ascending: true }),
  ]);

  if (campRes.error || !campRes.data) {
    notFound();
  }

  const campaign = campRes.data as Campaign;
  const enrolments = (enrolRes.data ?? []) as (CampaignEnrolment & {
    lead: Lead | null;
  })[];
  const classifications = (classRes.data ?? []) as CampaignClassification[];
  const groups = (groupsRes.data ?? []) as BroadcastGroup[];

  // Map latest classification per phone
  const classByPhone: Record<string, CampaignClassification> = {};
  for (const c of classifications) {
    if (!classByPhone[c.phone_number]) {
      classByPhone[c.phone_number] = c;
    }
  }

  return (
    <EnrolmentsManager
      campaign={campaign}
      enrolments={enrolments}
      classificationsByPhone={classByPhone}
      groups={groups}
    />
  );
}
