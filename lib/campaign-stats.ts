import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared campaign statistics helpers.
 *
 * Used by both the API routes (`/api/campaigns/dashboard-stats`,
 * `/api/campaigns/stats/[id]`) and the server-rendered dashboard/report
 * pages so the metric logic stays in one place.
 */

export interface DashboardOverview {
  totalActiveCampaigns: number;
  totalEnrolledCustomers: number;
  messagesSentToday: number;
  responsesToday: number;
}

export interface CampaignSummaryRow {
  id: string;
  name: string;
  status: string;
  totalEnrolled: number;
  stepDistribution: { step: number; count: number }[];
  responses: number;
  conversions: number;
}

export interface CampaignStats {
  campaignId: string;
  campaignName: string;
  status: string;
  messagesSent: number;
  deliveredCount: number;
  deliveryRate: number | null; // 0-100, null when no outbound messages
  responses: number;
  responseRate: number | null; // 0-100, null when no outbound messages
  enteredSalesFlow: number;
  converted: number;
  totalEnrolled: number;
  activeEnrolled: number;
  completedEnrolled: number;
  respondedEnrolled: number;
  removedEnrolled: number;
  failedMessages: number;
  stepBreakdown: {
    step: number;
    sent: number;
    delivered: number;
    responses: number;
  }[];
  recentInteractions: {
    id: string;
    phone_number: string;
    message_type: string;
    template_name: string | null;
    delivery_status: string;
    occurred_at: string;
  }[];
}

function startOfTodayUTC(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Aggregate overview numbers shown on the campaign dashboard.
 */
export async function getDashboardOverview(
  supabase: SupabaseClient
): Promise<DashboardOverview> {
  const today = startOfTodayUTC();

  const [activeCampaigns, activeEnrolments, outboundToday, inboundToday] =
    await Promise.all([
      supabase
        .from("campaigns")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("campaign_enrolments")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("campaign_interactions")
        .select("id", { count: "exact", head: true })
        .eq("message_type", "outbound")
        .gte("occurred_at", today),
      supabase
        .from("campaign_interactions")
        .select("id", { count: "exact", head: true })
        .eq("message_type", "inbound")
        .gte("occurred_at", today),
    ]);

  return {
    totalActiveCampaigns: activeCampaigns.count ?? 0,
    totalEnrolledCustomers: activeEnrolments.count ?? 0,
    messagesSentToday: outboundToday.count ?? 0,
    responsesToday: inboundToday.count ?? 0,
  };
}

/**
 * Per-campaign summary rows for the dashboard's active campaigns table.
 */
export async function getDashboardCampaignRows(
  supabase: SupabaseClient
): Promise<CampaignSummaryRow[]> {
  // Pull all campaigns (we'll surface active ones first but show others too).
  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("id, name, status")
    .order("updated_at", { ascending: false });

  if (error || !campaigns) return [];

  const rows: CampaignSummaryRow[] = [];

  for (const c of campaigns) {
    const [enrolmentsRes, interactionsRes] = await Promise.all([
      supabase
        .from("campaign_enrolments")
        .select("current_step, status")
        .eq("campaign_id", c.id),
      supabase
        .from("campaign_interactions")
        .select("phone_number")
        .eq("campaign_id", c.id)
        .eq("message_type", "inbound"),
    ]);

    const enrolments = enrolmentsRes.data ?? [];
    const inboundPhones = (interactionsRes.data ?? []).map((i) => i.phone_number);

    // Step distribution
    const stepMap = new Map<number, number>();
    for (const e of enrolments) {
      stepMap.set(e.current_step, (stepMap.get(e.current_step) ?? 0) + 1);
    }
    const stepDistribution = Array.from(stepMap.entries())
      .map(([step, count]) => ({ step, count }))
      .sort((a, b) => a.step - b.step);

    // Conversions: leads whose phone appears in this campaign's inbound
    // interactions AND whose lead status is 'converted'.
    const uniquePhones = Array.from(new Set(inboundPhones));
    let conversions = 0;
    if (uniquePhones.length > 0) {
      const { count } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .in("phone_number", uniquePhones)
        .eq("status", "converted");
      conversions = count ?? 0;
    }

    rows.push({
      id: c.id,
      name: c.name,
      status: c.status,
      totalEnrolled: enrolments.length,
      stepDistribution,
      responses: uniquePhones.length,
      conversions,
    });
  }

  // Active campaigns first, then by total enrolled desc.
  rows.sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (a.status !== "active" && b.status === "active") return 1;
    return b.totalEnrolled - a.totalEnrolled;
  });

  return rows;
}

/**
 * Detailed stats for a single campaign — used by the performance report.
 */
export async function getCampaignStats(
  supabase: SupabaseClient,
  campaignId: string
): Promise<CampaignStats | null> {
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("id, name, status")
    .eq("id", campaignId)
    .single();

  if (error || !campaign) return null;

  const [enrolmentsRes, interactionsRes, classificationsRes, recentRes] =
    await Promise.all([
      supabase
        .from("campaign_enrolments")
        .select("current_step, status")
        .eq("campaign_id", campaignId),
      supabase
        .from("campaign_interactions")
        .select("id, phone_number, step_number, message_type, template_name, delivery_status, occurred_at")
        .eq("campaign_id", campaignId)
        .order("occurred_at", { ascending: true }),
      supabase
        .from("campaign_classifications")
        .select("phone_number, classification")
        .order("created_at", { ascending: false }),
      supabase
        .from("campaign_interactions")
        .select("id, phone_number, message_type, template_name, delivery_status, occurred_at")
        .eq("campaign_id", campaignId)
        .order("occurred_at", { ascending: false })
        .limit(20),
    ]);

  const enrolments = enrolmentsRes.data ?? [];
  const interactions = interactionsRes.data ?? [];
  const classifications = classificationsRes.data ?? [];
  const recentInteractions = recentRes.data ?? [];

  const outbound = interactions.filter((i) => i.message_type === "outbound");
  const inbound = interactions.filter((i) => i.message_type === "inbound");
  const delivered = outbound.filter(
    (i) => i.delivery_status === "delivered" || i.delivery_status === "read"
  ).length;
  const failed = outbound.filter((i) => i.delivery_status === "failed").length;

  // Entered sales flow = classification interested OR needs_information
  // (dedupe by phone number — one per customer).
  const salesFlowPhones = new Set<string>();
  for (const c of classifications) {
    if (c.classification === "interested" || c.classification === "needs_information") {
      salesFlowPhones.add(c.phone_number);
    }
  }

  // Conversions: leads whose phone appears in this campaign's inbound
  // interactions AND whose lead status is 'converted'.
  const inboundPhones = Array.from(new Set(inbound.map((i) => i.phone_number)));
  let converted = 0;
  if (inboundPhones.length > 0) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .in("phone_number", inboundPhones)
      .eq("status", "converted");
    converted = count ?? 0;
  }

  // Step breakdown
  const stepMap = new Map<
    number,
    { sent: number; delivered: number; responses: number }
  >();
  for (const i of interactions) {
    const step = i.step_number ?? 0;
    if (!stepMap.has(step)) {
      stepMap.set(step, { sent: 0, delivered: 0, responses: 0 });
    }
    const entry = stepMap.get(step)!;
    if (i.message_type === "outbound") {
      entry.sent += 1;
      if (i.delivery_status === "delivered" || i.delivery_status === "read") {
        entry.delivered += 1;
      }
    } else {
      entry.responses += 1;
    }
  }
  const stepBreakdown = Array.from(stepMap.entries())
    .map(([step, v]) => ({ step, ...v }))
    .sort((a, b) => a.step - b.step);

  // Enrolment status counts
  const statusCounts = { active: 0, responded: 0, completed: 0, removed: 0 };
  for (const e of enrolments) {
    if (e.status in statusCounts) {
      statusCounts[e.status as keyof typeof statusCounts] += 1;
    }
  }

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    status: campaign.status,
    messagesSent: outbound.length,
    deliveredCount: delivered,
    deliveryRate: pct(delivered, outbound.length),
    responses: inbound.length,
    responseRate: pct(inbound.length, outbound.length),
    enteredSalesFlow: salesFlowPhones.size,
    converted,
    totalEnrolled: enrolments.length,
    activeEnrolled: statusCounts.active,
    completedEnrolled: statusCounts.completed,
    respondedEnrolled: statusCounts.responded,
    removedEnrolled: statusCounts.removed,
    failedMessages: failed,
    stepBreakdown,
    recentInteractions,
  };
}
