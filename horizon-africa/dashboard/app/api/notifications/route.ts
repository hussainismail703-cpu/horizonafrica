import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();

  const [hotLeads, newLeads, escalationLeads, pendingFollowUps] = await Promise.all([
    supabase
      .from("leads")
      .select("id, phone_number, full_name, lead_score, created_at")
      .eq("lead_score", "HOT")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("leads")
      .select("id, phone_number, full_name, lead_score, status, created_at")
      .eq("status", "new")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("leads")
      .select("id, phone_number, full_name, needs_escalation, updated_at")
      .eq("needs_escalation", true)
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("leads")
      .select("id, phone_number, full_name, follow_up_date, follow_up_sent, updated_at")
      .eq("follow_up_requested", true)
      .eq("follow_up_sent", false)
      .lte("follow_up_date", now)
      .order("follow_up_date", { ascending: true })
      .limit(5),
  ]);

  const notifications: Array<{
    id: string;
    type: "hot_lead" | "new_lead" | "escalation" | "follow_up_due";
    title: string;
    description: string;
    leadId: number;
    timestamp: string;
  }> = [];

  for (const lead of hotLeads.data ?? []) {
    notifications.push({
      id: `hot-${lead.id}`,
      type: "hot_lead",
      title: "Hot Lead",
      description: `${lead.full_name ?? lead.phone_number} is ready to convert`,
      leadId: lead.id,
      timestamp: lead.created_at,
    });
  }

  for (const lead of newLeads.data ?? []) {
    notifications.push({
      id: `new-${lead.id}`,
      type: "new_lead",
      title: "New Lead",
      description: `${lead.full_name ?? lead.phone_number} just came in`,
      leadId: lead.id,
      timestamp: lead.created_at,
    });
  }

  for (const lead of escalationLeads.data ?? []) {
    notifications.push({
      id: `esc-${lead.id}`,
      type: "escalation",
      title: "Escalation Needed",
      description: `${lead.full_name ?? lead.phone_number} needs human assistance`,
      leadId: lead.id,
      timestamp: lead.updated_at,
    });
  }

  for (const lead of pendingFollowUps.data ?? []) {
    notifications.push({
      id: `fu-${lead.id}`,
      type: "follow_up_due",
      title: "Follow-Up Due",
      description: `${lead.full_name ?? lead.phone_number} follow-up is overdue`,
      leadId: lead.id,
      timestamp: lead.follow_up_date ?? lead.updated_at ?? now,
    });
  }

  notifications.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return NextResponse.json({
    notifications: notifications.slice(0, 20),
    count: notifications.length,
  });
}
