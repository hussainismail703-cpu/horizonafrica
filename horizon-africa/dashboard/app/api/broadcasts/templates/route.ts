import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const META_API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const META_WABA_ID = process.env.META_WABA_ID!;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN!;

interface MetaTemplateComponent {
  type: string;
  text?: string;
  format?: string;
  buttons?: Array<{ type: string; text: string }>;
}

interface MetaTemplate {
  name: string;
  status: string;
  language: string;
  category: string;
  components: MetaTemplateComponent[];
}

interface MetaTemplatesResponse {
  data: MetaTemplate[];
  paging?: {
    cursors: { before: string; after: string };
    next?: string;
  };
}

const LABEL_MAP: Record<string, string> = {
  hello_world: "Hello World (Test)",
  horizon_welcome_v1: "Welcome to Horizon Africa",
  horizon_followup_v5: "Follow-up Enquiry",
  horizon_followup_v6: "Follow-up Enquiry v6",
  horizon_promo_v1: "Horizon Promo",
  horizon_service_update_v1: "Service Update",
  telkom_prepaid_offer: "Telkom Prepaid Offer",
  telkom_reengagement: "Telkom Re-engagement",
  telkom_fibre_packages: "Telkom Fibre Packages",
  telkom_payment_instructions_v2: "Telkom Payment Instructions",
  telkom_deposit_required_v2: "Telkom Deposit Required",
  telkom_credit_approved_v2: "Telkom Credit Approved",
  telkom_consultant_call_v2: "Telkom Consultant Call",
  telkom_app_confirmation_v2: "Telkom App Confirmation",
  telkom_credit_declined: "Telkom Credit Declined",
};

function formatLabel(name: string): string {
  if (LABEL_MAP[name]) return LABEL_MAP[name];
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatStatus(status: string): string {
  return status.toLowerCase();
}

function extractParameters(components: MetaTemplateComponent[]): { position: number; label: string; component: string }[] {
  const params: { position: number; label: string; component: string }[] = [];
  for (const comp of components) {
    const compType = comp.type.toUpperCase();
    if (compType !== "HEADER" && compType !== "BODY") continue;
    if (!comp.text) continue;
    const matches = [...comp.text.matchAll(/\{\{(\d+)\}\}/g)];
    for (const m of matches) {
      const compLabel = compType === "HEADER" ? "Header" : "Body";
      params.push({
        position: Number(m[1]),
        label: `${compLabel} Param ${m[1]}`,
        component: compType.toLowerCase(),
      });
    }
  }
  return params.sort((a, b) => a.position - b.position);
}

function getBodyText(components: MetaTemplateComponent[]): string | null {
  const body = components.find((c) => c.type.toUpperCase() === "BODY");
  return body?.text ?? null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!META_WABA_ID || !META_ACCESS_TOKEN) {
    return NextResponse.json(
      { error: "META_WABA_ID and META_ACCESS_TOKEN must be configured" },
      { status: 500 }
    );
  }

  try {
    const allTemplates: MetaTemplate[] = [];
    let url: string | null =
      `https://graph.facebook.com/${META_API_VERSION}/${META_WABA_ID}/message_templates?fields=name,status,language,category,components&limit=100`;

    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
      });

      if (!res.ok) {
        const errorBody = await res.text();
        return NextResponse.json(
          { error: `Meta API error: ${res.status} ${errorBody}` },
          { status: res.status }
        );
      }

      const data: MetaTemplatesResponse = await res.json();
      allTemplates.push(...data.data);

      url = data.paging?.next ?? null;
    }

    const templates = allTemplates
      .filter((t) => t.status === "APPROVED")
      .map((t) => ({
        name: t.name,
        label: formatLabel(t.name),
        status: formatStatus(t.status),
        category: t.category,
        language: t.language,
        parameters: extractParameters(t.components),
        body_text: getBodyText(t.components),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return NextResponse.json({ templates });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch templates from Meta" },
      { status: 500 }
    );
  }
}
