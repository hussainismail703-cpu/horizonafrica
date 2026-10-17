#!/usr/bin/env node
/**
 * Eastern Wear M6 — Unpaid-Order Follow-Ups + Broadcast Readiness test.
 *
 * Verifies the scope-freeze §4.5/§4.7 requirements:
 *   A. Order created → pending_payment → follow_ups nudge row scheduled
 *      (created_at + FOLLOWUP_HOURS[0]).
 *   B. Cron processes due nudges: send → status/meta_message_id recorded,
 *      next step queued on success; failure path records the Meta error.
 *   C. Stop conditions: paid webhook cancels nudges, global opt-out cancels,
 *      declined (lost) lead cancels.
 *   D. Broadcast readiness: Shopify customers sync into the "Eastern Wear
 *      Customers" group with marketing-consent + opt-out rules enforced.
 *   E. Dashboard UI: /follow-ups renders order nudges, /broadcasts shows the
 *      Sync Shopify button.
 *
 * Usage:
 *   node --env-file=.env.local tests/m6-followups-broadcast-test.mjs
 *   node --env-file=.env.local tests/m6-followups-broadcast-test.mjs --headed
 *   node --env-file=.env.local tests/m6-followups-broadcast-test.mjs --skip-ui
 *   node --env-file=.env.local tests/m6-followups-broadcast-test.mjs --live
 *
 * Safety: fake phone numbers (2779961xxxx) are used unless --live is passed.
 * Meta accepts syntactically valid numbers and reports delivery failure via
 * async callbacks, so sends to fake numbers bounce without reaching anyone.
 * --live uses the approved test number 27832763116 for one real nudge.
 * Test rows are tagged [M6-TEST] and removed in cleanup.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { chromium } from "playwright";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));

const BASE_URL = process.env.TEST_TARGET || "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_SECRET = process.env.APP_SECRET;
const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET;
const TEST_EMAIL = process.env.TEST_EMAIL || "test@horizonafrica.co.za";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "TestPass123!";
const HEADED = process.argv.includes("--headed");
const SKIP_UI = process.argv.includes("--skip-ui");
const LIVE = process.argv.includes("--live");

// --live sends a real WhatsApp nudge to the approved test number.
// Prefixes must pass Shopify's phone validation — 79 is a valid SA range.
const ORDER_PHONE = LIVE ? "27832763116" : "27799610601";
const PAID_PHONE = "27799610602";
const OPTOUT_PHONE = "27799610603";
const DECLINED_PHONE = "27799610604";
const BC_YES = "27799610701";
const BC_NO = "27799610702";
const BC_OPTOUT = "27799610703";
const BC_MANUAL = "27799610704";
const ALL_PHONES = [ORDER_PHONE, PAID_PHONE, OPTOUT_PHONE, DECLINED_PHONE, BC_YES, BC_NO, BC_OPTOUT, BC_MANUAL];
const TEST_TAG = "[M6-TEST]";
const FAKE_CUSTOMER_IDS = [999600701, 999600702, 999600703, 999600704];

const RESULTS_FILE = path.join(process.cwd(), "tests", "m6-followups-results.json");
const SCREENSHOT_DIR = path.join(process.cwd(), "tests", "screenshots", "m6-followups");

const missing = [
  ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
  ["APP_SECRET", APP_SECRET],
  ["SHOPIFY_STORE_DOMAIN", STORE_DOMAIN],
  ["SHOPIFY_CLIENT_ID", process.env.SHOPIFY_CLIENT_ID],
  ["SHOPIFY_CLIENT_SECRET", process.env.SHOPIFY_CLIENT_SECRET],
].filter(([, value]) => !value).map(([key]) => key);

const results = [];
let currentTrack = "setup";

function record(status, name, detail = "") {
  results.push({ track: currentTrack, name, status, detail });
  console.log(`  ${status}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const pass = (name, detail) => record("PASS", name, detail);
const fail = (name, detail) => record("FAIL", name, detail);
const warn = (name, detail) => record("WARN", name, detail);

async function sb(pathname, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${pathname}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...options.headers,
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, ok: res.ok };
}

async function api(pathname, options = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.auth ? { Authorization: `Bearer ${APP_SECRET}` } : {}),
      ...options.headers,
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, ok: res.ok };
}

async function waitFor(label, fn, timeoutMs = 15_000, intervalMs = 750) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function shopifyToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const res = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Shopify token request failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

async function deleteShopifyDraft(draftOrderId) {
  if (!draftOrderId) return;
  const token = await shopifyToken();
  const res = await fetch(
    `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/draft_orders/${draftOrderId}.json`,
    { method: "DELETE", headers: { "X-Shopify-Access-Token": token } }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Shopify draft cleanup failed: HTTP ${res.status}`);
  }
}

function shopifySignature(rawBody) {
  return crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody, "utf8").digest("base64");
}

async function findTestVariant() {
  const res = await sb(
    "/shopify_variants?select=shopify_variant_id,inventory_item_id,title,price_cents,inventory_qty,available,shopify_products!inner(title,is_active)&available=eq.true&inventory_item_id=not.is.null&shopify_products.is_active=eq.true&limit=100"
  );
  if (!res.ok) throw new Error(`variant query failed: ${JSON.stringify(res.body)}`);
  for (const row of res.body ?? []) {
    const stock = await api(`/api/shopify/stock?variant_id=${row.shopify_variant_id}`, { auth: true });
    const live = stock.body?.results?.[0];
    if (stock.ok && live?.available && live.inventory_qty >= 1 && live.inventory_qty < 50) {
      return { ...row, live_inventory_qty: live.inventory_qty };
    }
  }
  throw new Error("No active in-stock Shopify variant found for testing");
}

async function insertOrder(phone, overrides = {}) {
  const res = await sb("/orders", {
    method: "POST",
    body: JSON.stringify({
      phone_number: phone,
      customer_name: `${TEST_TAG} Customer`,
      order_track: "stock_on_hand",
      items: [{ product_title: `${TEST_TAG} Item`, variant_id: 1, qty: 1, unit_price_cents: 10000 }],
      subtotal_cents: 10000,
      total_cents: 10000,
      delivery_method: "collection",
      status: "pending_payment",
      ...overrides,
    }),
  });
  if (!res.ok) throw new Error(`order insert failed: ${JSON.stringify(res.body)}`);
  return res.body[0];
}

async function insertNudge(orderId, phone, overrides = {}) {
  const res = await sb("/follow_ups", {
    method: "POST",
    body: JSON.stringify({
      order_id: orderId,
      phone_number: phone,
      sequence_step: 1,
      template_name: "horizon_followup_v6",
      scheduled_for: new Date(Date.now() - 60_000).toISOString(),
      status: "pending",
      ...overrides,
    }),
  });
  if (!res.ok) throw new Error(`nudge insert failed: ${JSON.stringify(res.body)}`);
  return res.body[0];
}

async function nudgeState(id) {
  const res = await sb(`/follow_ups?id=eq.${id}&select=status,error,meta_message_id,sent_at&limit=1`);
  return res.body?.[0] ?? null;
}

// Track state for cleanup
let liveDraftOrderId = null;
const orderIds = [];
const nudgeIds = [];
const leadIds = [];
let pausedLeadFollowUps = [];
let cronRunAvailable = false;

async function runCron() {
  const res = await api("/api/follow-ups/cron", { method: "POST", auth: true });
  return res;
}

async function main() {
  console.log(`\n=== Eastern Wear M6: Follow-Ups + Broadcast test ===`);
  console.log(`Target: ${BASE_URL} · live sends: ${LIVE ? `ON (${ORDER_PHONE})` : "OFF (fake numbers)"}\n`);

  if (missing.length) {
    for (const key of missing) fail(`Env var ${key}`, "missing");
    return summarize();
  }

  const health = await api("/login");
  if (health.status !== 200) {
    fail("Dev server reachable", `HTTP ${health.status} on ${BASE_URL}/login`);
    return summarize();
  }
  pass("Dev server reachable");

  // Prevent the lead-follow-up half of the cron from sending real WhatsApp
  // messages to real leads while we test the order half.
  const flaggedLeads = await sb("/leads?follow_up_requested=eq.true&select=id");
  pausedLeadFollowUps = (flaggedLeads.body ?? []).map((l) => l.id);
  if (pausedLeadFollowUps.length) {
    await sb(`/leads?id=in.(${pausedLeadFollowUps.join(",")})`, {
      method: "PATCH",
      body: JSON.stringify({ follow_up_requested: false }),
    });
    warn("Lead follow-ups paused during test", `${pausedLeadFollowUps.length} leads will be restored`);
  }

  try {
    // ======================== TRACK A: Scheduling =========================
    currentTrack = "A-schedule";
    console.log("\nA. Order creation → nudge scheduling");

    const variant = await findTestVariant();
    pass("In-stock Shopify variant found", `${variant.title} qty=${variant.live_inventory_qty}`);

    const createRes = await api("/api/orders/create", {
      method: "POST",
      auth: true,
      body: JSON.stringify({
        phone: ORDER_PHONE,
        delivery_method: "collection",
        items: [{ variant_id: variant.shopify_variant_id, qty: 1 }],
      }),
    });
    createRes.status === 200 || createRes.status === 201
      ? pass("Order created via API", `status=${createRes.status}`)
      : fail("Order created via API", `HTTP ${createRes.status}: ${JSON.stringify(createRes.body)}`);

    const liveOrder = await waitFor("live order row", async () => {
      const res = await sb(`/orders?phone_number=eq.${ORDER_PHONE}&order=created_at.desc&limit=1`);
      return res.body?.[0] ?? null;
    });
    orderIds.push(liveOrder.id);
    liveDraftOrderId = liveOrder.shopify_draft_order_id;
    if (liveOrder.lead_id) leadIds.push(liveOrder.lead_id);
    liveOrder.status === "pending_payment"
      ? pass("Order row persisted pending_payment", `#${liveOrder.order_number}`)
      : fail("Order row persisted pending_payment", `status=${liveOrder.status}`);

    const nudge = await waitFor("scheduled follow_ups row", async () => {
      const res = await sb(`/follow_ups?order_id=eq.${liveOrder.id}&select=*&limit=1`);
      return res.body?.[0] ?? null;
    });
    nudgeIds.push(nudge.id);

    const nudgeChecks = [
      [nudge.sequence_step === 1, "sequence_step=1"],
      [nudge.status === "pending", "status=pending"],
      [nudge.phone_number === ORDER_PHONE, `phone=${nudge.phone_number}`],
      [nudge.template_name?.length > 0, `template=${nudge.template_name}`],
    ];
    const firstNudgeHours = Number((process.env.FOLLOWUP_HOURS ?? "4,24,72").split(",")[0]) || 4;
    const expectedAt = new Date(liveOrder.created_at).getTime() + firstNudgeHours * 3_600_000;
    nudgeChecks.push([
      Math.abs(new Date(nudge.scheduled_for).getTime() - expectedAt) < 120_000,
      `scheduled_for ≈ created_at +${firstNudgeHours}h`,
    ]);
    nudgeChecks.every(([ok]) => ok)
      ? pass("Nudge step 1 scheduled correctly")
      : fail("Nudge step 1 scheduled correctly", nudgeChecks.filter(([ok]) => !ok).map(([, l]) => l).join(", "));

    // ===================== TRACK B: Cron processing =======================
    currentTrack = "B-cron";
    console.log("\nB. Cron processing of due nudges");

    await sb(`/follow_ups?id=eq.${nudge.id}`, {
      method: "PATCH",
      body: JSON.stringify({ scheduled_for: new Date(Date.now() - 60_000).toISOString() }),
    });

    const cronRes = await runCron();
    cronRunAvailable = cronRes.ok;
    cronRes.ok
      ? pass("Follow-ups cron accepted", `HTTP ${cronRes.status}`)
      : fail("Follow-ups cron accepted", `HTTP ${cronRes.status}: ${JSON.stringify(cronRes.body)}`);

    const ofu = cronRes.body?.order_follow_ups;
    ofu && ofu.processed >= 1
      ? pass("Cron processed order follow-ups", `processed=${ofu.processed} sent=${ofu.sent} failed=${ofu.failed}`)
      : fail("Cron processed order follow-ups", JSON.stringify(cronRes.body ?? {}));

    const afterSend = await nudgeState(nudge.id);
    if (LIVE) {
      afterSend?.status === "sent" && afterSend.meta_message_id && afterSend.sent_at
        ? pass("Nudge sent via Meta", `wamid=${afterSend.meta_message_id}`)
        : fail("Nudge sent via Meta", JSON.stringify(afterSend));

      const step2 = await waitFor("step-2 nudge scheduled", async () => {
        const res = await sb(`/follow_ups?order_id=eq.${liveOrder.id}&sequence_step=eq.2&select=*&limit=1`);
        return res.body?.[0] ?? null;
      });
      nudgeIds.push(step2.id);
      const secondHours = Number((process.env.FOLLOWUP_HOURS ?? "4,24,72").split(",")[1]) || 24;
      const expected2 = new Date(liveOrder.created_at).getTime() + secondHours * 3_600_000;
      step2.status === "pending" && Math.abs(new Date(step2.scheduled_for).getTime() - expected2) < 120_000
        ? pass("Nudge step 2 scheduled after send", `≈ +${secondHours}h`)
        : fail("Nudge step 2 scheduled after send", JSON.stringify(step2));
    } else {
      // Meta accepts syntactically valid numbers even when unregistered —
      // it returns a wamid and reports failure later via a status callback.
      // Assert coherent behaviour for whichever outcome occurs.
      const accepted = afterSend?.status === "sent" && afterSend.meta_message_id;
      const rejected = afterSend?.status === "failed" && afterSend.error;
      if (accepted) {
        pass("Nudge send accepted by Meta", `wamid=${afterSend.meta_message_id}`);

        const step2 = await waitFor("step-2 nudge scheduled", async () => {
          const res = await sb(`/follow_ups?order_id=eq.${liveOrder.id}&sequence_step=eq.2&select=*&limit=1`);
          return res.body?.[0] ?? null;
        });
        nudgeIds.push(step2.id);
        const secondHours = Number((process.env.FOLLOWUP_HOURS ?? "4,24,72").split(",")[1]) || 24;
        const expected2 = new Date(liveOrder.created_at).getTime() + secondHours * 3_600_000;
        step2.status === "pending" && Math.abs(new Date(step2.scheduled_for).getTime() - expected2) < 120_000
          ? pass("Nudge step 2 scheduled after send", `≈ +${secondHours}h`)
          : fail("Nudge step 2 scheduled after send", JSON.stringify(step2));
      } else if (rejected) {
        pass("Nudge send failure recorded (fake number)", afterSend.error.slice(0, 80));

        const step2 = await sb(`/follow_ups?order_id=eq.${liveOrder.id}&sequence_step=eq.2&select=id&limit=1`);
        (step2.body ?? []).length === 0
          ? pass("No step-2 nudge after failed send")
          : fail("No step-2 nudge after failed send", "step-2 row exists");
      } else {
        fail("Nudge send outcome recorded", JSON.stringify(afterSend));
      }
    }

    // ===================== TRACK C: Stop conditions =======================
    currentTrack = "C-stop";
    console.log("\nC. Stop conditions (paid / opt-out / declined)");

    // C1: paid via signed Shopify orders/paid webhook → nudge cancelled.
    const paidOrder = await insertOrder(PAID_PHONE);
    orderIds.push(paidOrder.id);
    const paidNudge = await insertNudge(paidOrder.id, PAID_PHONE);
    nudgeIds.push(paidNudge.id);

    const paidPayload = {
      id: Number(`91${Date.now().toString().slice(-11)}`),
      name: `#M6-PAID-${Date.now().toString().slice(-6)}`,
      processed_at: new Date().toISOString(),
      note_attributes: [{ name: "layla_order_id", value: paidOrder.id }],
    };
    const rawPaid = JSON.stringify(paidPayload);
    const paidWebhook = await fetch(`${BASE_URL}/api/shopify/webhooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Topic": "orders/paid",
        "X-Shopify-Webhook-Id": `m6-paid-${Date.now()}`,
        "X-Shopify-Hmac-Sha256": shopifySignature(rawPaid),
      },
      body: rawPaid,
    });
    paidWebhook.status === 200
      ? pass("Signed orders/paid webhook accepted")
      : fail("Signed orders/paid webhook accepted", `HTTP ${paidWebhook.status}`);

    const paidRow = await waitFor("order marked paid", async () => {
      const res = await sb(`/orders?id=eq.${paidOrder.id}&select=status&limit=1`);
      return res.body?.[0]?.status === "paid" ? res.body[0] : null;
    });
    const paidNudgeAfter = await nudgeState(paidNudge.id);
    paidRow && paidNudgeAfter?.status === "cancelled"
      ? pass("Paid order cancels pending nudges")
      : fail("Paid order cancels pending nudges", `order=${paidRow?.status} nudge=${paidNudgeAfter?.status}`);

    // C2: global opt-out → cron cancels the due nudge without sending.
    const optOrder = await insertOrder(OPTOUT_PHONE);
    orderIds.push(optOrder.id);
    const optNudge = await insertNudge(optOrder.id, OPTOUT_PHONE);
    nudgeIds.push(optNudge.id);
    await sb("/opt_out_list", {
      method: "POST",
      body: JSON.stringify({ phone_number: OPTOUT_PHONE, reason: "m6-test" }),
    });
    await runCron();
    const optNudgeAfter = await nudgeState(optNudge.id);
    optNudgeAfter?.status === "cancelled"
      ? pass("Opted-out number's nudge cancelled")
      : fail("Opted-out number's nudge cancelled", JSON.stringify(optNudgeAfter));

    // C3: declined lead (status=lost) → cron cancels the due nudge.
    const declinedLead = await sb("/leads", {
      method: "POST",
      body: JSON.stringify({
        phone_number: DECLINED_PHONE,
        full_name: `${TEST_TAG} Declined`,
        status: "lost",
      }),
    });
    if (!declinedLead.ok) throw new Error(`lead insert failed: ${JSON.stringify(declinedLead.body)}`);
    leadIds.push(declinedLead.body[0].id);
    const decOrder = await insertOrder(DECLINED_PHONE, { lead_id: declinedLead.body[0].id });
    orderIds.push(decOrder.id);
    const decNudge = await insertNudge(decOrder.id, DECLINED_PHONE, { lead_id: declinedLead.body[0].id });
    nudgeIds.push(decNudge.id);
    await runCron();
    const decNudgeAfter = await nudgeState(decNudge.id);
    decNudgeAfter?.status === "cancelled"
      ? pass("Declined lead's nudge cancelled")
      : fail("Declined lead's nudge cancelled", JSON.stringify(decNudgeAfter));

    // C4: order no longer pending_payment → cron cancels instead of sending.
    const expOrder = await insertOrder("27799610605", { status: "expired" });
    orderIds.push(expOrder.id);
    const expNudge = await insertNudge(expOrder.id, "27799610605");
    nudgeIds.push(expNudge.id);
    await runCron();
    const expNudgeAfter = await nudgeState(expNudge.id);
    expNudgeAfter?.status === "cancelled"
      ? pass("Expired order's nudge cancelled")
      : fail("Expired order's nudge cancelled", JSON.stringify(expNudgeAfter));
    ALL_PHONES.push("27799610605");

    // ==================== TRACK D: Broadcast readiness ====================
    currentTrack = "D-broadcast";
    console.log("\nD. Shopify → broadcast contacts sync");

    // Synthetic customers covering the consent matrix.
    const customerFixtures = [
      { shopify_customer_id: FAKE_CUSTOMER_IDS[0], phone: BC_YES, accepts_marketing: true },
      { shopify_customer_id: FAKE_CUSTOMER_IDS[1], phone: BC_NO, accepts_marketing: false },
      { shopify_customer_id: FAKE_CUSTOMER_IDS[2], phone: BC_OPTOUT, accepts_marketing: true },
      { shopify_customer_id: FAKE_CUSTOMER_IDS[3], phone: BC_MANUAL, accepts_marketing: true },
    ];
    for (const c of customerFixtures) {
      const res = await sb("/shopify_customers", {
        method: "POST",
        body: JSON.stringify({ ...c, full_name: `${TEST_TAG} ${c.phone}` }),
      });
      if (!res.ok) throw new Error(`customer fixture failed: ${JSON.stringify(res.body)}`);
    }
    await sb("/opt_out_list", {
      method: "POST",
      body: JSON.stringify({ phone_number: BC_OPTOUT, reason: "m6-test" }),
    });

    const syncRes = await api("/api/broadcasts/sync-shopify", { method: "POST", auth: true });
    syncRes.ok
      ? pass("Shopify broadcast sync accepted", JSON.stringify(syncRes.body).slice(0, 140))
      : fail("Shopify broadcast sync accepted", `HTTP ${syncRes.status}: ${JSON.stringify(syncRes.body)}`);

    const group = syncRes.body?.group_id;
    group ? pass("Eastern Wear Customers group resolved", `group_id=${group}`)
      : fail("Eastern Wear Customers group resolved", "no group_id returned");

    const syncCount = syncRes.body?.customers_synced ?? 0;
    syncCount >= 500
      ? pass("Real Shopify customers synced", `${syncCount} customers`)
      : warn("Real Shopify customers synced", `only ${syncCount} — verify customer sync ran`);

    const contactFor = async (phone) => {
      const res = await sb(`/broadcast_contacts?group_id=eq.${group}&phone_number=eq.${phone}&select=opt_in,source,contact_name&limit=1`);
      return res.body?.[0] ?? null;
    };

    const cYes = await contactFor(BC_YES);
    cYes?.opt_in === true && cYes?.source === "shopify"
      ? pass("Consenting customer imported opted-in")
      : fail("Consenting customer imported opted-in", JSON.stringify(cYes));

    const cNo = await contactFor(BC_NO);
    cNo?.opt_in === false
      ? pass("Non-consenting customer imported opted-out")
      : fail("Non-consenting customer imported opted-out", JSON.stringify(cNo));

    const cOut = await contactFor(BC_OPTOUT);
    cOut?.opt_in === false
      ? pass("Opt-out list overrides Shopify consent")
      : fail("Opt-out list overrides Shopify consent", JSON.stringify(cOut));

    // Manual opt-out must survive a resync (never re-enabled).
    const cManual = await contactFor(BC_MANUAL);
    if (cManual?.opt_in !== true) {
      fail("Manual-opt-out fixture seeded", JSON.stringify(cManual));
    } else {
      await sb(`/broadcast_contacts?group_id=eq.${group}&phone_number=eq.${BC_MANUAL}`, {
        method: "PATCH",
        body: JSON.stringify({ opt_in: false }),
      });
      const resync = await api("/api/broadcasts/sync-shopify", { method: "POST", auth: true });
      const cManualAfter = resync.ok ? await contactFor(BC_MANUAL) : null;
      cManualAfter?.opt_in === false
        ? pass("Manual opt-out preserved on resync")
        : fail("Manual opt-out preserved on resync", JSON.stringify(cManualAfter));
    }

    // ========================= TRACK E: UI ================================
    currentTrack = "E-ui";
    console.log("\nE. Dashboard UI");
    if (!SKIP_UI) {
      const browser = await chromium.launch({ headless: !HEADED });
      try {
        const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
        const page = await ctx.newPage();
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

        let loggedIn = false;
        for (let attempt = 0; attempt < 3 && !loggedIn; attempt++) {
          try {
            await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
            await page.waitForSelector("#email", { timeout: 15_000 });
            await page.waitForTimeout(1200);
            await page.fill("#email", TEST_EMAIL);
            await page.fill("#password", TEST_PASSWORD);
            await page.locator("form:has(#email) button[type='submit']").click();
            await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15_000 });
            loggedIn = true;
          } catch {
            if (attempt === 2) throw new Error("Login did not redirect after 3 attempts");
          }
        }
        pass("Dashboard login");

        await page.goto(`${BASE_URL}/follow-ups`, { waitUntil: "domcontentloaded" });
        await page.getByText("Order Payment Reminders").waitFor({ timeout: 20_000 });
        pass("Order Payment Reminders section renders");
        const phoneCell = page.getByText(LIVE ? ORDER_PHONE : OPTOUT_PHONE, { exact: false }).first();
        await phoneCell.waitFor({ timeout: 15_000 });
        pass("Order nudge row visible in follow-ups UI");
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, "follow-ups.png"), fullPage: true });

        await page.goto(`${BASE_URL}/broadcasts`, { waitUntil: "domcontentloaded" });
        await page.getByText("Sync Shopify").first().waitFor({ timeout: 20_000 });
        pass("Sync Shopify button visible on broadcasts page");
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, "broadcasts.png"), fullPage: true });

        await ctx.close();
      } catch (err) {
        fail("Dashboard UI checks", err.message);
      } finally {
        await browser.close();
      }
    } else {
      warn("Dashboard UI checks", "skipped by --skip-ui");
    }
  } catch (err) {
    fail("Suite aborted", err.message);
  } finally {
    // ============================ CLEANUP ================================
    currentTrack = "cleanup";
    console.log("\nCleanup");

    try {
      if (liveDraftOrderId) await deleteShopifyDraft(liveDraftOrderId);
      liveDraftOrderId ? pass("Shopify draft order deleted") : record("PASS", "Shopify draft order deleted", "none created");
    } catch (err) {
      fail("Shopify draft order deleted", err.message);
    }

    for (const id of orderIds) {
      await sb(`/orders?id=eq.${id}`, { method: "DELETE" }); // cascades follow_ups/events
    }
    for (const id of nudgeIds) {
      await sb(`/follow_ups?id=eq.${id}`, { method: "DELETE" });
    }
    const phoneList = ALL_PHONES.map((p) => `"${p}"`).join(",");
    await sb(`/opt_out_list?phone_number=in.(${phoneList})`, { method: "DELETE" });
    await sb(`/broadcast_contacts?phone_number=in.(${phoneList})`, { method: "DELETE" });
    await sb(`/shopify_customers?shopify_customer_id=in.(${FAKE_CUSTOMER_IDS.join(",")})`, { method: "DELETE" });
    for (const id of leadIds) {
      await sb(`/leads?id=eq.${id}`, { method: "DELETE" });
    }
    await sb(`/shopify_webhook_events?shopify_id=like.m6-*`, { method: "DELETE" });
    pass("Test data removed");

    if (pausedLeadFollowUps.length) {
      await sb(`/leads?id=in.(${pausedLeadFollowUps.join(",")})`, {
        method: "PATCH",
        body: JSON.stringify({ follow_up_requested: true }),
      });
      pass("Lead follow-ups restored", `${pausedLeadFollowUps.length} leads`);
    }
  }

  summarize();
}

function summarize() {
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const warned = results.filter((r) => r.status === "WARN").length;
  console.log(`\n=== M6 Results: ${passed} passed, ${failed} failed, ${warned} warnings ===\n`);
  fs.writeFileSync(
    RESULTS_FILE,
    JSON.stringify(
      {
        suite: "m6-followups-broadcast",
        live: LIVE,
        target: BASE_URL,
        ran_at: new Date().toISOString(),
        summary: { total: results.length, passed, failed, warned },
        results,
      },
      null,
      2
    )
  );
  console.log(`Results written to ${RESULTS_FILE}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  summarize();
});
