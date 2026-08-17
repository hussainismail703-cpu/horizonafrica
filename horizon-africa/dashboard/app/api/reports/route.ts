import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") ?? "month";

  const now = new Date();
  const startDate = new Date(now);

  if (range === "week") {
    startDate.setDate(startDate.getDate() - 7);
  } else if (range === "month") {
    startDate.setDate(startDate.getDate() - 30);
  } else if (range === "quarter") {
    startDate.setDate(startDate.getDate() - 90);
  } else if (range === "year") {
    startDate.setFullYear(startDate.getFullYear() - 1);
  } else {
    // all - no date filter
    startDate.setFullYear(2000);
  }

  const startDateISO = startDate.toISOString();

  const [
    allLeads,
    hotLeads,
    allConversations,
    allBroadcasts,
    escalatedLeads,
    recentLeads,
    recentConversations,
    broadcastHistory,
  ] = await Promise.all([
    supabase
      .from("leads")
      .select("lead_score, status, product_interest, created_at, needs_escalation")
      .gte("created_at", startDateISO),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("lead_score", "HOT")
      .gte("created_at", startDateISO),
    supabase
      .from("conversations")
      .select("created_at, lead_score")
      .gte("created_at", startDateISO),
    supabase
      .from("broadcast_history")
      .select("*", { count: "exact", head: true })
      .gte("created_at", startDateISO),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("needs_escalation", true)
      .gte("created_at", startDateISO),
    supabase
      .from("leads")
      .select("created_at")
      .gte("created_at", startDateISO)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("conversations")
      .select("created_at")
      .gte("created_at", startDateISO)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("broadcast_history")
      .select("*")
      .gte("created_at", startDateISO)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const totalLeads = allLeads.data?.length ?? 0;
  const totalHot = hotLeads.count ?? 0;
  const totalConversations = allConversations.data?.length ?? 0;
  const totalBroadcasts = allBroadcasts.count ?? 0;
  const totalEscalated = escalatedLeads.count ?? 0;
  const convertedCount =
    allLeads.data?.filter((l) => l.status === "converted").length ?? 0;
  const conversionRate =
    totalLeads > 0 ? Math.round((convertedCount / totalLeads) * 100) : 0;
  const escalationRate =
    totalLeads > 0 ? Math.round((totalEscalated / totalLeads) * 100) : 0;

  // Build time series based on range
  const buckets: { date: string; leads: number; conversations: number }[] = [];
  const bucketCount = range === "week" ? 7 : range === "month" ? 30 : range === "quarter" ? 90 : range === "year" ? 12 : 30;
  const isYearly = range === "year";

  if (isYearly) {
    // Monthly buckets for year view
    const monthMap: Record<string, { leads: number; conversations: number }> = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleDateString("en-ZA", { month: "short", year: "2-digit" });
      monthMap[key] = { leads: 0, conversations: 0 };
    }
    recentLeads.data?.forEach((lead) => {
      const d = new Date(lead.created_at);
      const key = d.toLocaleDateString("en-ZA", { month: "short", year: "2-digit" });
      if (monthMap[key]) monthMap[key].leads++;
    });
    recentConversations.data?.forEach((conv) => {
      const d = new Date(conv.created_at);
      const key = d.toLocaleDateString("en-ZA", { month: "short", year: "2-digit" });
      if (monthMap[key]) monthMap[key].conversations++;
    });
    Object.entries(monthMap).forEach(([date, vals]) =>
      buckets.push({ date, leads: vals.leads, conversations: vals.conversations })
    );
  } else {
    // Daily buckets
    const dateMap: Record<string, { leads: number; conversations: number }> = {};
    for (let i = bucketCount - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      dateMap[key] = { leads: 0, conversations: 0 };
    }
    recentLeads.data?.forEach((lead) => {
      const key = lead.created_at?.split("T")[0];
      if (key && dateMap[key]) dateMap[key].leads++;
    });
    recentConversations.data?.forEach((conv) => {
      const key = conv.created_at?.split("T")[0];
      if (key && dateMap[key]) dateMap[key].conversations++;
    });
    Object.entries(dateMap).forEach(([date, vals]) => {
      const d = new Date(date);
      buckets.push({
        date: d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" }),
        leads: vals.leads,
        conversations: vals.conversations,
      });
    });
  }

  // Score distribution
  const scoreCounts = { HOT: 0, WARM: 0, COLD: 0 };
  allLeads.data?.forEach((lead) => {
    if (lead.lead_score in scoreCounts) {
      scoreCounts[lead.lead_score as keyof typeof scoreCounts]++;
    }
  });
  const scoreDistribution = [
    { name: "HOT", value: scoreCounts.HOT, color: "#002050" },
    { name: "WARM", value: scoreCounts.WARM, color: "#b9c6ea" },
    { name: "COLD", value: scoreCounts.COLD, color: "#dae2fd" },
  ];

  // Status breakdown
  const statusOrder = ["new", "contacted", "qualified", "converted", "lost"];
  const statusLabels: Record<string, string> = {
    new: "New",
    contacted: "Contacted",
    qualified: "Qualified",
    converted: "Converted",
    lost: "Lost",
  };
  const statusCounts: Record<string, number> = {};
  allLeads.data?.forEach((lead) => {
    const s = lead.status ?? "new";
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  });
  const statusBreakdown = statusOrder
    .filter((s) => statusCounts[s] > 0)
    .map((s) => ({ status: statusLabels[s], count: statusCounts[s] }));

  // Broadcast performance
  const broadcastPerformance = (broadcastHistory.data ?? [])
    .slice(0, 6)
    .map((b) => ({
      name:
        b.campaign_name?.length > 15
          ? b.campaign_name.slice(0, 15) + "…"
          : b.campaign_name ?? "Untitled",
      sent: b.total_sent ?? 0,
      delivered: b.total_delivered ?? 0,
      read: b.total_read ?? 0,
      failed: b.total_failed ?? 0,
    }));

  // Product interests
  const interestCounts: Record<string, number> = {};
  allLeads.data?.forEach((lead) => {
    const interest = lead.product_interest;
    if (interest && interest.trim()) {
      interestCounts[interest] = (interestCounts[interest] ?? 0) + 1;
    }
  });
  const productInterests = Object.entries(interestCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Escalation summary
  const escalationData = [
    { type: "Escalated to Human", count: totalEscalated, color: "#f06000" },
    { type: "Handled by AI", count: Math.max(0, totalLeads - totalEscalated), color: "#002050" },
  ];

  return NextResponse.json({
    kpis: {
      totalLeads,
      totalHot,
      totalConversations,
      totalBroadcasts,
      totalEscalated,
      conversionRate,
      escalationRate,
    },
    leadsOverTime: buckets,
    scoreDistribution,
    statusBreakdown,
    broadcastPerformance,
    productInterests,
    escalationRate: escalationData,
  });
}
