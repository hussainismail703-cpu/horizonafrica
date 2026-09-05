import { createClient } from "@/lib/supabase/server";
import { BroadcastGroup } from "@/lib/types";
import { CreateCampaignForm } from "./create-campaign-form";

export const dynamic = "force-dynamic";

export default async function CreateCampaignPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("broadcast_groups")
    .select("*")
    .order("group_label");

  const groups = (data ?? []) as BroadcastGroup[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Create Campaign</h1>
        <p className="text-sm text-on-surface-variant">
          Set up campaign metadata. You&apos;ll build the message sequence on the next step.
        </p>
      </div>

      <div className="card-shadow mx-auto max-w-2xl rounded-xl border border-surface-variant bg-surface-container-lowest p-8">
        <CreateCampaignForm groups={groups} />
      </div>
    </div>
  );
}
