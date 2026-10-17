import { createClient } from "@/lib/supabase/server";
import { FollowUpsManager } from "@/components/follow-ups-manager";
import { Lead, OrderFollowUp } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function FollowUpsPage() {
  const supabase = await createClient();

  const [leadsRes, orderNudgesRes] = await Promise.all([
    supabase
      .from("leads")
      .select("*")
      .eq("follow_up_requested", true)
      .order("follow_up_date", { ascending: true }),
    supabase
      .from("follow_ups")
      .select("*, orders(order_number, status)")
      .order("scheduled_for", { ascending: true })
      .limit(200),
  ]);

  const leads = (leadsRes.data ?? []) as Lead[];
  const orderNudges = (orderNudgesRes.data ?? []) as (OrderFollowUp & {
    orders: { order_number: number; status: string } | null;
  })[];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-on-surface-variant">
          Automated WhatsApp follow-up reminders for leads who need time to decide, and nudges for unpaid orders
        </p>
      </div>
      <FollowUpsManager initialLeads={leads} orderNudges={orderNudges} />
    </div>
  );
}
