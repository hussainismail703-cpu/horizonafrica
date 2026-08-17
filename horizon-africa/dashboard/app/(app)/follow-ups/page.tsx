import { createClient } from "@/lib/supabase/server";
import { FollowUpsManager } from "@/components/follow-ups-manager";
import { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function FollowUpsPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("leads")
    .select("*")
    .eq("follow_up_requested", true)
    .order("follow_up_date", { ascending: true });

  const leads = (data ?? []) as Lead[];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-on-surface-variant">
          Automated WhatsApp follow-up reminders for leads who need time to decide
        </p>
      </div>
      <FollowUpsManager initialLeads={leads} />
    </div>
  );
}
