import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface ServiceCheck {
  name: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number | null;
  message: string;
  details?: Record<string, unknown>;
}

async function checkSupabase(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const [leads, conversations, broadcasts, followUps] = await Promise.all([
      supabase.from("leads").select("*", { count: "exact", head: true }),
      supabase.from("conversations").select("*", { count: "exact", head: true }),
      supabase.from("broadcast_history").select("*", { count: "exact", head: true }),
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("follow_up_requested", true).eq("follow_up_sent", false),
    ]);

    const latency = Date.now() - start;

    const tablesOk = !leads.error && !conversations.error && !broadcasts.error;
    const authOk = user !== null;

    if (!tablesOk) {
      return {
        name: "Supabase Database",
        status: "degraded",
        latencyMs: latency,
        message: "Auth OK but some tables returned errors",
        details: {
          auth: authOk,
          leadsError: leads.error?.message,
          conversationsError: conversations.error?.message,
          broadcastsError: broadcasts.error?.message,
        },
      };
    }

    return {
      name: "Supabase Database",
      status: "healthy",
      latencyMs: latency,
      message: "All tables accessible",
      details: {
        auth: authOk,
        leadsCount: leads.count,
        conversationsCount: conversations.count,
        broadcastsCount: broadcasts.count,
        pendingFollowUps: followUps.count,
      },
    };
  } catch (err) {
    return {
      name: "Supabase Database",
      status: "down",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

async function checkMetaWhatsApp(): Promise<ServiceCheck> {
  const start = Date.now();
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  const apiVersion = process.env.META_API_VERSION || "v21.0";

  if (!phoneNumberId || !accessToken) {
    return {
      name: "Meta WhatsApp API",
      status: "down",
      latencyMs: null,
      message: "META_PHONE_NUMBER_ID or META_ACCESS_TOKEN not configured",
    };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=display_phone_number,verified_name,messaging_limit_tier,quality_rating`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
      }
    );

    const latency = Date.now() - start;

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        name: "Meta WhatsApp API",
        status: "down",
        latencyMs: latency,
        message: `API returned ${res.status}`,
        details: { error: body?.error?.message ?? res.statusText },
      };
    }

    const data = await res.json();
    const quality = data.quality_rating;
    const tier = data.messaging_limit_tier;

    let status: ServiceCheck["status"] = "healthy";
    const displayNumber = data.display_phone_number ?? "unknown";
    let message = `Connected — ${displayNumber}`;

    if (quality && quality.toUpperCase() === "RED") {
      status = "down";
      message = `Quality rating is RED — ${displayNumber}`;
    } else if (quality && quality.toUpperCase() === "YELLOW") {
      status = "degraded";
      message = `Quality rating is YELLOW — ${displayNumber}`;
    }

    return {
      name: "Meta WhatsApp API",
      status,
      latencyMs: latency,
      message,
      details: {
        phoneNumber: displayNumber,
        verifiedName: data.verified_name,
        qualityRating: quality,
        messagingLimitTier: tier,
      },
    };
  } catch (err) {
    return {
      name: "Meta WhatsApp API",
      status: "down",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Request failed",
    };
  }
}

interface OpenRouterCredits {
  limit: number | null;
  usage: number | null;
  usageDaily: number | null;
  usageWeekly: number | null;
  usageMonthly: number | null;
  remaining: number | null;
  isFreeTier: boolean | null;
}

async function checkOpenRouterCredits(apiKey: string): Promise<OpenRouterCredits> {
  const empty: OpenRouterCredits = { limit: null, usage: null, usageDaily: null, usageWeekly: null, usageMonthly: null, remaining: null, isFreeTier: null };
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return empty;
    const json = await res.json();
    const d = json?.data;
    return {
      limit: d?.limit ?? null,
      usage: d?.usage ?? null,
      usageDaily: d?.usage_daily ?? null,
      usageWeekly: d?.usage_weekly ?? null,
      usageMonthly: d?.usage_monthly ?? null,
      remaining: d?.limit_remaining ?? null,
      isFreeTier: d?.is_free_tier ?? null,
    };
  } catch {
    return empty;
  }
}

async function checkN8n(): Promise<ServiceCheck> {
  const start = Date.now();
  const n8nUrl = "https://n8n.horizonafrica.co.za";

  try {
    const res = await fetch(`${n8nUrl}/healthz`, {
      signal: AbortSignal.timeout(8000),
    });

    const latency = Date.now() - start;

    if (!res.ok) {
      return {
        name: "n8n Workflow Engine",
        status: "degraded",
        latencyMs: latency,
        message: `Healthz returned ${res.status}`,
      };
    }

    return {
      name: "n8n Workflow Engine",
      status: "healthy",
      latencyMs: latency,
      message: "n8n is responding",
    };
  } catch (err) {
    try {
      const res2 = await fetch(`${n8nUrl}/`, {
        signal: AbortSignal.timeout(8000),
      });
      const latency = Date.now() - start;
      if (res2.ok || res2.status === 401 || res2.status === 302) {
        return {
          name: "n8n Workflow Engine",
          status: "healthy",
          latencyMs: latency,
          message: "n8n is reachable (healthz endpoint not found but server responds)",
        };
      }
      return {
        name: "n8n Workflow Engine",
        status: "down",
        latencyMs: latency,
        message: `Server returned ${res2.status}`,
      };
    } catch {
      return {
        name: "n8n Workflow Engine",
        status: "down",
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : "Connection failed",
      };
    }
  }
}

async function checkOpenRouter(): Promise<ServiceCheck> {
  const start = Date.now();
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return {
      name: "OpenRouter AI",
      status: "down",
      latencyMs: null,
      message: "OPENROUTER_API_KEY not configured",
    };
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });

    const latency = Date.now() - start;

    if (!res.ok) {
      return {
        name: "OpenRouter AI",
        status: "down",
        latencyMs: latency,
        message: `API returned ${res.status}`,
      };
    }

    const data = await res.json();
    const modelCount = data?.data?.length ?? 0;
    const credits = await checkOpenRouterCredits(apiKey);

    const fmt = (v: number | null) => v !== null ? `$${v.toFixed(2)}` : "—";
    let message = `API key valid — ${modelCount} models available`;
    if (credits.remaining !== null) {
      message += ` — ${fmt(credits.remaining)} credits remaining`;
    } else if (credits.usage !== null) {
      message += ` — ${fmt(credits.usageMonthly)} used this month`;
    }

    return {
      name: "OpenRouter AI",
      status: "healthy",
      latencyMs: latency,
      message,
      details: {
        totalUsage: credits.usage !== null ? fmt(credits.usage) : "—",
        monthlyUsage: credits.usageMonthly !== null ? fmt(credits.usageMonthly) : "—",
        weeklyUsage: credits.usageWeekly !== null ? fmt(credits.usageWeekly) : "—",
        dailyUsage: credits.usageDaily !== null ? fmt(credits.usageDaily) : "—",
        creditsRemaining: credits.remaining !== null ? fmt(credits.remaining) : "Unlimited",
        plan: credits.isFreeTier === true ? "Free tier" : credits.isFreeTier === false ? "Paid" : "—",
      },
    };
  } catch (err) {
    return {
      name: "OpenRouter AI",
      status: "down",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Request failed",
    };
  }
}

async function checkChatwoot(): Promise<ServiceCheck> {
  const start = Date.now();
  const chatwootUrl = "https://chat.horizonafrica.co.za";

  try {
    const res = await fetch(`${chatwootUrl}/api`, {
      signal: AbortSignal.timeout(8000),
    });

    const latency = Date.now() - start;

    if (res.ok || res.status === 401 || res.status === 404) {
      return {
        name: "Chatwoot Live Chat",
        status: "healthy",
        latencyMs: latency,
        message: "Chatwoot is reachable",
      };
    }

    return {
      name: "Chatwoot Live Chat",
      status: "degraded",
      latencyMs: latency,
      message: `Server returned ${res.status}`,
    };
  } catch (err) {
    return {
      name: "Chatwoot Live Chat",
      status: "down",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

async function checkWebhookProxy(): Promise<ServiceCheck> {
  const start = Date.now();
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://dashboard.horizonafrica.co.za";

  try {
    const res = await fetch(`${baseUrl}/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=horizon_africa_verify_2026&hub.challenge=healthcheck`, {
      signal: AbortSignal.timeout(8000),
    });

    const latency = Date.now() - start;

    if (res.ok) {
      return {
        name: "WhatsApp Webhook Proxy",
        status: "healthy",
        latencyMs: latency,
        message: "Webhook proxy is responding to verification",
      };
    }

    return {
      name: "WhatsApp Webhook Proxy",
      status: "degraded",
      latencyMs: latency,
      message: `Proxy returned ${res.status}`,
    };
  } catch (err) {
    return {
      name: "WhatsApp Webhook Proxy",
      status: "down",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Request failed",
    };
  }
}

async function checkRecentErrors(): Promise<{
  overdueFollowUps: number;
  failedBroadcasts: number;
  escalatedLeads: number;
  staleLeads: number;
}> {
  try {
    const supabase = await createClient();
    const now = new Date().toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const [overdue, failed, escalated, stale] = await Promise.all([
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("follow_up_requested", true).eq("follow_up_sent", false).lte("follow_up_date", now),
      supabase.from("broadcast_history").select("*", { count: "exact", head: true }).gt("total_failed", 0),
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("needs_escalation", true),
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "new").lt("created_at", threeDaysAgo),
    ]);

    return {
      overdueFollowUps: overdue.count ?? 0,
      failedBroadcasts: failed.count ?? 0,
      escalatedLeads: escalated.count ?? 0,
      staleLeads: stale.count ?? 0,
    };
  } catch {
    return {
      overdueFollowUps: 0,
      failedBroadcasts: 0,
      escalatedLeads: 0,
      staleLeads: 0,
    };
  }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [services, recentErrors] = await Promise.all([
    Promise.all([
      checkSupabase(),
      checkMetaWhatsApp(),
      checkN8n(),
      checkOpenRouter(),
      checkChatwoot(),
      checkWebhookProxy(),
    ]),
    checkRecentErrors(),
  ]);

  const healthyCount = services.filter((s) => s.status === "healthy").length;
  const degradedCount = services.filter((s) => s.status === "degraded").length;
  const downCount = services.filter((s) => s.status === "down").length;

  const overallStatus = downCount > 0 ? "down" : degradedCount > 0 ? "degraded" : "healthy";

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    overall: {
      status: overallStatus,
      healthy: healthyCount,
      degraded: degradedCount,
      down: downCount,
      total: services.length,
    },
    services,
    issues: recentErrors,
  });
}
