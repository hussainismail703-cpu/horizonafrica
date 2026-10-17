import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizePhone } from "@/lib/phone-utils";
import { syncAllCustomers } from "@/lib/shopify-sync";
import { isShopifyConfigured } from "@/lib/shopify";
import type { ShopifyCustomerRow } from "@/lib/types";

const GROUP_NAME = "eastern_wear_customers";
const GROUP_LABEL = "Eastern Wear Customers";

async function authorized(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  const appSecret = process.env.APP_SECRET;
  if (appSecret && authHeader === `Bearer ${appSecret}`) return true;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return Boolean(user);
}

/**
 * Sync Shopify customers into broadcast_contacts (scope freeze §4.7).
 * Pulls a fresh customer list first so marketing-consent state is current,
 * then upserts contacts into the "Eastern Wear Customers" group:
 *   - opt_in=false when Shopify says no marketing consent, or the number is
 *     on the global opt_out_list
 *   - existing contacts are only ever downgraded to opt_in=false, never
 *     re-enabled — a manual removal stays removed
 */
export async function POST(request: NextRequest) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isShopifyConfigured()) {
    return NextResponse.json(
      { error: "Shopify is not configured" },
      { status: 503 }
    );
  }

  const supabase = createServiceClient();

  // Refresh customer consent state from Shopify before mapping to contacts.
  try {
    await syncAllCustomers(supabase);
  } catch (err) {
    return NextResponse.json(
      { error: `Shopify customer sync failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 }
    );
  }

  // Ensure the target group exists.
  let { data: group } = await supabase
    .from("broadcast_groups")
    .select("id")
    .eq("group_name", GROUP_NAME)
    .maybeSingle();
  if (!group) {
    const { data: created, error: gErr } = await supabase
      .from("broadcast_groups")
      .insert({
        group_name: GROUP_NAME,
        group_label: GROUP_LABEL,
        description: "Customers synced from the Eastern Wear Shopify store",
      })
      .select("id")
      .single();
    if (gErr || !created) {
      return NextResponse.json(
        { error: gErr?.message ?? "Failed to create broadcast group" },
        { status: 500 }
      );
    }
    group = created;
  }

  const { data: customers, error: cErr } = await supabase
    .from("shopify_customers")
    .select("*")
    .not("phone", "is", null);
  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  const { data: optedOutRows } = await supabase
    .from("opt_out_list")
    .select("phone_number");
  const optedOut = new Set(
    (optedOutRows ?? []).map((o) => normalizePhone(o.phone_number))
  );

  const { data: existing } = await supabase
    .from("broadcast_contacts")
    .select("id, phone_number, opt_in")
    .eq("group_id", group.id);
  const existingByPhone = new Map(
    (existing ?? []).map((c) => [normalizePhone(c.phone_number), c])
  );

  let created = 0;
  let updated = 0;
  let optedOutCount = 0;
  let noConsent = 0;
  const syncedIds: number[] = [];

  for (const customer of (customers ?? []) as ShopifyCustomerRow[]) {
    const phone = customer.phone ? normalizePhone(customer.phone) : null;
    if (!phone) continue;
    syncedIds.push(customer.shopify_customer_id);

    const isOptedOut = optedOut.has(phone);
    const declined = customer.accepts_marketing === false;
    if (isOptedOut) optedOutCount++;
    if (declined) noConsent++;

    const optIn = !isOptedOut && !declined;
    const prior = existingByPhone.get(phone);

    if (!prior) {
      const { error: insErr } = await supabase
        .from("broadcast_contacts")
        .insert({
          phone_number: phone,
          contact_name: customer.full_name,
          group_id: group.id,
          opt_in: optIn,
          source: "shopify",
        });
      if (insErr) {
        // Unique (group_id, phone_number) race — treat as update instead.
        if (insErr.code !== "23505") {
          console.error("[sync-shopify] contact insert failed:", insErr.message);
          continue;
        }
      } else {
        created++;
        continue;
      }
    }

    // Existing contact: refresh name/source; only ever downgrade opt_in.
    const nextOptIn = prior ? prior.opt_in && optIn : optIn;
    const { error: upErr } = await supabase
      .from("broadcast_contacts")
      .update({
        contact_name: customer.full_name,
        opt_in: nextOptIn,
        source: "shopify",
      })
      .eq("group_id", group.id)
      .eq("phone_number", phone);
    if (!upErr) updated++;
  }

  if (syncedIds.length) {
    await supabase
      .from("shopify_customers")
      .update({
        synced_to_broadcast: true,
        last_synced_at: new Date().toISOString(),
      })
      .in("shopify_customer_id", syncedIds);
  }

  return NextResponse.json({
    group_id: group.id,
    group_label: GROUP_LABEL,
    customers_synced: syncedIds.length,
    contacts_created: created,
    contacts_updated: updated,
    opted_out_excluded: optedOutCount,
    no_marketing_consent: noConsent,
  });
}
