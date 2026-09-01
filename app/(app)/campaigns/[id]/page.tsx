import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Campaign, CampaignStep } from "@/lib/types";
import { CampaignDetail } from "./campaign-detail";
import { CampaignErrors } from "./campaign-errors";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [campRes, stepsRes] = await Promise.all([
    supabase.from("campaigns").select("*").eq("id", id).single(),
    supabase
      .from("campaign_steps")
      .select("*")
      .eq("campaign_id", id)
      .order("step_number", { ascending: true }),
  ]);

  if (campRes.error || !campRes.data) {
    notFound();
  }

  const campaign = campRes.data as Campaign;
  const steps = (stepsRes.data ?? []) as CampaignStep[];

  return (
    <div className="space-y-6">
      <CampaignDetail campaign={campaign} initialSteps={steps} />
      <CampaignErrors campaignId={campaign.id} />
    </div>
  );
}
