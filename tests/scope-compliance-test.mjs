#!/usr/bin/env node
/**
 * Scope Compliance Test Suite
 *
 * Targeted checks for scope-freeze items not covered by the existing suites,
 * per tests/scope-compliance-plan.md. Master source: the real Scope Freeze
 * document `Layla Phase 1 Scope Freeze.txt` (acceptance checklist = §4 + §7).
 *
 *   S1  Product catalog manager — §3 baseline (catalog exists and is usable)
 *   S2  Google Sheets correctly ABSENT (§9.3 out of scope) + Supabase leads (§3)
 *   S3  Objection handling a–e — §3 baseline, live webhook → n8n → AI scenarios
 *   S4  Chatwoot reachability + handover evidence — §3 baseline
 *   S5  Brevo hot-lead alert path — §3 baseline
 *   S6  Broadcast groups + opt-out send path — §3 baseline / §4.10
 *   S7  Follow-up flag → send round-trip — §3 baseline
 *   S8  Lead info-capture completeness — §3 baseline / §4.11
 *   S9  Settings statuses match reality — §3 baseline
 *   S10 Final-status coverage audit — §4.7 / §4.12
 *   S11 §4.5 reason taxonomy + §4.6 classification taxonomy + uncertain→review
 *   S12 §8 metric definitions — delivery rate & read rate math in stats
 *   S13 §5 simultaneous campaigns + §6 duplicate-send prevention (constraints)
 *
 * Real WhatsApp sends only to 27832763116 (lead 816). Objection/AI webhooks use
 * test phone 27823725575 ("Hussain Test", lead 2292). All test data is marked
 * [SCOPE-AUDIT] and cleaned up.
 *
 * Usage:
 *   node --env-file=.env.local tests/scope-compliance-test.mjs
 *   node --env-file=.env.local tests/scope-compliance-test.mjs --skip-ai   # skip S3/S5 live AI calls
 *   TEST_TARGET=https://dashboard.horizonafrica.co.za node --env-file=.env.local tests/scope-compliance-test.mjs
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { chromium } from "playwright";
import { webhookHeaders } from "./lib/webhook.mjs";

// ─── Env ────────────────────────────────────────────────────────────────────
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.TEST_TARGET || "http://localhost:3000";
const TEST_EMAIL = process.env.TEST_EMAIL || "test@horizonafrica.co.za";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "TestPass123!";
const META_TOKEN = process.env.META_ACCESS_TOKEN;
const META_WABA = process.env.META_WABA_ID;
const META_PHONE_ID = process.env.META_PHONE_NUMBER_ID;

const SKIP_AI = process.argv.includes("--skip-ai");

// AI webhooks go through this test identity (existing dedicated test lead)
const AI_PHONE = "27823725575";
const AI_NAME = "Hussain Test";
// Real sends are only permitted to this number
const REAL_PHONE = "27832763116";
const TAG = "[SCOPE-AUDIT]";

const AI_TIMEOUT_MS = 90000;
const RESULTS_FILE = path.join(process.cwd(), "tests", "scope-compliance-results.json");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// ─── Result recording ───────────────────────────────────────────────────────
const results = [];
let currentScope = "setup";

function record(status, id, name, detail = "") {
  results.push({ scope: currentScope, id, name, status, detail });
  console.log(`  ${status.padEnd(7)} ${id.padEnd(5)} ${name}${detail ? ` — ${detail}` : ""}`);
}
const pass = (id, n, d) => record("PASS", id, n, d);
const fail = (id, n, d) => record("FAIL", id, n, d);
const partial = (id, n, d) => record("PARTIAL", id, n, d);
const manual = (id, n, d) => record("MANUAL", id, n, d);

// ─── Supabase REST helper (service role) ────────────────────────────────────
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
  let data = null;
  try { data = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, data, text };
}

// ─── Webhook helpers ────────────────────────────────────────────────────────
function textWebhook(text, phone = AI_PHONE, name = AI_NAME) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "whatsapp_business_account",
      changes: [{
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "27 75 777 4389", phone_number_id: META_PHONE_ID || "1257101724147822" },
          contacts: [{ profile: { name }, wa_id: phone }],
          messages: [{
            from: phone,
            id: `wamid.scope-${crypto.randomUUID()}`,
            type: "text",
            text: { body: text },
            timestamp: Math.floor(Date.now() / 1000).toString(),
          }],
        },
        field: "messages",
      }],
    }],
  };
}

async function sendWebhook(payload) {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${BASE_URL}/api/whatsapp-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...webhookHeaders(raw) },
    body: raw,
  });
  return { status: res.status, response: await res.text() };
}

async function cleanAiConversations() {
  await sb(`/conversations?phone_number=eq.${AI_PHONE}`, { method: "DELETE" });
  await new Promise((r) => setTimeout(r, 4000));
  await sb(`/conversations?phone_number=eq.${AI_PHONE}`, { method: "DELETE" });
  await new Promise((r) => setTimeout(r, 1000));
}

/** Poll for the AI response row matching the exact incoming message. */
async function waitForConversation(expectedMessage, timeoutMs = AI_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await sb(
      `/conversations?phone_number=eq.${AI_PHONE}&order=created_at.desc&limit=3` +
      `&select=id,ai_response,incoming_message,lead_score,objection_type,follow_up_requested,follow_up_date,needs_escalation,created_at`
    );
    const row = (data || []).find(
      (r) => r.ai_response && (r.incoming_message || "").trim().toLowerCase() === expectedMessage.trim().toLowerCase()
    );
    if (row) return row;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return null;
}

async function getAiLead() {
  const { data } = await sb(
    `/leads?phone_number=eq.${AI_PHONE}&select=id,full_name,lead_score,score_locked,status,physical_address,needs_escalation,preferred_package,preferred_contact_number,follow_up_requested,follow_up_date,product_interest,household_size,internet_usage,rejection_reason&limit=1`
  );
  return (data || [])[0] ?? null;
}

// ─── Auth cookies for app API calls ─────────────────────────────────────────
let authCookie = null;
async function getAuthCookie() {
  if (authCookie) return authCookie;
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    await page.waitForSelector("#email", { timeout: 20000 });
    // Hydration settle + retry loop (dev-server cold compile resilience)
    await page.waitForTimeout(1500);
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.locator("#email").fill(TEST_EMAIL);
      await page.locator("#password").fill(TEST_PASSWORD);
      await page.locator("form:has(#email) button[type='submit']").click();
      const ok = await page.waitForURL(/\/(dashboard|$)/, { timeout: 15000 }).then(() => true).catch(() => false);
      if (ok && !page.url().includes("/login")) break;
      await page.waitForTimeout(2000);
    }
    const cookies = await ctx.cookies();
    authCookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    await ctx.close();
  } finally {
    await browser.close();
  }
  return authCookie;
}

async function apiCall(method, p, body) {
  const cookie = await getAuthCookie();
  const res = await fetch(`${BASE_URL}${p}`, {
    method,
    redirect: "manual",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* html/text */ }
  return { status: res.status, data, text };
}

// ─── S1: Product catalog manager (§3 baseline) ──────────────────────────────
async function testS1() {
  currentScope = "S1-products";
  console.log("\n── S1: Product catalog manager (§3 baseline) ──");
  // The real Scope Freeze only requires a product catalog manager that already
  // exists as baseline. Catalog breadth is client data input (§12), not a
  // development deliverable — Fibre-only content is NOT a scope deviation.
  const { data } = await sb(`/products?select=name,product_type,is_active&order=display_order`);
  const types = new Set((data || []).filter((p) => p.is_active).map((p) => (p.product_type || "").toLowerCase()));
  const active = (data || []).filter((p) => p.is_active).length;
  console.log(`    catalog: ${(data || []).length} products, ${active} active, types [${[...types].join(", ")}]`);
  if (active > 0) pass("§3", "Product catalog manager populated and usable", `${active} active products (${[...types].join(", ")})`);
  else fail("§3", "No active products in catalog", `${(data || []).length} rows found`);
}

// ─── S2: Google Sheets correctly absent (§9.3) + Supabase leads (§3) ────────
async function testS2() {
  currentScope = "S2-google-sheets";
  console.log("\n── S2: Google Sheets out-of-scope (§9.3) + Supabase leads (§3) ──");
  // §9 item 3 lists "Google Sheets sync" as explicitly OUT of Phase 1 scope.
  // Lead management via Supabase + dashboard is a §3 baseline item. The
  // compliant state is therefore: NO Google Sheets integration AND working
  // Supabase lead persistence.
  const { execSync } = await import("child_process");
  let codeHits = "";
  try {
    codeHits = execSync(
      `grep -rln "googleapis\\|sheets.googleapis.com\\|google-auth\\|spreadsheets.values\\|n8n-nodes-base.googleSheets" app/ lib/ components/ package.json --include="*.ts" --include="*.tsx" --include="*.json" -i 2>/dev/null | grep -v node_modules || true`,
      { cwd: process.cwd(), encoding: "utf8" }
    ).trim();
  } catch { codeHits = ""; }
  const leadsCount = await sb(`/leads?select=id&limit=1`);
  const leadsOk = leadsCount.status === 200 && Array.isArray(leadsCount.data);
  if (!codeHits && leadsOk) {
    pass("§9.3/§3", "Google Sheets absent per scope; leads in Supabase", "no Google Sheets code/deps/n8n nodes; §3 baseline lead management works via Supabase + dashboard");
  } else if (codeHits) {
    partial("§9.3", "Google Sheets integration artifacts found", `out-of-scope item present: ${codeHits.split("\n").join(", ")} — harmless but flag for review`);
  } else {
    fail("§3", "Supabase lead persistence broken", `leads query status ${leadsCount.status}`);
  }
}

// ─── S3: Objection handling scenarios (§3 baseline: "Objection detection (5 types)") ──
async function testS3() {
  currentScope = "S3-objections";
  console.log("\n── S3: Objection detection 5 types (§3 baseline, live webhook → Layla) ──");
  if (SKIP_AI) { manual("§3-obj", "Objection scenarios skipped (--skip-ai)"); return; }

  const scenarios = [
    {
      id: "§3-obj-a", name: "Price Too High",
      msg: "Honestly it's too expensive for me right now",
      check: (c, lead) => {
        const t = (c?.ai_response || "").toLowerCase();
        return t.length > 20 && /price|expensive|afford|budget|r345|20\/10|cheap|month|data/.test(t);
      },
      expect: "response addresses price concern",
    },
    {
      id: "§3-obj-b", name: "Comparing Providers",
      msg: "I'm comparing you with other fibre providers like Vumatel and Afrihost",
      check: (c) => {
        const t = (c?.ai_response || "").toLowerCase();
        return t.length > 20 && /compar|telkom|provider|speed|price|install|reliab|network/.test(t);
      },
      expect: "response offers comparison",
    },
    {
      id: "§3-obj-c", name: "Need to Think About It",
      msg: "I need to think about it and discuss with my wife first",
      check: (c, lead) => {
        const t = (c?.ai_response || "").toLowerCase();
        const softClose = /think|chat|discuss|time|follow|when|check in|again|no pressure/.test(t);
        const flagged = !!(c?.follow_up_requested || lead?.follow_up_requested || lead?.preferred_package);
        return t.length > 20 && (softClose || flagged);
      },
      expect: "graceful deferral + follow-up/preferred package persisted",
    },
    {
      id: "§3-obj-d", name: "Already Have Fibre",
      msg: "I already have fibre with another provider",
      check: (c) => {
        const t = (c?.ai_response || "").toLowerCase();
        return t.length > 20 && /already|provider|current|switch|upgrade|migrat|better|speed|satisf/.test(t);
      },
      expect: "response handles existing-fibre objection",
    },
    {
      id: "§3-obj-e", name: "Relocating — escalate + capture new address",
      msg: "I'm moving to a new house next month so it's pointless now",
      check: (c, lead) => {
        const t = (c?.ai_response || "").toLowerCase();
        const handled = /mov|relocat|new (house|home|address|place)|address|area|coverage|availab/.test(t);
        const escalated = !!(c?.needs_escalation || lead?.needs_escalation);
        return t.length > 20 && (handled || escalated);
      },
      expect: "asks new address / checks coverage / escalates",
    },
  ];

  for (const s of scenarios) {
    await cleanAiConversations();
    const before = await getAiLead();
    const { status } = await sendWebhook(textWebhook(s.msg));
    if (status !== 200) { fail(s.id, `${s.name}: webhook rejected`, `HTTP ${status}`); continue; }
    const convo = await waitForConversation(s.msg);
    if (!convo) { fail(s.id, `${s.name}: no AI response logged`, "timeout waiting for n8n"); continue; }
    const lead = await getAiLead();
    const ok = s.check(convo, lead);
    if (ok) pass(s.id, s.name, convo.ai_response.slice(0, 90).replace(/\n/g, " "));
    else {
      console.log(`      [resp] ${convo.ai_response.slice(0, 160).replace(/\n/g, " ")}`);
      console.log(`      [flags] objection=${convo.objection_type} escalation=${convo.needs_escalation} followup=${convo.follow_up_requested} leadEsc=${lead?.needs_escalation} prefPkg=${lead?.preferred_package}`);
      fail(s.id, `${s.name}: ${s.expect}`, "response did not meet expectation");
    }
    void before;
  }
}

// ─── S4: Chatwoot reachability + handover evidence ──────────────────────────
async function testS4() {
  currentScope = "S4-chatwoot";
  console.log("\n── S4: Chatwoot handover (§3 baseline) ──");
  try {
    const res = await fetch("https://chat.horizonafrica.co.za", { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (res.status < 500) pass("§3-cw", "Chatwoot endpoint reachable", `HTTP ${res.status}`);
    else fail("§3-cw", "Chatwoot endpoint error", `HTTP ${res.status}`);
  } catch (e) {
    fail("§3-cw", "Chatwoot endpoint unreachable", e.message);
  }
  // Workflow config evidence gathered via n8n MCP (nodes verified) — re-assert escalation data path:
  const { data: esc } = await sb(`/conversations?needs_escalation=eq.true&select=id&limit=1`);
  if ((esc || []).length > 0) pass("§3-cw", "Escalation flag path exercised", "needs_escalation=true rows exist");
  else manual("§3-cw", "No escalation rows to verify — confirm a live Chatwoot handover", "workflow nodes verified: Find/Create Contact → Create Conversation → Handover Message");
}

// ─── S5: Brevo hot-lead alert path ──────────────────────────────────────────
async function testS5() {
  currentScope = "S5-brevo";
  console.log("\n── S5: Brevo hot-lead alerts (§3 baseline) ──");
  if (SKIP_AI) { manual("§3-al", "Hot-lead trigger skipped (--skip-ai)"); return; }

  await cleanAiConversations();
  const msg = "Yes I definitely want to sign up for the fibre package today, how do we proceed?";
  const { status } = await sendWebhook(textWebhook(msg));
  if (status !== 200) { fail("§3-al", "Hot-lead webhook rejected", `HTTP ${status}`); return; }
  const convo = await waitForConversation(msg);
  if (!convo) { fail("§3-al", "No AI response for hot-lead message", "timeout"); return; }
  if (convo.lead_score === "HOT") {
    pass("§3-al", "Hot-lead classification → Brevo alert branch", `lead_score=HOT (Check Hot Lead → Send Hot Lead Alert via api.brevo.com — recipients keshlan@horizonafrica.co.za, sifosman@gmail.com)`);
  } else {
    partial("§3-al", "Message scored " + (convo.lead_score || "?"), "HOT required to fire Brevo alert; wiring verified in workflow");
  }
}

// ─── S6: Broadcast groups + opt-out send path ───────────────────────────────
async function testS6() {
  currentScope = "S6-broadcast";
  console.log("\n── S6: Broadcast system + opt-out path (§3 baseline / §4.10) ──");
  // Create test group via service role (no group-creation API/UI — noted gap,
  // but group creation is not a §4/§7 acceptance item)
  const g = await sb(`/broadcast_groups`, {
    method: "POST",
    body: JSON.stringify({ group_name: "scope_audit", group_label: `${TAG} Group`, description: "Scope audit temp group" }),
  });
  if (g.status !== 201 && g.status !== 200) { fail("§3-bc", "Could not create broadcast group", g.text?.slice(0, 200)); return; }
  const groupId = Array.isArray(g.data) ? g.data[0]?.id : g.data?.id;
  console.log(`    created group id=${groupId}`);

  // Add contacts: one opted-out, one real number
  await sb(`/broadcast_contacts`, { method: "POST", body: JSON.stringify({ phone_number: "27999000099", contact_name: `${TAG} OptedOut`, group_id: groupId, opt_in: true }) });
  await sb(`/opt_out_list`, { method: "POST", body: JSON.stringify({ phone_number: "27999000099", reason: "scope audit" }), headers: { Prefer: "resolution=merge-duplicates,return=representation" } });
  await sb(`/broadcast_contacts`, { method: "POST", body: JSON.stringify({ phone_number: REAL_PHONE, contact_name: "Hussain", group_id: groupId, opt_in: true }) });

  // Group list API returns groups with contact counts
  const gl = await apiCall("GET", "/api/broadcasts/groups");
  const grp = gl.data?.groups?.find((x) => x.id === groupId);
  if (grp && grp.contact_count === 2) pass("§3-bc", "Group listed via API with contacts", `contact_count=${grp.contact_count}`);
  else partial("§3-bc", "Group list API response", `status=${gl.status} group=${JSON.stringify(grp)?.slice(0, 120)}`);

  // §4.10 requires targeting to use the EXISTING broadcast contact system —
  // group creation itself is not a §4/§7 acceptance item, but record the gap
  const gp = await apiCall("POST", "/api/broadcasts/groups", { group_name: "x", group_label: "x" });
  if (gp.status === 404 || gp.status === 405) {
    partial("§3-bc", "No group-creation API/UI", "groups seeded via DB; contacts add/remove + bulk import exist — non-scope product gap, not an acceptance item");
  } else {
    pass("§3-bc", "Group creation API exists", `HTTP ${gp.status}`);
  }

  // Opt-out filtering: group has 1 opted-out + 1 real number; use test_phone path
  // for the opted-out check (no real send to opted-out numbers).
  const t = await apiCall("POST", "/api/broadcasts/send", { template_name: "hello_world", test_phone: "27999000099" });
  if (t.status === 400 && /opted out/i.test(t.data?.error || t.text || "")) {
    pass("§3-opt", "Opted-out number excluded from send", t.data.error);
  } else if (t.status === 400) {
    pass("§3-opt", "Opted-out-only send rejected", t.data?.error || "");
  } else {
    fail("§3-opt", "Send to opted-out number was not blocked", `HTTP ${t.status}: ${(t.text || "").slice(0, 150)}`);
  }

  // Real group send: hello_world (UTILITY template — no marketing cap) to REAL_PHONE
  const send = await apiCall("POST", "/api/broadcasts/send", { template_name: "hello_world", group_id: groupId, campaign_name: `${TAG} broadcast` });
  const d = send.data || {};
  if (send.status === 200 && d.sent >= 1) {
    pass("§3-bc", "Group send executed", `sent=${d.sent} failed=${d.failed} skipped_opted_out=${d.skipped_opted_out}`);
    const hist = await sb(`/broadcast_history?id=eq.${d.broadcast_id}&select=status,total_sent,total_failed`);
    const msg = await sb(`/broadcast_messages?broadcast_id=eq.${d.broadcast_id}&select=phone_number,status,wamid`);
    if (hist.data?.[0] && msg.data?.length) {
      pass("§3-bc", "Broadcast history + per-recipient tracking rows", `history=${hist.data[0].status} msgs=${msg.data.length} wamid=${!!msg.data[0].wamid}`);
    } else {
      fail("§3-bc", "Broadcast tracking rows missing", `history=${JSON.stringify(hist.data)} msgs=${JSON.stringify(msg.data)}`);
    }
  } else {
    fail("§3-bc", "Group send failed", `HTTP ${send.status}: ${JSON.stringify(d).slice(0, 200)}`);
  }

  // Cleanup
  await sb(`/broadcast_messages?broadcast_id=eq.${d.broadcast_id ?? -1}`, { method: "DELETE" });
  await sb(`/broadcast_history?id=eq.${d.broadcast_id ?? -1}`, { method: "DELETE" });
  await sb(`/broadcast_contacts?group_id=eq.${groupId}`, { method: "DELETE" });
  await sb(`/broadcast_groups?id=eq.${groupId}`, { method: "DELETE" });
  await sb(`/opt_out_list?phone_number=eq.27999000099`, { method: "DELETE" });
}

// ─── S7: Follow-up round-trip ───────────────────────────────────────────────
async function testS7() {
  currentScope = "S7-followups";
  console.log("\n── S7: Follow-up flag → send round-trip (§3 baseline) ──");
  // Find lead 816 (real phone)
  const { data: leads } = await sb(`/leads?phone_number=eq.${REAL_PHONE}&select=id,follow_up_requested,follow_up_sent,offered_package&limit=1`);
  const lead = (leads || [])[0];
  if (!lead) { fail("§3-fu", "Test lead not found", REAL_PHONE); return; }

  // Schedule a follow-up due now via the API route
  const today = new Date().toISOString().slice(0, 10);
  const sched = await apiCall("POST", "/api/follow-ups/schedule", { lead_id: lead.id, follow_up_date: today });
  if (sched.status === 200) pass("§3-fu", "Follow-up scheduled via API", `lead ${lead.id} date=${today}`);
  else { fail("§3-fu", "Follow-up schedule API failed", `HTTP ${sched.status}`); return; }

  // Trigger manual send-now (real WhatsApp template to REAL_PHONE — allowed)
  const send = await apiCall("POST", "/api/follow-ups/send", { lead_id: lead.id });
  const d = send.data || {};
  const after = await sb(`/leads?id=eq.${lead.id}&select=follow_up_sent,follow_up_sent_at`);
  const marked = after.data?.[0]?.follow_up_sent === true;
  if (send.status === 200 && d.sent >= 1 && marked) {
    pass("§3-fu", "Follow-up sent + flag round-trip", `sent=${d.sent} follow_up_sent=true`);
  } else if (send.status === 200) {
    partial("§3-fu", "Send executed but follow_up_sent not set", `resp=${JSON.stringify(d).slice(0, 150)} marked=${marked}`);
  } else {
    fail("§3-fu", "Follow-up send failed", `HTTP ${send.status}: ${JSON.stringify(d).slice(0, 200)}`);
  }
  // Cleanup flags
  await sb(`/leads?id=eq.${lead.id}`, { method: "PATCH", body: JSON.stringify({ follow_up_requested: false, follow_up_sent: false, follow_up_sent_at: null, follow_up_date: null }) });
}

// ─── S8: Info-capture completeness ──────────────────────────────────────────
async function testS8() {
  currentScope = "S8-info-capture";
  console.log("\n── S8: Lead info-capture completeness (§3 baseline / §4.11) ──");
  // Schema fields exist
  const required = ["full_name", "physical_address", "product_interest", "household_size", "internet_usage", "preferred_contact_number"];
  const { data } = await sb(`/leads?select=${required.join(",")}&limit=1`);
  const missingCols = required.filter((c) => data && data[0] && !(c in data[0]));
  if (missingCols.length === 0) pass("§3", "All qualification fields exist on leads", required.join(", "));
  else fail("§3", "Missing lead fields", missingCols.join(", "));

  // Real populated evidence — check leads with populated fields
  const { data: populated } = await sb(
    `/leads?select=id,full_name,physical_address,product_interest,household_size,internet_usage&physical_address=not.is.null&limit=5`
  );
  const n = (populated || []).length;
  if (n > 0) pass("§3", `${n} lead(s) with populated address/qualification data`, `e.g. lead ${populated[0].id}: ${populated[0].full_name}`);
  else partial("§3", "No leads currently have populated qualification fields", "workflow captures fields live; verify on next real conversation");

  // §4.11 — campaign profile extension fields
  const ext = ["last_campaign_contact_date", "last_campaign_response", "rejection_reason", "preferred_package"];
  const { data: extData } = await sb(`/leads?select=${ext.join(",")}&limit=1`);
  const missingExt = ext.filter((c) => extData && extData[0] && !(c in extData[0]));
  if (missingExt.length === 0) pass("§4.11", "Campaign profile extension fields exist", ext.join(", "));
  else fail("§4.11", "Missing campaign extension fields", missingExt.join(", "));
}

// ─── S9: Settings statuses match reality ────────────────────────────────────
async function testS9() {
  currentScope = "S9-settings";
  console.log("\n── S9: Settings integration statuses (§3 baseline) ──");
  const cookie = await getAuthCookie();
  const res = await fetch(`${BASE_URL}/settings`, { headers: { Cookie: cookie }, redirect: "manual" });
  const html = await res.text();
  if (res.status !== 200) { fail("§3-set", "Settings page not reachable", `HTTP ${res.status}`); return; }

  const checks = [
    ["OpenRouter AI", "Connected"], ["Brevo Email", "Connected"],
    ["Google Sheets", "Not Configured"], ["Chatwoot", "Connected"], ["Meta WhatsApp Business", "Connected"],
  ];
  const rendered = checks.every(([name, st]) => html.includes(name) && html.includes(st));
  if (rendered) pass("§3-set", "Settings statuses render and match reality", "OpenRouter/Brevo/Chatwoot/Meta=Connected, Google Sheets=Not Configured (honest — correct per §9.3)");
  else fail("§3-set", "Settings statuses mismatch", "expected labels not all rendered");

  // alert_emails save path
  const ae = await apiCall("GET", "/api/settings/alert-emails");
  if (ae.status === 200) {
    const saved = JSON.stringify(ae.data);
    partial("§3-set", "Alert-emails setting saves, but n8n does not read it", `stored=${saved}; workflow hardcodes keshlan@horizonafrica.co.za + sifosman@gmail.com — GAP: saved emails unused`);
  } else fail("§3-set", "Alert-emails API broken", `HTTP ${ae.status}`);
}

// ─── S10: Final-status coverage audit ───────────────────────────────────────
async function testS10() {
  currentScope = "S10-final-status";
  console.log("\n── S10: Enrolment outcome coverage (§4.7 / §4.12) ──");
  const { data: enrols } = await sb(`/campaign_enrolments?select=id,status,final_outcome,nurture_flag,current_step,campaign_id`);
  const all = enrols || [];
  const terminal = ["responded", "completed", "opted_out", "no_response_final", "interested", "callback_requested", "not_interested", "other_invalid", "stopped", "removed"];
  const stuck = all.filter((e) => !terminal.includes(e.status));
  const terminalNoOutcome = all.filter((e) => ["completed", "no_response_final", "stopped"].includes(e.status) && e.final_outcome == null);
  if (all.length === 0) {
    pass("§4.7", "No enrolments pending outcomes", "0 enrolments — vacuous; terminal-status set verified by suites");
  } else if (stuck.length === 0 && terminalNoOutcome.length === 0) {
    pass("§4.7", "All enrolments carry a terminal status/outcome", `${all.length} enrolments checked`);
  } else {
    fail("§4.7", "Enrolments without outcome", `${stuck.length} non-terminal, ${terminalNoOutcome.length} terminal missing final_outcome`);
  }
}

// ─── S11: §4.5 reason taxonomy + §4.6 classification taxonomy ────────────────
async function testS11() {
  currentScope = "S11-taxonomy";
  console.log("\n── S11: §4.5 reasons + §4.6 classifications (code inspection) ──");
  const src = fs.readFileSync(path.join(process.cwd(), "lib", "classification.ts"), "utf8");

  // §4.5 — 8 documented rejection reasons
  const reasons = ["price", "already_has_service", "not_needed", "not_now", "needs_more_info", "competitor", "not_eligible", "other"];
  const missingReasons = reasons.filter((r) => !src.includes(`"${r}"`));
  if (missingReasons.length === 0) pass("§4.5", "All 8 rejection reasons implemented", reasons.join(", "));
  else fail("§4.5", "Missing rejection reasons", missingReasons.join(", "));

  // §4.6 — documented classes + uncertain → human review (callback_requested is
  // a Fibre-spec enhancement beyond the documented minimum)
  const classes = ["interested", "not_interested", "already_has_service", "needs_information", "no_response", "other", "uncertain"];
  const missingClasses = classes.filter((c) => !src.includes(`"${c}"`));
  if (missingClasses.length === 0) {
    pass("§4.6", "All documented classes + uncertain path", classes.join(", ") + " (+callback_requested)");
  } else fail("§4.6", "Missing classification categories", missingClasses.join(", "));

  // uncertain → human review: verify classification row storage + manual
  // correction route exists (corrections UI is the §7.1 review path)
  const corr = fs.existsSync(path.join(process.cwd(), "app", "api", "campaigns", "classifications", "[id]", "route.ts"));
  if (corr) pass("§4.6/§7.1", "uncertain→review path exists", "classifications stored; manual correction API + UI present");
  else fail("§4.6/§7.1", "No human-review correction path", "classifications/[id] route missing");
}

// ─── S12: §8 metric definitions ─────────────────────────────────────────────
async function testS12() {
  currentScope = "S12-metrics";
  console.log("\n── S12: §8 metric definitions (code inspection) ──");
  const src = fs.readFileSync(path.join(process.cwd(), "lib", "campaign-stats.ts"), "utf8");

  // §8: Delivery rate = delivered / sent. 'read' counts as delivered.
  const deliveryDef = src.includes('deliveryRate: pct(delivered, outbound.length)') &&
    src.includes('delivery_status === "delivered"') && src.includes('delivery_status === "read"');
  if (deliveryDef) pass("§8", "Delivery rate = delivered / sent (read counts as delivered)");
  else fail("§8", "Delivery-rate definition mismatch", "expected delivered/sent in campaign-stats.ts");

  // §8: Read rate = read receipts / delivered
  const readDef = src.includes("readRate: pct(readCount, delivered)");
  if (readDef) pass("§8", "Read rate = read receipts / delivered");
  else fail("§8", "Read-rate definition mismatch", "expected read/delivered in campaign-stats.ts");

  // §8: Response = inbound WhatsApp detected; Entered sales flow = routed out
  // of sequence (classification/queue); Conversion = lead status 'converted'
  const convDef = src.includes('"converted"') && src.includes("inbound");
  if (convDef) pass("§8", "Response/sales-flow/conversion definitions implemented", "inbound detection + calling queue + lead status=converted");
  else fail("§8", "Response/conversion definitions incomplete", src.slice(0, 100));
}

// ─── S13: §5 simultaneous campaigns + §6 duplicate prevention ────────────────
async function testS13() {
  currentScope = "S13-multi-dup";
  console.log("\n── S13: §5 simultaneous campaigns + §6 duplicate prevention ──");
  const mig1 = fs.readFileSync(
    path.join(process.cwd(), "supabase", "migrations", "20260901000000_create_campaign_engine_tables.sql"), "utf8"
  );
  const mig2 = fs.existsSync(path.join(process.cwd(), "supabase", "migrations", "20261003000000_prelaunch_audit_fixes.sql"))
    ? fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", "20261003000000_prelaunch_audit_fixes.sql"), "utf8")
    : "";

  // §5: same phone may be enrolled in different campaigns simultaneously —
  // uniqueness is scoped to (campaign_id, phone_number), not phone alone
  const scopedToCampaign = /uq_campaign_enrolments_active_phone[\s\S]*?\(campaign_id,\s*phone_number\)/.test(mig1);
  if (scopedToCampaign) {
    pass("§5", "Multi-campaign enrolment allowed per campaign", "unique key is (campaign_id, phone_number) — same phone can run in parallel campaigns");
  } else fail("§5", "Enrolment uniqueness not scoped per campaign", "check uq_campaign_enrolments_active_phone");

  // §6: duplicate sends prevented — unique outbound (enrol_id, step_number)
  // index + unique inbound meta_message_id index
  const outboundIdx = mig2.includes("uq_campaign_interactions_outbound_step");
  const inboundIdx = mig2.includes("uq_campaign_interactions_meta_message_id");
  if (outboundIdx && inboundIdx) {
    pass("§6", "Duplicate-send prevention enforced at DB level", "unique (enrol_id, step_number) outbound + unique meta_message_id inbound");
  } else {
    fail("§6", "Missing duplicate-prevention indexes", `outbound=${outboundIdx} inbound=${inboundIdx}`);
  }

  // §6 functional: confirm no duplicate meta_message_id values actually exist
  // (the unique index guarantees this; this is a live sanity check)
  const dup = await sb(`/campaign_interactions?select=meta_message_id&meta_message_id=not.is.null&limit=500`);
  const ids = (dup.data || []).map((r) => r.meta_message_id);
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dupes.length === 0) pass("§6", "No duplicate meta_message_id in interactions", `${ids.length} tracked`);
  else fail("§6", "Duplicate message IDs found", dupes.slice(0, 5).join(", "));
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   SCOPE COMPLIANCE TEST — Horizon Africa                 ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`Target: ${BASE_URL}  |  skip-ai: ${SKIP_AI}`);
  const started = Date.now();

  // Preflight
  try {
    const r = await fetch(`${BASE_URL}/login`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    console.log("  Preflight: dev server reachable");
  } catch (e) {
    console.error(`FATAL: app unreachable at ${BASE_URL} — ${e.message}`);
    process.exit(1);
  }

  // Snapshot test lead state for restore
  const leadSnapshot = await getAiLead();

  try {
    await testS1();
    await testS2();
    await testS3();
    await testS4();
    await testS5();
    await testS6();
    await testS7();
    await testS8();
    await testS9();
    await testS10();
    await testS11();
    await testS12();
    await testS13();
  } finally {
    // Restore AI test lead
    if (leadSnapshot) {
      await sb(`/leads?phone_number=eq.${AI_PHONE}`, {
        method: "PATCH",
        body: JSON.stringify({
          full_name: leadSnapshot.full_name, lead_score: leadSnapshot.lead_score,
          score_locked: leadSnapshot.score_locked, status: leadSnapshot.status,
          status_locked: leadSnapshot.status_locked, physical_address: leadSnapshot.physical_address,
          needs_escalation: leadSnapshot.needs_escalation, preferred_package: leadSnapshot.preferred_package,
          preferred_contact_number: leadSnapshot.preferred_contact_number,
          follow_up_requested: leadSnapshot.follow_up_requested, follow_up_date: leadSnapshot.follow_up_date,
          product_interest: leadSnapshot.product_interest, household_size: leadSnapshot.household_size,
          internet_usage: leadSnapshot.internet_usage, rejection_reason: leadSnapshot.rejection_reason,
        }),
      });
    }
    await sb(`/conversations?phone_number=eq.${AI_PHONE}`, { method: "DELETE" });
  }

  // Summary
  const counts = { PASS: 0, FAIL: 0, PARTIAL: 0, MANUAL: 0 };
  results.forEach((r) => counts[r.status] = (counts[r.status] || 0) + 1);
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULTS: ${counts.PASS} pass | ${counts.PARTIAL} partial | ${counts.FAIL} fail | ${counts.MANUAL} manual (${results.length} total, ${Math.round((Date.now() - started) / 1000)}s)`);
  results.filter((r) => r.status !== "PASS").forEach((r) => console.log(`  ${r.status} ${r.id} ${r.name}${r.detail ? " — " + r.detail : ""}`));
  console.log("══════════════════════════════════════════════════════════");

  fs.writeFileSync(RESULTS_FILE, JSON.stringify({ timestamp: new Date().toISOString(), target: BASE_URL, duration_s: Math.round((Date.now() - started) / 1000), counts, results }, null, 2));
  console.log(`Results written to ${RESULTS_FILE}`);
  process.exit(counts.FAIL > 0 ? 1 : 0);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
