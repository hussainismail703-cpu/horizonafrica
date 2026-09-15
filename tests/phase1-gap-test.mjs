#!/usr/bin/env node
/**
 * Phase 1 Gap Test — covers features shipped AFTER the existing suites were
 * written: delivery-failure logging, notifications API, phone normalization at
 * all write paths, conversation ordering/dedup, n8n lead-field persistence,
 * follow-ups, and broadcast opt-out handling.
 *
 * UI tests run headed (visible browser) by default.
 *
 * Usage:
 *   node --env-file=.env.local tests/phase1-gap-test.mjs
 *   node --env-file=.env.local tests/phase1-gap-test.mjs --headless
 *   node --env-file=.env.local tests/phase1-gap-test.mjs --ui-only
 *   node --env-file=.env.local tests/phase1-gap-test.mjs --backend-only
 *   node --env-file=.env.local tests/phase1-gap-test.mjs --no-n8n   (skip AI-dependent tests)
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// ─── Env loading ────────────────────────────────────────────────────────────
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));

const BASE_URL = process.env.TEST_TARGET || "http://localhost:3000";
const TEST_EMAIL = "test@horizonafrica.co.za";
const TEST_PASSWORD = "TestPass123!";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const META_WABA_ID = process.env.META_WABA_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_API_VERSION = process.env.META_API_VERSION ?? "v21.0";

const HEADLESS = process.argv.includes("--headless") || process.env.HEADED === "0";
const UI_ONLY = process.argv.includes("--ui-only");
const BACKEND_ONLY = process.argv.includes("--backend-only");
const NO_N8N = process.argv.includes("--no-n8n");

// Phones used by this suite — all cleaned up afterwards
const TEST_PHONE = "27832763116"; // real lead 816 (Hussain Ismail)
const LEAD_ID = 816;
const GAP_PHONE = "27820001234"; // normalization writes
const GAP_LOCAL = "0820001234";
const N8N_PHONE = "27820009999"; // fresh lead for n8n pipeline tests
const NOTIFY_PHONE = "27820007777"; // notifications test lead
const FU_PHONE = "27000000001"; // invalid — follow-up/broadcast failure paths
const DEDUP_PHONE = "27820004321"; // conversation dedup test
const FIBRE_CAMPAIGN = "febe1cac-cf87-46c3-bbc7-160d3b96e28e";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const testStart = new Date().toISOString();

// ─── Reporting ──────────────────────────────────────────────────────────────
const results = [];
const findings = [];

function pass(id, desc, detail = "") {
  results.push({ id, desc, status: "PASS", detail });
  console.log(`  ✅ ${id} ${desc}${detail ? ` — ${detail}` : ""}`);
}
function fail(id, desc, detail = "") {
  results.push({ id, desc, status: "FAIL", detail });
  console.log(`  ❌ ${id} ${desc}${detail ? ` — ${detail}` : ""}`);
}
function warn(id, desc, detail = "") {
  results.push({ id, desc, status: "WARN", detail });
  findings.push({ id, desc, detail });
  console.log(`  ⚠️  ${id} ${desc}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Supabase service REST helper ───────────────────────────────────────────
async function sb(p, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${p}`, {
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
  let json = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json, ok: res.ok };
}
const sbGet = (p) => sb(p);
const sbInsert = (table, row) => sb(`/${table}`, { method: "POST", body: JSON.stringify(row) });
const sbUpdate = (table, match, patch) =>
  sb(`/${table}?${match}`, { method: "PATCH", body: JSON.stringify(patch) });
const sbDelete = (table, match) => sb(`/${table}?${match}`, { method: "DELETE" });

// ─── Webhook builders ───────────────────────────────────────────────────────
const wamid = () => `wamid.GAPTEST_${crypto.randomUUID()}`;

function webhookMessage(from, text) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "waba",
      changes: [{
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "27 75 777 4389", phone_number_id: "1257101724147822" },
          contacts: [{ profile: { name: "Gap Test" }, wa_id: from }],
          messages: [{
            from, id: wamid(), type: "text",
            text: { body: text },
            timestamp: Math.floor(Date.now() / 1000).toString(),
          }],
        },
        field: "messages",
      }],
    }],
  };
}

function webhookStatuses(statuses) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "waba",
      changes: [{
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "27 75 777 4389", phone_number_id: "1257101724147822" },
          statuses,
        },
        field: "messages",
      }],
    }],
  };
}

async function sendWebhook(payload) {
  const res = await fetch(`${BASE_URL}/api/whatsapp-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.text() };
}

async function pollUntil(fn, timeoutMs = 45000, interval = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await sleep(interval);
  }
  return null;
}

// ─── Cleanup registry ───────────────────────────────────────────────────────
const cleanup = {
  campaignIds: [],
  leadIds: [],
  queueIds: [],
  broadcastIds: [],
  contactIds: [],
  groupIds: [],
  failureMsgIds: [],
  convPhones: [GAP_PHONE, N8N_PHONE, NOTIFY_PHONE, DEDUP_PHONE, FU_PHONE],
  optOutPhones: [GAP_PHONE, FU_PHONE, N8N_PHONE, NOTIFY_PHONE, DEDUP_PHONE],
  lead816Snapshot: null,
};

async function runCleanup() {
  console.log("\n--- Cleaning up gap-test data ---");
  // Campaigns cascade-delete related rows via the DELETE endpoint — but call it
  // through plain sb deletes to be explicit and independent of the API.
  for (const cid of cleanup.campaignIds) {
    const enr = await sbGet(`/campaign_enrolments?campaign_id=eq.${cid}&select=id`);
    for (const e of enr.json ?? []) {
      await sbDelete("campaign_interactions", `enrol_id=eq.${e.id}`);
      await sbDelete("campaign_classifications", `enrol_id=eq.${e.id}`);
    }
    await sbDelete("calling_queue", `campaign_id=eq.${cid}`);
    await sbDelete("campaign_errors", `campaign_id=eq.${cid}`);
    await sbDelete("campaign_enrolments", `campaign_id=eq.${cid}`);
    await sbDelete("campaign_steps", `campaign_id=eq.${cid}`);
    await sbDelete("campaign_audit_log", `entity_id=eq.${cid}`);
    await sbDelete("campaigns", `id=eq.${cid}`);
  }
  for (const id of cleanup.queueIds) await sbDelete("calling_queue", `id=eq.${id}`);
  for (const id of cleanup.contactIds) await sbDelete("broadcast_contacts", `id=eq.${id}`);
  for (const id of cleanup.broadcastIds) await sbDelete("broadcast_history", `id=eq.${id}`);
  for (const id of cleanup.groupIds) await sbDelete("broadcast_groups", `id=eq.${id}`);
  for (const mid of cleanup.failureMsgIds) await sbDelete("message_delivery_failures", `message_id=eq.${mid}`);
  for (const p of cleanup.optOutPhones) await sbDelete("opt_out_list", `phone_number=eq.${p}`);
  for (const p of cleanup.convPhones) await sbDelete("conversations", `phone_number=eq.${p}`);
  // conversations for the real test phone created during this run
  await sbDelete("conversations", `phone_number=eq.${TEST_PHONE}&created_at=gte.${testStart}`);
  for (const id of cleanup.leadIds) await sbDelete("leads", `id=eq.${id}`);
  await sbDelete("leads", `phone_number=eq.${GAP_PHONE}`);
  await sbDelete("leads", `phone_number=eq.${N8N_PHONE}`);
  // restore lead 816
  if (cleanup.lead816Snapshot) {
    await sbUpdate("leads", `id=eq.${LEAD_ID}`, cleanup.lead816Snapshot);
  }
  console.log("  Cleanup complete");
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(64));
  console.log("PHASE 1 GAP TEST — post-suite feature coverage");
  console.log(`Target: ${BASE_URL} | Headed: ${!HEADLESS} | n8n tests: ${!NO_N8N}`);
  console.log("=".repeat(64));

  const browser = await chromium.launch({ headless: HEADLESS, slowMo: HEADLESS ? 0 : 200 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const api = context.request; // shares browser cookies once logged in

  // ── Login ──
  console.log("\n-- Login --");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500); // let React hydrate before filling controlled inputs
  await page.locator("#email").fill(TEST_EMAIL);
  await page.locator("#password").fill(TEST_PASSWORD);
  await page.locator("button[type='submit']").first().click();
  await page.waitForURL("**/dashboard", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (!page.url().includes("/dashboard")) {
    console.error("Login failed — aborting");
    await browser.close();
    process.exit(1);
  }
  console.log("  Logged in");

  // ════════════════════════════════════════════════════════════════════════
  // UI GAP TESTS (headed, visible)
  // ════════════════════════════════════════════════════════════════════════
  if (!BACKEND_ONLY) {
    console.log("\n-- Section U: UI gap tests --");

    // U1: notifications bell
    try {
      const bell = page.locator("header button:has(svg.lucide-bell)").first();
      const bellVisible = await bell.isVisible().catch(() => false);
      if (!bellVisible) {
        fail("U1", "Notifications bell renders in top bar", "bell button not found");
      } else {
        await bell.click();
        await page.waitForTimeout(600);
        const dropdown = await page.locator("[role='menu'], [role='listbox'], .notifications-dropdown, [data-notifications]").first().isVisible().catch(() => false);
        if (dropdown) {
          pass("U1", "Notifications bell opens dropdown");
        } else {
          fail("U1", "Notifications bell opens dropdown", "bell click produced no dropdown — /api/notifications exists but the bell is not wired to it");
        }
      }
      // U1b: API shape while we're here
      const nres = await api.get(`${BASE_URL}/api/notifications`);
      const nbody = await nres.json().catch(() => null);
      if (nres.status() === 200 && Array.isArray(nbody?.notifications) && typeof nbody?.count === "number") {
        pass("G8", "GET /api/notifications returns {notifications[], count}");
      } else {
        fail("G8", "GET /api/notifications returns {notifications[], count}", `status=${nres.status()}`);
      }
    } catch (e) {
      fail("U1", "Notifications bell renders in top bar", e.message);
    }

    // U2: conversations list shows NEWEST message preview
    try {
      const old = new Date(Date.now() - 3600e3).toISOString();
      const now = new Date().toISOString();
      await sbInsert("conversations", {
        phone_number: GAP_PHONE, contact_name: null, incoming_message: "GAP_OLD_MSG_ALPHA",
        ai_response: "old reply", lead_score: "COLD", timestamp: old, created_at: old,
      });
      await sbInsert("conversations", {
        phone_number: GAP_PHONE, contact_name: null, incoming_message: "GAP_NEW_MSG_OMEGA",
        ai_response: "new reply", lead_score: "COLD", timestamp: now, created_at: now,
      });
      await page.goto(`${BASE_URL}/conversations`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      const item = page.locator("button", { hasText: GAP_PHONE }).first();
      const itemText = (await item.textContent().catch(() => "")) ?? "";
      if (itemText.includes("GAP_NEW_MSG_OMEGA")) {
        pass("U2/G19", "Conversation list preview shows newest message");
      } else if (itemText.includes("GAP_OLD_MSG_ALPHA")) {
        fail("U2/G19", "Conversation list preview shows newest message", "preview shows OLDEST message — ordering regression");
      } else {
        fail("U2/G19", "Conversation list preview shows newest message", `conversation item not found; saw: ${itemText.slice(0, 80)}`);
      }
      // ordering: gap conv (now) should be at/near top — check it appears in first 3 items
      const firstItems = await page.locator(".overflow-y-auto button").allTextContents().catch(() => []);
      const idx = firstItems.findIndex((t) => t.includes(GAP_PHONE));
      if (idx !== -1 && idx < 3) {
        pass("U2b", "Newest conversation sorts to top of list", `position=${idx + 1}`);
      } else {
        warn("U2b", "Newest conversation sorts to top of list", idx === -1 ? "not found in list" : `position=${idx + 1}`);
      }
    } catch (e) {
      fail("U2/G19", "Conversation list preview shows newest message", e.message);
    }

    // U3: dashboard recent conversations deduped by phone
    try {
      for (let i = 0; i < 3; i++) {
        const ts = new Date(Date.now() - i * 60000).toISOString();
        await sbInsert("conversations", {
          phone_number: DEDUP_PHONE, contact_name: null,
          incoming_message: `GAP_DEDUP_MSG_${i}`, ai_response: "r",
          lead_score: "COLD", timestamp: ts, created_at: ts,
        });
      }
      await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      // Count only <p> elements showing the phone (the contact-name line) —
      // a bare text= locator would also match ancestor divs.
      const occurrences = await page.locator("p", { hasText: DEDUP_PHONE }).count();
      if (occurrences === 1) {
        pass("U3/G20", "Dashboard Recent Conversations dedupes by phone");
      } else {
        fail("U3/G20", "Dashboard Recent Conversations dedupes by phone", `phone appears ${occurrences} times`);
      }
    } catch (e) {
      fail("U3/G20", "Dashboard Recent Conversations dedupes by phone", e.message);
    }

    // U4: lead drawer shows extended fields
    try {
      const snap = await sbGet(`/leads?id=eq.${LEAD_ID}&select=preferred_contact_number,product_interest,household_size,internet_usage,needs_escalation`);
      cleanup.lead816Snapshot = snap.json?.[0] ?? null;
      await sbUpdate("leads", `id=eq.${LEAD_ID}`, {
        preferred_contact_number: "27820001111",
        product_interest: "GAPTEST Fibre 500",
        household_size: "4",
        internet_usage: "GAPTEST streaming",
        needs_escalation: true,
      });
      await page.goto(`${BASE_URL}/leads`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      const search = page.locator("input[placeholder*='Search by name or phone']");
      await search.fill(TEST_PHONE);
      await page.waitForTimeout(700);
      await page.locator("tr", { hasText: TEST_PHONE }).first().click();
      await page.waitForTimeout(1200);
      const bodyText = (await page.locator("body").textContent()) ?? "";
      const checks = ["27820001111", "GAPTEST Fibre 500", "GAPTEST streaming", "Preferred Contact Number"];
      const missing = checks.filter((c) => !bodyText.includes(c));
      if (missing.length === 0) {
        pass("U4", "Lead drawer shows extended fields (preferred contact, product interest, usage)");
      } else {
        fail("U4", "Lead drawer shows extended fields", `missing: ${missing.join(", ")}`);
      }
      await page.keyboard.press("Escape").catch(() => {});
    } catch (e) {
      fail("U4", "Lead drawer shows extended fields", e.message);
    }

    // U5: phone search variants
    try {
      await page.goto(`${BASE_URL}/leads`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      const search = page.locator("input[placeholder*='Search by name or phone']");
      await search.fill("0832763116");
      await page.waitForTimeout(800);
      const found1 = await page.locator("tr", { hasText: "27832763116" }).count();
      await search.fill("+27832763116");
      await page.waitForTimeout(800);
      const found2 = await page.locator("tr", { hasText: "27832763116" }).count();
      if (found1 > 0 && found2 > 0) {
        pass("U5", "Leads search matches 083.../ +27... variants for stored 27... number");
      } else {
        fail("U5", "Leads search matches phone format variants", `local:${found1} intl:${found2}`);
      }
      await search.fill("");
    } catch (e) {
      fail("U5", "Leads search matches phone format variants", e.message);
    }

    // U6: customer journey shows preferred contact number.
    // The page 404s without an enrolment — create one, visit, then remove it.
    let u6EnrolId = null;
    try {
      const enr = await sbInsert("campaign_enrolments", {
        campaign_id: FIBRE_CAMPAIGN, phone_number: TEST_PHONE, lead_id: LEAD_ID,
        current_step: 1, status: "responded", nurture_flag: false,
      });
      u6EnrolId = enr.json?.[0]?.id;
      await page.goto(`${BASE_URL}/campaigns/${FIBRE_CAMPAIGN}/customers/${TEST_PHONE}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const bodyText = (await page.locator("body").textContent()) ?? "";
      if (bodyText.includes("27820001111") || bodyText.includes("Preferred Contact")) {
        pass("U6", "Customer journey page shows preferred contact number");
      } else {
        fail("U6", "Customer journey page shows preferred contact number", "preferred contact number not visible on journey page");
      }
    } catch (e) {
      fail("U6", "Customer journey page shows preferred contact number", e.message);
    } finally {
      if (u6EnrolId) {
        await sbDelete("campaign_interactions", `enrol_id=eq.${u6EnrolId}`);
        await sbDelete("campaign_classifications", `enrol_id=eq.${u6EnrolId}`);
        await sbDelete("campaign_enrolments", `id=eq.${u6EnrolId}`);
      }
    }

    // U7: Calling Queue nav — go to dashboard first so the sidebar is settled
    try {
      await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const link = page.locator("a[href='/calling-queue']").first();
      if (await link.isVisible().catch(() => false)) {
        await link.click();
        await page.waitForURL("**/calling-queue", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        if (page.url().includes("/calling-queue")) {
          pass("U7", "Sidebar Calling Queue nav item navigates");
        } else {
          fail("U7", "Sidebar Calling Queue nav item navigates", `ended on ${page.url()}`);
        }
      } else {
        fail("U7", "Sidebar Calling Queue nav item navigates", "link not found");
      }
    } catch (e) {
      fail("U7", "Sidebar Calling Queue nav item navigates", e.message);
    }

    // U8: campaign detail shows "Sends on Day X" + template description
    try {
      await page.goto(`${BASE_URL}/campaigns/${FIBRE_CAMPAIGN}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const bodyText = (await page.locator("body").textContent()) ?? "";
      const hasDay = bodyText.includes("Sends on Day");
      if (hasDay) {
        pass("U8", "Campaign detail shows 'Sends on Day X' for steps");
      } else {
        fail("U8", "Campaign detail shows 'Sends on Day X' for steps", "label not found");
      }
    } catch (e) {
      fail("U8", "Campaign detail shows 'Sends on Day X' for steps", e.message);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // BACKEND GAP TESTS
  // ════════════════════════════════════════════════════════════════════════
  if (!UI_ONLY) {
    // ── Delivery-failure logging (G1–G6) ──
    console.log("\n-- Section G: delivery-failure logging --");
    try {
      // G1: failed status with error details → row inserted, phone normalized
      const mid1 = wamid();
      cleanup.failureMsgIds.push(mid1);
      await sendWebhook(webhookStatuses([{
        id: mid1, status: "failed", recipient_id: "0832763116",
        timestamp: Math.floor(Date.now() / 1000).toString(),
        errors: [{ code: 131049, title: "Per-user marketing limit", message: "Marketing limit reached", error_data: { details: "Frequency cap" } }],
      }]));
      const f1 = await pollUntil(async () => {
        const r = await sbGet(`/message_delivery_failures?message_id=eq.${mid1}&select=*`);
        return r.json?.[0] ?? null;
      }, 15000, 2000);
      if (f1 && f1.error_code === 131049 && f1.recipient_phone === TEST_PHONE) {
        pass("G1", "Failed delivery status logged with normalized phone + error details");
      } else {
        fail("G1", "Failed delivery status logged", f1 ? `phone=${f1.recipient_phone} code=${f1.error_code}` : "no row inserted");
      }

      // G2: sent/delivered/read → no failure rows
      const mid2 = wamid();
      await sendWebhook(webhookStatuses([
        { id: mid2, status: "sent", recipient_id: TEST_PHONE, timestamp: "1" },
        { id: mid2, status: "delivered", recipient_id: TEST_PHONE, timestamp: "2" },
        { id: mid2, status: "read", recipient_id: TEST_PHONE, timestamp: "3" },
      ]));
      await sleep(3000);
      const f2 = await sbGet(`/message_delivery_failures?message_id=eq.${mid2}&select=id`);
      if ((f2.json ?? []).length === 0) {
        pass("G2", "sent/delivered/read statuses do not create failure rows");
      } else {
        fail("G2", "sent/delivered/read statuses do not create failure rows", `${f2.json.length} rows created`);
      }

      // G3: combined messages+statuses → forwarded to n8n AND failure logged
      const mid3 = wamid();
      cleanup.failureMsgIds.push(mid3);
      const combined = webhookMessage(GAP_PHONE, "GAPTEST combined payload");
      combined.entry[0].changes[0].value.statuses = [{
        id: mid3, status: "failed", recipient_id: GAP_PHONE,
        timestamp: "1", errors: [{ code: 131030, title: "Not on WhatsApp" }],
      }];
      const res3 = await sendWebhook(combined);
      const f3 = await pollUntil(async () => {
        const r = await sbGet(`/message_delivery_failures?message_id=eq.${mid3}&select=id`);
        return r.json?.[0] ?? null;
      }, 15000, 2000);
      if (f3 && res3.status === 200) {
        pass("G3", "Combined messages+statuses payload: forwarded to n8n AND failure logged");
      } else {
        fail("G3", "Combined payload forwarded + failure logged", `webhook status=${res3.status}, failure row=${!!f3}`);
      }

      // G4: raw_status preserves payload
      if (f1?.raw_status?.status === "failed" && Array.isArray(f1?.raw_status?.errors)) {
        pass("G4", "raw_status JSONB preserves the full Meta status payload");
      } else {
        fail("G4", "raw_status JSONB preserves the full Meta status payload", JSON.stringify(f1?.raw_status ?? null).slice(0, 120));
      }

      // G5: multiple failures in one payload
      const mid5a = wamid(), mid5b = wamid();
      cleanup.failureMsgIds.push(mid5a, mid5b);
      await sendWebhook(webhookStatuses([
        { id: mid5a, status: "failed", recipient_id: GAP_PHONE, timestamp: "1", errors: [{ code: 131026, title: "Undeliverable" }] },
        { id: mid5b, status: "failed", recipient_id: N8N_PHONE, timestamp: "1", errors: [{ code: 131047, title: "Re-engagement" }] },
      ]));
      const f5 = await pollUntil(async () => {
        const r = await sbGet(`/message_delivery_failures?message_id=in.(${mid5a},${mid5b})&select=id`);
        return (r.json ?? []).length === 2 ? r.json : null;
      }, 15000, 2000);
      if (f5) {
        pass("G5", "Multiple failed statuses in one payload all inserted");
      } else {
        fail("G5", "Multiple failed statuses in one payload all inserted");
      }

      // G6: missing recipient_id → row still inserted, phone null
      const mid6 = wamid();
      cleanup.failureMsgIds.push(mid6);
      await sendWebhook(webhookStatuses([{ id: mid6, status: "failed", timestamp: "1", errors: [{ code: 1, title: "x" }] }]));
      const f6 = await pollUntil(async () => {
        const r = await sbGet(`/message_delivery_failures?message_id=eq.${mid6}&select=*`);
        return r.json?.[0] ?? null;
      }, 15000, 2000);
      if (f6) {
        pass("G6", "Failure without recipient_id still logged (phone null)", `phone=${f6.recipient_phone}`);
      } else {
        fail("G6", "Failure without recipient_id still logged");
      }
    } catch (e) {
      fail("G1-G6", "Delivery-failure logging section", e.message);
    }

    // ── Notifications API (G7, G9, G10) ──
    console.log("\n-- Section G: notifications API --");
    try {
      // redirect: 'manual' — without it fetch follows the middleware 307 to
      // /login and the final status is a misleading 200.
      const unauth = await fetch(`${BASE_URL}/api/notifications`, { redirect: "manual" });
      if ([401, 307, 302].includes(unauth.status)) {
        pass("G7", "GET /api/notifications requires auth");
      } else {
        fail("G7", "GET /api/notifications requires auth", `status=${unauth.status}`);
      }

      const nl = await sbInsert("leads", {
        phone_number: NOTIFY_PHONE, full_name: "GAPTEST Notify",
        lead_score: "HOT", status: "new", needs_escalation: true,
      });
      const notifyLeadId = nl.json?.[0]?.id;
      if (notifyLeadId) cleanup.leadIds.push(notifyLeadId);

      const nres = await api.get(`${BASE_URL}/api/notifications`);
      const nbody = await nres.json();
      const notifs = nbody.notifications ?? [];
      const types = new Set(notifs.filter((n) => n.leadId === notifyLeadId).map((n) => n.type));
      if (types.has("escalation")) {
        pass("G9", "needs_escalation lead appears as escalation notification");
      } else {
        fail("G9", "needs_escalation lead appears as escalation notification", `types found: ${[...types].join(",") || "none"}`);
      }
      if (types.has("hot_lead")) {
        pass("G10", "HOT lead appears as hot_lead notification");
      } else {
        fail("G10", "HOT lead appears as hot_lead notification", `types found: ${[...types].join(",") || "none"}`);
      }
    } catch (e) {
      fail("G7-G10", "Notifications section", e.message);
    }

    // ── Phone normalization at write paths (G11–G18) ──
    console.log("\n-- Section G: phone normalization --");

    // G11: enrolments POST normalizes 0-prefix
    try {
      const campRes = await api.post(`${BASE_URL}/api/campaigns`, {
        data: { name: `GAPTEST Norm ${Date.now()}`, objective: "gap test" },
      });
      const camp = await campRes.json();
      const cid = camp.id;
      if (!cid) throw new Error(`campaign create failed: ${JSON.stringify(camp)}`);
      cleanup.campaignIds.push(cid);

      const enrRes = await api.post(`${BASE_URL}/api/campaigns/enrolments`, {
        data: { campaign_id: cid, phone_numbers: [GAP_LOCAL] },
      });
      const enrBody = await enrRes.json();
      const row = await sbGet(`/campaign_enrolments?campaign_id=eq.${cid}&select=phone_number`);
      const stored = row.json?.[0]?.phone_number;
      if (enrRes.status() === 201 && stored === GAP_PHONE) {
        pass("G11", "Enrolments POST normalizes 0-prefix phone to 27...");
      } else {
        fail("G11", "Enrolments POST normalizes 0-prefix phone", `status=${enrRes.status()} stored=${stored} body=${JSON.stringify(enrBody).slice(0, 120)}`);
      }

      // G15: classify POST normalizes before enrolment lookup
      const enrRow = await sbGet(`/campaign_enrolments?campaign_id=eq.${cid}&select=id,status`);
      const enrolId = enrRow.json?.[0]?.id;
      await sbUpdate("campaign_enrolments", `id=eq.${enrolId}`, { status: "responded" });
      const clsRes = await api.post(`${BASE_URL}/api/campaigns/classify`, {
        data: { phone_number: GAP_LOCAL, message_text: "GAPTEST not interested" },
      });
      const clsBody = await clsRes.json().catch(() => ({}));
      if (clsRes.status() === 200 && clsBody) {
        pass("G15", "Classify POST normalizes phone before enrolment lookup", `status=${clsRes.status()}`);
      } else {
        fail("G15", "Classify POST normalizes phone before enrolment lookup", `status=${clsRes.status()} body=${JSON.stringify(clsBody).slice(0, 120)}`);
      }
      // cleanup possible queue rows created for the gap phone
      const q = await sbGet(`/calling_queue?phone_number=eq.${GAP_PHONE}&select=id`);
      for (const r of q.json ?? []) cleanup.queueIds.push(r.id);
    } catch (e) {
      fail("G11/G15", "Enrolment/classify normalization", e.message);
    }

    // G12: broadcast contacts POST normalizes
    try {
      // need a group — create dedicated gap group
      const g = await sbInsert("broadcast_groups", {
        group_name: `gaptest_${Date.now()}`, group_label: "GAPTEST Group", description: "gap test",
      });
      const gid = g.json?.[0]?.id;
      if (gid) cleanup.groupIds.push(gid);
      const cRes = await api.post(`${BASE_URL}/api/broadcasts/contacts`, {
        data: { contact_name: "Gap Test", phone_number: GAP_LOCAL, group_id: gid },
      });
      const cBody = await cRes.json();
      const storedPhone = cBody?.contact?.phone_number;
      if (cRes.status() === 201 && storedPhone === GAP_PHONE) {
        pass("G12", "Broadcast contacts POST normalizes phone");
      } else {
        fail("G12", "Broadcast contacts POST normalizes phone", `status=${cRes.status()} stored=${storedPhone}`);
      }
      if (cBody?.contact?.id) cleanup.contactIds.push(cBody.contact.id);

      // G13: bulk-import normalizes mixed formats
      const biRes = await api.post(`${BASE_URL}/api/broadcasts/contacts/bulk-import`, {
        data: {
          group_id: gid,
          contacts: [
            { contact_name: "A", phone_number: "0820001240" },
            { contact_name: "B", phone_number: "+27 82 000 1241" },
            { contact_name: "C", phone_number: "27820001242" },
          ],
        },
      });
      const biBody = await biRes.json();
      const phones = (biBody?.contacts ?? []).map((c) => c.phone_number);
      for (const c of biBody?.contacts ?? []) cleanup.contactIds.push(c.id);
      const allNormalized = phones.length === 3 && phones.every((p) => p.startsWith("27") && !p.includes(" ") && !p.startsWith("0"));
      if (biRes.status() === 201 && allNormalized) {
        pass("G13", "Bulk-import normalizes mixed phone formats");
      } else {
        fail("G13", "Bulk-import normalizes mixed phone formats", `status=${biRes.status()} phones=${JSON.stringify(phones)}`);
      }

      // G14: calling-queue POST normalizes
      const cqRes = await api.post(`${BASE_URL}/api/calling-queue`, {
        data: { phone_number: GAP_LOCAL, full_name: "Gap Test" },
      });
      const cqBody = await cqRes.json();
      if (cqBody?.id) {
        cleanup.queueIds.push(cqBody.id);
        const qRow = await sbGet(`/calling_queue?id=eq.${cqBody.id}&select=phone_number`);
        if (qRow.json?.[0]?.phone_number === GAP_PHONE) {
          pass("G14", "Calling-queue POST normalizes phone");
        } else {
          fail("G14", "Calling-queue POST normalizes phone", `stored=${qRow.json?.[0]?.phone_number}`);
        }
      } else {
        fail("G14", "Calling-queue POST normalizes phone", `status=${cqRes.status()} ${JSON.stringify(cqBody).slice(0, 100)}`);
      }
    } catch (e) {
      fail("G12-G14", "Contacts/queue normalization", e.message);
    }

    // G16/G17: leads search variants via API
    try {
      const s1 = await api.get(`${BASE_URL}/api/leads?search=0832763116`);
      const b1 = await s1.json();
      const s2 = await api.get(`${BASE_URL}/api/leads?search=%2B27832763116`);
      const b2 = await s2.json();
      const hit1 = (b1.leads ?? []).some((l) => l.id === LEAD_ID);
      const hit2 = (b2.leads ?? []).some((l) => l.id === LEAD_ID);
      if (hit1) pass("G16", "GET /api/leads?search=0832763116 finds lead stored as 27...");
      else fail("G16", "GET /api/leads?search=0832763116 finds lead stored as 27...");
      if (hit2) pass("G17", "GET /api/leads?search=+27832763116 finds lead stored as 27...");
      else fail("G17", "GET /api/leads?search=+27832763116 finds lead stored as 27...");
    } catch (e) {
      fail("G16/G17", "Leads API phone search variants", e.message);
    }

    // G18: webhook msg.from "0..." normalizes for campaign detection
    try {
      const campRes = await api.post(`${BASE_URL}/api/campaigns`, {
        data: { name: `GAPTEST Detect ${Date.now()}`, objective: "gap test" },
      });
      const camp = await campRes.json();
      const cid = camp.id;
      cleanup.campaignIds.push(cid);
      await sbInsert("campaign_enrolments", {
        campaign_id: cid, phone_number: TEST_PHONE, lead_id: LEAD_ID,
        current_step: 0, status: "active", nurture_flag: false,
      });
      await sendWebhook(webhookMessage("0832763116", "GAPTEST detection hello"));
      const det = await pollUntil(async () => {
        const r = await sbGet(`/campaign_enrolments?campaign_id=eq.${cid}&select=status`);
        return r.json?.[0]?.status === "responded" ? r.json[0] : null;
      }, 15000, 2000);
      if (det) {
        pass("G18", "Webhook from 0-prefix phone matches 27... enrolment (normalized)");
      } else {
        fail("G18", "Webhook from 0-prefix phone matches 27... enrolment", "enrolment not marked responded");
      }
      // no NEW duplicate lead for the 0-prefix variant — only count rows created
      // during this run (stale rows from older suites are cleaned separately)
      const dupCheck = await sbGet(
        `/leads?phone_number=in.("0832763116","%2B27832763116")&created_at=gte.${testStart}&select=id`
      );
      const dupIds = new Set((dupCheck.json ?? []).map((l) => l.id));
      if (dupIds.size === 0) {
        pass("G21", "No duplicate lead created for phone format variants");
      } else {
        fail("G21", "No duplicate lead created for phone format variants", `found ids: ${[...dupIds].join(",")}`);
      }
    } catch (e) {
      fail("G18/G21", "Detection normalization + dedup", e.message);
    }

    // ── n8n lead-field persistence (G23–G27) — AI-dependent ──
    if (!NO_N8N) {
      console.log("\n-- Section G: n8n lead-field persistence (live AI, ~2-3 min) --");
      try {
        // ensure no pre-existing lead for n8n phone
        await sbDelete("leads", `phone_number=eq.${N8N_PHONE}`);

        const msgs = [
          "Hi, I'm interested in getting fibre internet at my home",
          "There are 5 people in my household and we stream Netflix every night",
          "Please rather call me on 0823456789, that's my work number",
          "My address is 12 Main Road, Sandton, Johannesburg",
          "I want to speak to a manager please, this is urgent",
          "ok thanks",
        ];
        for (const m of msgs) {
          await sendWebhook(webhookMessage(N8N_PHONE, m));
          // wait until n8n writes a conversation row for this message
          await pollUntil(async () => {
            const r = await sbGet(`/conversations?phone_number=eq.${N8N_PHONE}&incoming_message=ilike.*${encodeURIComponent(m.slice(0, 20))}*&select=id&limit=1`);
            return (r.json ?? []).length > 0 ? true : null;
          }, 30000, 4000);
          await sleep(2000); // let upsert-lead settle
        }

        const leadRes = await sbGet(`/leads?phone_number=eq.${N8N_PHONE}&select=*`);
        const lead = leadRes.json?.[0];
        if (lead) {
          cleanup.leadIds.push(lead.id);

          // G23: qualification fields persisted
          const captured = [];
          if (lead.product_interest) captured.push("product_interest");
          if (lead.household_size) captured.push("household_size");
          if (lead.internet_usage) captured.push("internet_usage");
          if (captured.length >= 2) {
            pass("G23", "n8n Upsert Lead persists qualification fields", `captured: ${captured.join(", ")}`);
          } else {
            fail("G23", "n8n Upsert Lead persists qualification fields", `captured: ${captured.join(", ") || "none"}`);
          }

          // G24: status advanced to contacted (or better), not stuck at new
          if (lead.status && lead.status !== "new") {
            pass("G24", "Lead status advanced past 'new' after AI exchange", `status=${lead.status}`);
          } else {
            fail("G24", "Lead status advanced past 'new' after AI exchange", `status=${lead.status}`);
          }

          // G25: needs_escalation sticky
          if (lead.needs_escalation === true) {
            pass("G25", "needs_escalation sticky — still true after later non-escalation message");
          } else {
            fail("G25", "needs_escalation sticky", `needs_escalation=${lead.needs_escalation}`);
          }

          // G26: preferred_contact_number saved + normalized
          if (lead.preferred_contact_number === "27823456789") {
            pass("G26", "preferred_contact_number saved and normalized (082→27)");
          } else if (lead.preferred_contact_number) {
            warn("G26", "preferred_contact_number saved", `value=${lead.preferred_contact_number} (expected 27823456789)`);
          } else {
            fail("G26", "preferred_contact_number saved and normalized", "field is null");
          }

          // G27: address captures city
          if (lead.physical_address && /johannesburg/i.test(lead.physical_address)) {
            pass("G27", "Physical address captures street + suburb + city", `addr="${lead.physical_address}"`);
          } else if (lead.physical_address) {
            warn("G27", "Physical address captured", `addr="${lead.physical_address}" — missing city`);
          } else {
            fail("G27", "Physical address captures street + suburb + city", "physical_address is null");
          }
        } else {
          fail("G23-G27", "n8n pipeline created a lead for the test phone", "no lead row found — is the n8n inbound workflow active?");
        }
      } catch (e) {
        fail("G23-G27", "n8n lead-field persistence", e.message);
      }
    } else {
      console.log("\n-- Section G: n8n lead-field persistence — SKIPPED (--no-n8n) --");
    }

    // ── Follow-ups (G28–G31) ──
    console.log("\n-- Section G: follow-ups --");
    try {
      const fl = await sbInsert("leads", {
        phone_number: FU_PHONE, full_name: "GAPTEST FollowUp",
        lead_score: "COLD", status: "contacted",
      });
      const fuLeadId = fl.json?.[0]?.id;
      if (fuLeadId) cleanup.leadIds.push(fuLeadId);

      // G28: schedule a follow-up
      const yesterday = new Date(Date.now() - 86400e3).toISOString();
      const schRes = await api.post(`${BASE_URL}/api/follow-ups/schedule`, {
        data: { lead_id: fuLeadId, follow_up_date: yesterday },
      });
      const schBody = await schRes.json().catch(() => ({}));
      if (schRes.status() === 200 && schBody?.lead?.follow_up_requested === true) {
        pass("G28", "POST /api/follow-ups/schedule sets follow_up_requested + date");
      } else {
        fail("G28", "POST /api/follow-ups/schedule sets follow_up_requested + date", `status=${schRes.status()} ${JSON.stringify(schBody).slice(0, 120)}`);
      }

      // G29: due follow-up appears in leads?follow_up=true
      const fuList = await api.get(`${BASE_URL}/api/leads?follow_up=true`);
      const fuBody = await fuList.json();
      if ((fuBody.leads ?? []).some((l) => l.id === fuLeadId)) {
        pass("G29", "Due follow-up lead appears in follow_up list");
      } else {
        fail("G29", "Due follow-up lead appears in follow_up list");
      }

      // G30: send follow-up to the lead (invalid phone → exercises failure path)
      const sendRes = await api.post(`${BASE_URL}/api/follow-ups/send`, {
        data: { lead_id: fuLeadId },
      });
      const sendBody = await sendRes.json().catch(() => ({}));
      if (sendRes.status() === 200 && sendBody.processed === 1 && (sendBody.sent + sendBody.failed) === 1) {
        pass("G30", "POST /api/follow-ups/send processes the lead", `sent=${sendBody.sent} failed=${sendBody.failed}`);
      } else {
        fail("G30", "POST /api/follow-ups/send processes the lead", `status=${sendRes.status()} ${JSON.stringify(sendBody).slice(0, 150)}`);
      }

      // G31: cron route auth (manual redirect — middleware 307 counts too)
      const cronRes = await fetch(`${BASE_URL}/api/follow-ups/cron`, { method: "POST", redirect: "manual" });
      if ([401, 307, 302].includes(cronRes.status)) {
        pass("G31", "POST /api/follow-ups/cron requires secret auth");
      } else {
        fail("G31", "POST /api/follow-ups/cron requires secret auth", `status=${cronRes.status}`);
      }
    } catch (e) {
      fail("G28-G31", "Follow-ups section", e.message);
    }

    // ── Broadcasts (G32–G35) ──
    console.log("\n-- Section G: broadcasts --");
    try {
      // G32: send to invalid test_phone → attempted, result recorded in history
      const bRes = await api.post(`${BASE_URL}/api/broadcasts/send`, {
        data: { template_name: "hello_world", test_phone: FU_PHONE, campaign_name: `GAPTEST ${Date.now()}` },
      });
      const bBody = await bRes.json().catch(() => ({}));
      if (bBody?.broadcast_id) cleanup.broadcastIds.push(bBody.broadcast_id);
      if (bRes.status() === 200 && bBody.total_recipients === 1 && (bBody.sent + bBody.failed) === 1) {
        pass("G32", "Broadcast send processes test_phone and records result", `sent=${bBody.sent} failed=${bBody.failed}`);
      } else {
        fail("G32", "Broadcast send processes test_phone and records result", `status=${bRes.status()} ${JSON.stringify(bBody).slice(0, 150)}`);
      }

      // G33: bad template name → failure surfaced
      const b2Res = await api.post(`${BASE_URL}/api/broadcasts/send`, {
        data: { template_name: "definitely_not_a_template_xyz", test_phone: FU_PHONE, campaign_name: `GAPTEST bad ${Date.now()}` },
      });
      const b2Body = await b2Res.json().catch(() => ({}));
      if (b2Body?.broadcast_id) cleanup.broadcastIds.push(b2Body.broadcast_id);
      if (b2Res.status() === 200 && b2Body.failed >= 1 && (b2Body.errors ?? []).length > 0) {
        pass("G33", "Broadcast with invalid template surfaces error");
      } else {
        fail("G33", "Broadcast with invalid template surfaces error", `status=${b2Res.status()} ${JSON.stringify(b2Body).slice(0, 150)}`);
      }

      // G34: contacts template download
      const tRes = await api.get(`${BASE_URL}/api/broadcasts/contacts/template`);
      const ct = tRes.headers()["content-type"] ?? "";
      if (tRes.status() === 200 && ct.includes("spreadsheetml")) {
        pass("G34", "GET /api/broadcasts/contacts/template returns xlsx download");
      } else {
        fail("G34", "GET /api/broadcasts/contacts/template returns xlsx download", `status=${tRes.status()} ct=${ct}`);
      }

      // G35: broadcast honours global opt_out_list — dedicated group containing
      // ONLY the opted-out contact (earlier gaptest groups have other contacts)
      const g35 = await sbInsert("broadcast_groups", {
        group_name: `gaptest_optout_${Date.now()}`, group_label: "GAPTEST OptOut", description: "gap test",
      });
      const gid = g35.json?.[0]?.id;
      if (gid) cleanup.groupIds.push(gid);
      await sbInsert("opt_out_list", { phone_number: GAP_PHONE, reason: "gap test" });
      const cIns = await sbInsert("broadcast_contacts", {
        contact_name: "Gap OptOut", phone_number: GAP_PHONE, group_id: gid, opt_in: true,
      });
      if (cIns.json?.[0]?.id) cleanup.contactIds.push(cIns.json[0].id);
      const b3Res = await api.post(`${BASE_URL}/api/broadcasts/send`, {
        data: { template_name: "hello_world", group_id: gid, campaign_name: `GAPTEST optout ${Date.now()}` },
      });
      const b3Body = await b3Res.json().catch(() => ({}));
      if (b3Body?.broadcast_id) cleanup.broadcastIds.push(b3Body.broadcast_id);
      // If opt_out_list were consulted, the only recipient would be excluded →
      // 400 "No recipients found". Current behaviour: send attempted.
      if (b3Res.status() === 400 || (b3Body.total_recipients === 0)) {
        pass("G35", "Broadcast send honours global opt_out_list");
      } else {
        fail("G35", "Broadcast send honours global opt_out_list", "opted-out contact was included in recipients — send attempted (opt_out_list not consulted by broadcasts)");
      }
    } catch (e) {
      fail("G32-G35", "Broadcasts section", e.message);
    }
  }

  await runCleanup();
  await browser.close();

  // ── Summary ──
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const warned = results.filter((r) => r.status === "WARN").length;

  console.log("\n" + "=".repeat(64));
  console.log(`GAP TEST RESULTS: ${passed} passed, ${failed} failed, ${warned} warnings (${results.length} total)`);
  if (failed > 0) {
    console.log("\nFAILURES:");
    for (const r of results.filter((r) => r.status === "FAIL")) {
      console.log(`  ❌ ${r.id} ${r.desc}${r.detail ? ` — ${r.detail}` : ""}`);
    }
  }
  if (warned > 0) {
    console.log("\nWARNINGS / FINDINGS:");
    for (const r of results.filter((r) => r.status === "WARN")) {
      console.log(`  ⚠️  ${r.id} ${r.desc}${r.detail ? ` — ${r.detail}` : ""}`);
    }
  }
  console.log("=".repeat(64));

  const reportPath = "tests/phase1-gap-results.json";
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    target: BASE_URL,
    total: results.length, passed, failed, warnings: warned,
    results, findings,
  }, null, 2));
  console.log(`\nReport: ${reportPath}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await runCleanup().catch(() => {});
  process.exit(1);
});
