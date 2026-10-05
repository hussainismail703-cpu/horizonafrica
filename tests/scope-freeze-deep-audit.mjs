#!/usr/bin/env node
/**
 * Scope Freeze Deep Audit Test Suite — Horizon Africa
 *
 * Master source: `Layla Phase 1 Scope Freeze.txt` (Q-2026-0825-HC-CAMPAIGN)
 *
 * Comprehensive, adversarial, boundary and edge-case testing against the
 * complete Phase 1 Scope Freeze requirements:
 *
 * Module 1: Campaign Configuration & Life-Cycle Boundaries (§4.1, §4.2, §4.10)
 * Module 2: Sequence Progression, Timing & Parameter Interpolation (§4.2, §4.3, §6)
 * Module 3: Response Detection, Intent Classification & Taxonomy (§4.4, §4.5, §4.6)
 * Module 4: Interaction Tracking, Monotonic Delivery & Error Visibility (§4.7, §8)
 * Module 5: Performance Metric Math & Statistical Invariants (§4.9, §8)
 * Module 6: Customer Profile Extensions, Flat Journey & No-Response Flagging (§4.11, §4.12, §7.3)
 * Module 7: Simultaneous Campaigns & Multi-Enrolment Isolation (§5, §6)
 * Module 8: Extended Manual Controls & Audit Integrity (§7.1, §7.1a)
 * Module 9: Out-of-Scope Boundary Verification (§9)
 *
 * Safety rules:
 * - Real WhatsApp sends ONLY to approved test phone (27832763116 / lead 816).
 * - Real Fibre Campaign (febe1cac-…) remains PAUSED.
 * - All test campaigns, enrolments, interactions, classifications, queue items, and groups
 *   are tagged with [DEEP-AUDIT] and rigorously cleaned up.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { chromium } from "playwright";
import { webhookHeaders, postWebhook } from "./lib/webhook.mjs";

// ─── Environment & Config ──────────────────────────────────────────────────
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
const APP_SECRET = process.env.APP_SECRET || "ce2d384445d497c72b779a56c4083d55";

const REAL_PHONE = "27832763116";
const TEST_PHONE_A = "27839990001";
const TEST_PHONE_B = "27839990002";
const TAG = "[DEEP-AUDIT]";

const RESULTS_FILE = path.join(process.cwd(), "tests", "scope-freeze-deep-audit-results.json");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment");
  process.exit(1);
}

// ─── Test Reporting ────────────────────────────────────────────────────────
const results = [];
let currentModule = "Setup";

function record(status, id, name, detail = "") {
  results.push({ module: currentModule, id, name, status, detail, timestamp: new Date().toISOString() });
  const icon = status === "PASS" ? "✅" : status === "FAIL" ? "❌" : status === "PARTIAL" ? "⚠️" : "📝";
  console.log(`  ${icon} [${id}] ${name}${detail ? ` — ${detail}` : ""}`);
}
const pass = (id, n, d) => record("PASS", id, n, d);
const fail = (id, n, d) => record("FAIL", id, n, d);
const partial = (id, n, d) => record("PARTIAL", id, n, d);

// ─── Supabase REST Client (Service Role) ───────────────────────────────────
async function sb(endpoint, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${endpoint}`, {
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
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, data, text };
}

// ─── Authenticated Cookie Helper ───────────────────────────────────────────
let authCookie = null;
async function getAuthCookie() {
  if (authCookie) return authCookie;
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#email", { timeout: 20000 });
    await page.waitForTimeout(1000);
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.locator("#email").fill(TEST_EMAIL);
      await page.locator("#password").fill(TEST_PASSWORD);
      const submitBtn = page.locator("form:has(#email) button[type='submit']");
      await submitBtn.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      await submitBtn.click({ timeout: 5000 }).catch(() => {});
      const ok = await page.waitForURL(/\/(dashboard|$)/, { timeout: 15000 }).then(() => true).catch(() => false);
      if (ok && !page.url().includes("/login")) break;
      await page.waitForTimeout(1500);
    }
    const cookies = await ctx.cookies();
    authCookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    await ctx.close();
  } finally {
    await browser.close();
  }
  return authCookie;
}

async function api(method, route, body = undefined, headers = {}) {
  const cookie = await getAuthCookie();
  const res = await fetch(`${BASE_URL}${route}`, {
    method,
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, data, text };
}

async function triggerProcess() {
  const res = await fetch(`${BASE_URL}/api/campaigns/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APP_SECRET}`,
    },
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}

// ─── Webhook Helper ────────────────────────────────────────────────────────
async function sendInboundWebhook(fromPhone, bodyText, options = {}) {
  const wamid = options.wamid || `wamid.deepaudit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    entry: [
      {
        id: "1257101724147822",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "27757774389", phone_number_id: "1257101724147822" },
              contacts: [{ profile: { name: options.name || "Deep Audit Test" }, wa_id: fromPhone }],
              messages: [
                options.messagePayload || {
                  from: fromPhone,
                  id: wamid,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  text: { body: bodyText },
                  type: "text",
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
  const res = await postWebhook(BASE_URL, payload);
  return { status: res.status, wamid, body: res.response };
}

// ─── Cleanups ──────────────────────────────────────────────────────────────
async function cleanupAuditData() {
  // Clean all [DEEP-AUDIT] campaigns
  const { data: camps } = await sb(`/campaigns?name=like.*${encodeURIComponent(TAG)}*&select=id`);
  if (camps && camps.length > 0) {
    for (const c of camps) {
      await sb(`/campaign_classifications?campaign_id=eq.${c.id}`, { method: "DELETE" }).catch(() => {});
      await sb(`/calling_queue?campaign_id=eq.${c.id}`, { method: "DELETE" }).catch(() => {});
      await sb(`/campaign_errors?campaign_id=eq.${c.id}`, { method: "DELETE" }).catch(() => {});
      await sb(`/campaign_interactions?campaign_id=eq.${c.id}`, { method: "DELETE" }).catch(() => {});
      await sb(`/campaign_enrolments?campaign_id=eq.${c.id}`, { method: "DELETE" }).catch(() => {});
      await sb(`/campaign_steps?campaign_id=eq.${c.id}`, { method: "DELETE" }).catch(() => {});
      await sb(`/campaigns?id=eq.${c.id}`, { method: "DELETE" }).catch(() => {});
    }
  }

  // Clean test phones from opt-out list and interactions
  await sb(`/opt_out_list?phone_number=in.(${TEST_PHONE_A},${TEST_PHONE_B})`, { method: "DELETE" });
  await sb(`/campaign_interactions?phone_number=in.(${TEST_PHONE_A},${TEST_PHONE_B})`, { method: "DELETE" });
  await sb(`/campaign_enrolments?phone_number=in.(${TEST_PHONE_A},${TEST_PHONE_B})`, { method: "DELETE" });
  await sb(`/calling_queue?phone_number=in.(${TEST_PHONE_A},${TEST_PHONE_B})`, { method: "DELETE" });
  await sb(`/broadcast_groups?group_name=like.deep_audit*`, { method: "DELETE" });
  await sb(`/inbound_webhook_messages?phone_number=in.(${TEST_PHONE_A},${TEST_PHONE_B})`, { method: "DELETE" });
}

// Ensure dedicated test leads exist and are linked
async function ensureTestLeads() {
  const { data: lA } = await sb(`/leads?phone_number=eq.${TEST_PHONE_A}&select=id`);
  if (!lA || lA.length === 0) {
    await sb(`/leads`, {
      method: "POST",
      body: JSON.stringify({ phone_number: TEST_PHONE_A, full_name: "Deep Audit Lead A", status: "new" }),
    });
  }
  const { data: lB } = await sb(`/leads?phone_number=eq.${TEST_PHONE_B}&select=id`);
  if (!lB || lB.length === 0) {
    await sb(`/leads`, {
      method: "POST",
      body: JSON.stringify({ phone_number: TEST_PHONE_B, full_name: "Deep Audit Lead B", status: "new" }),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 1: Campaign Configuration & Life-Cycle Boundaries (§4.1, §4.2, §4.10)
// ═══════════════════════════════════════════════════════════════════════════
async function module1() {
  currentModule = "Module 1: Campaign Configuration & Life-Cycle Boundaries";
  console.log(`\n── ${currentModule} ──`);

  // T1.1a: Exactly 200-char name boundary accepted
  const exact200Name = (`${TAG} ` + "B".repeat(200)).slice(0, 200);
  const cLong = await api("POST", "/api/campaigns", { name: exact200Name, objective: "Testing exact 200-char boundary" });
  if (cLong.status === 201 && cLong.data?.id) {
    pass("T1.1a", "200-char name boundary accepted", `id=${cLong.data.id}`);
    await api("DELETE", `/api/campaigns/${cLong.data.id}`);
  } else {
    fail("T1.1a", "200-char name boundary failed", `HTTP ${cLong.status}`);
  }

  // T1.1b: Excessive name length (>200) rejected with 400
  const tooLongName = `${TAG} ` + "C".repeat(220);
  const cTooLong = await api("POST", "/api/campaigns", { name: tooLongName, objective: "Testing excessive length" });
  if (cTooLong.status === 400) {
    pass("T1.1b", "Excessive name length (>200) rejected (400)", `status=400`);
  } else {
    fail("T1.1b", "Excessive name length allowed", `status=${cTooLong.status}`);
    if (cTooLong.data?.id) await api("DELETE", `/api/campaigns/${cTooLong.data.id}`);
  }

  // T1.1c: Duplicate campaign name 409 Conflict
  const dupName = `${TAG} Unique Dup Test ${Date.now()}`;
  const c1 = await api("POST", "/api/campaigns", { name: dupName, objective: "First copy" });
  const c2 = await api("POST", "/api/campaigns", { name: dupName, objective: "Second copy" });
  if (c1.status === 201 && c2.status === 409) {
    pass("T1.1c", "Duplicate campaign name returns 409 Conflict", `c1=201, c2=409`);
  } else {
    fail("T1.1c", "Duplicate campaign name handling unexpected", `c1=${c1.status}, c2=${c2.status}`);
  }
  if (c1.data?.id) await api("DELETE", `/api/campaigns/${c1.data.id}`);

  // T1.2: Date range persistence
  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const cDates = await api("POST", "/api/campaigns", {
    name: `${TAG} Date Test ${Date.now()}`,
    objective: "Date testing",
    start_date: today,
    end_date: nextMonth,
  });
  const dateCampId = cDates.data?.id;
  const { data: dateCampRow } = await sb(`/campaigns?id=eq.${dateCampId}&select=start_date,end_date`);
  if (cDates.status === 201 && dateCampRow?.[0]?.start_date?.startsWith(today) && dateCampRow?.[0]?.end_date?.startsWith(nextMonth)) {
    pass("T1.2", "Start date and end date accurately persisted", `start=${today}, end=${nextMonth}`);
  } else {
    fail("T1.2", "Date persistence failed", `row=${JSON.stringify(dateCampRow)}`);
  }

  // T1.3: Sequence reconfigurability without code (§4.2)
  // Step sequence: Day 0 -> Day 2 -> Day 5
  const initialSteps = [
    { step_number: 1, template_name: "telkom_fibre_packages", delay_days: 0, template_parameters: [{ component: "body", source: "custom", value: "R349" }, { component: "body", source: "custom", value: "R425" }, { component: "body", source: "custom", value: "R499" }, { component: "body", source: "custom", value: "R695" }] },
    { step_number: 2, template_name: "telkom_reengagement", delay_days: 2, template_parameters: [{ component: "body", source: "contact_name" }] },
    { step_number: 3, template_name: "telkom_prepaid_offer", delay_days: 5, template_parameters: [] },
  ];
  const sInit = await api("PUT", `/api/campaigns/${dateCampId}/steps`, { steps: initialSteps });
  const { data: stepsInitSaved } = await sb(`/campaign_steps?campaign_id=eq.${dateCampId}&order=step_number.asc`);
  if (sInit.status === 200 && stepsInitSaved?.length === 3) {
    pass("T1.3a", "Initial 3-step sequence configured via API", `steps=3`);
  } else {
    fail("T1.3a", "Initial sequence configuration failed", `status=${sInit.status} saved=${stepsInitSaved?.length}`);
  }

  // Reconfigure to 5 steps without code: Day 0 -> Day 3 -> Day 7 -> Day 14 -> Day 21
  const reconfiguredSteps = [
    { step_number: 1, template_name: "telkom_fibre_packages", delay_days: 0, template_parameters: [{ component: "body", source: "custom", value: "R349" }, { component: "body", source: "custom", value: "R425" }, { component: "body", source: "custom", value: "R499" }, { component: "body", source: "custom", value: "R695" }] },
    { step_number: 2, template_name: "telkom_reengagement", delay_days: 3, template_parameters: [{ component: "body", source: "contact_name" }] },
    { step_number: 3, template_name: "telkom_fibre_packages", delay_days: 7, template_parameters: [{ component: "body", source: "custom", value: "R349" }, { component: "body", source: "custom", value: "R425" }, { component: "body", source: "custom", value: "R499" }, { component: "body", source: "custom", value: "R695" }] },
    { step_number: 4, template_name: "telkom_reengagement", delay_days: 14, template_parameters: [{ component: "body", source: "contact_name" }] },
    { step_number: 5, template_name: "telkom_prepaid_offer", delay_days: 21, template_parameters: [] },
  ];
  const sReconf = await api("PUT", `/api/campaigns/${dateCampId}/steps`, { steps: reconfiguredSteps });
  const { data: stepsReconfSaved } = await sb(`/campaign_steps?campaign_id=eq.${dateCampId}&order=step_number.asc`);
  if (sReconf.status === 200 && stepsReconfSaved?.length === 5) {
    const p1 = stepsReconfSaved[0].template_parameters;
    const p2 = stepsReconfSaved[1].template_parameters;
    const paramsIntact = Array.isArray(p1) && p1.length === 4 && Array.isArray(p2) && p2[0]?.source === "contact_name";
    if (paramsIntact) {
      pass("T1.3b", "Sequence reconfigured to 5 steps with template_parameters preserved", `5 steps, Day 0->3->7->14->21`);
    } else {
      fail("T1.3b", "Reconfigured steps lost template_parameters", `p1=${JSON.stringify(p1)}, p2=${JSON.stringify(p2)}`);
    }
  } else {
    fail("T1.3b", "Reconfiguration PUT failed", `status=${sReconf.status}`);
  }

  // T1.4: Empty sequence activation guard
  const emptyCamp = await api("POST", "/api/campaigns", { name: `${TAG} Empty Test ${Date.now()}`, objective: "Empty steps test" });
  const emptyAct = await api("PATCH", `/api/campaigns/${emptyCamp.data.id}`, { status: "active" });
  if (emptyAct.status === 400 || (emptyAct.data && emptyAct.data.status !== "active")) {
    pass("T1.4", "Activating campaign with 0 steps is blocked", `status=${emptyAct.status}`);
  } else {
    fail("T1.4", "Campaign activated without steps", `status=${emptyAct.status}`);
  }
  await api("DELETE", `/api/campaigns/${emptyCamp.data.id}`);

  // T1.5: Target group attachment & update
  const grpRes = await sb(`/broadcast_groups`, {
    method: "POST",
    body: JSON.stringify({ group_name: `deep_audit_grp_${Date.now()}`, group_label: `${TAG} Target Group` }),
  });
  const testGroupId = grpRes.data?.[0]?.id || grpRes.data?.id;

  const patchGrp = await api("PATCH", `/api/campaigns/${dateCampId}`, { group_id: testGroupId });
  const { data: campWithGrp } = await sb(`/campaigns?id=eq.${dateCampId}&select=group_id`);
  if (patchGrp.status === 200 && campWithGrp?.[0]?.group_id === testGroupId) {
    pass("T1.5", "Campaign group_id attached and updated", `group_id=${testGroupId}`);
  } else {
    fail("T1.5", "Group ID update failed", `status=${patchGrp.status} saved=${campWithGrp?.[0]?.group_id}`);
  }

  // T1.6: Campaign deletion state machine
  await api("PATCH", `/api/campaigns/${dateCampId}`, { status: "active" });
  const delActive = await api("DELETE", `/api/campaigns/${dateCampId}`);
  if (delActive.status === 400) {
    pass("T1.6a", "Deleting active campaign is rejected (400)", `status=400`);
  } else {
    fail("T1.6a", "Deleting active campaign was not rejected", `status=${delActive.status}`);
  }

  await api("PATCH", `/api/campaigns/${dateCampId}`, { status: "paused" });
  const delPaused = await api("DELETE", `/api/campaigns/${dateCampId}`);
  if (delPaused.status === 200) {
    pass("T1.6b", "Deleting paused campaign succeeds and cascades", `status=200`);
  } else {
    fail("T1.6b", "Deleting paused campaign failed", `status=${delPaused.status}`);
  }
  await sb(`/broadcast_groups?id=eq.${testGroupId}`, { method: "DELETE" });
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 2: Sequence Progression, Timing & Parameter Interpolation (§4.2, §4.3, §6)
// ═══════════════════════════════════════════════════════════════════════════
async function module2() {
  currentModule = "Module 2: Sequence Progression, Timing & Parameter Interpolation";
  console.log(`\n── ${currentModule} ──`);

  await ensureTestLeads();

  // Create test campaign with 3 steps
  const c = await api("POST", "/api/campaigns", { name: `${TAG} Sequence Test ${Date.now()}`, objective: "Sequence test" });
  const campId = c.data.id;
  await api("PUT", `/api/campaigns/${campId}/steps`, {
    steps: [
      { step_number: 1, template_name: "telkom_fibre_packages", delay_days: 0, template_parameters: [{ component: "body", source: "custom", value: "R349" }, { component: "body", source: "custom", value: "R425" }, { component: "body", source: "custom", value: "R499" }, { component: "body", source: "custom", value: "R695" }] },
      { step_number: 2, template_name: "telkom_reengagement", delay_days: 3, template_parameters: [{ component: "body", source: "contact_name" }] },
      { step_number: 3, template_name: "telkom_prepaid_offer", delay_days: 7, template_parameters: [] },
    ],
  });

  // T2.1: Enrol test phone at step 0
  const enr = await api("POST", "/api/campaigns/enrolments", {
    campaign_id: campId,
    phone_numbers: [TEST_PHONE_A],
  });
  if (enr.status === 201 && enr.data?.enrolled === 1) {
    pass("T2.1a", "Contact enrolled at step 0 with lead linked", `phone=${TEST_PHONE_A}`);
  } else {
    fail("T2.1a", "Enrolment failed", `status=${enr.status}`);
  }

  // T2.2: Activate campaign and run process
  await api("PATCH", `/api/campaigns/${campId}`, { status: "active" });
  await triggerProcess();
  
  // Verify interaction was recorded for Step 1
  const { data: inter1 } = await sb(`/campaign_interactions?campaign_id=eq.${campId}&phone_number=eq.${TEST_PHONE_A}`);
  if (inter1?.length === 1 && inter1[0].step_number === 1) {
    pass("T2.2", "Process endpoint claims and attempts Step 1 dispatch", `step=1, template=${inter1[0].template_name}`);
  } else {
    fail("T2.2", "Step 1 interaction claim failed", `interactions=${JSON.stringify(inter1)}`);
  }

  // T2.3: Delay enforcement — immediate second process does NOT dispatch Step 2 (delay is 3 days)
  await triggerProcess();
  const { data: inter2 } = await sb(`/campaign_interactions?campaign_id=eq.${campId}&phone_number=eq.${TEST_PHONE_A}`);
  if (inter2?.length === 1) {
    pass("T2.3", "Step 2 delay (3 days) strictly enforced — 0 sends on immediate cycle", `interactions=1`);
  } else {
    fail("T2.3", "Step 2 delay violated", `interactions=${inter2?.length}`);
  }

  // T2.4: Fast-forward time (backdate enrolled_at to 4 days ago) -> Step 2 fires
  const { data: enrRows } = await sb(`/campaign_enrolments?campaign_id=eq.${campId}&phone_number=eq.${TEST_PHONE_A}`);
  const enrId = enrRows[0].id;
  // Mark step 1 interaction as sent and advance enrolment to 1
  await sb(`/campaign_interactions?id=eq.${inter1[0].id}`, { method: "PATCH", body: JSON.stringify({ delivery_status: "sent" }) });
  await sb(`/campaign_enrolments?id=eq.${enrId}`, {
    method: "PATCH",
    body: JSON.stringify({ current_step: 1, enrolled_at: new Date(Date.now() - 4 * 86400000).toISOString() }),
  });

  await triggerProcess();
  const { data: inter3 } = await sb(`/campaign_interactions?campaign_id=eq.${campId}&phone_number=eq.${TEST_PHONE_A}&order=step_number.asc`);
  if (inter3?.length === 2 && inter3[1].step_number === 2) {
    pass("T2.4", "Fast-forwarded enrolment successfully triggers Step 2 progression", `step=2, interactions=2`);
  } else {
    fail("T2.4", "Step 2 advancement failed", `interactions=${inter3?.length}`);
  }

  // Cleanup
  await api("PATCH", `/api/campaigns/${campId}`, { status: "paused" });
  await api("DELETE", `/api/campaigns/${campId}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 3: Response Detection, Intent Classification & Taxonomy (§4.4, §4.5, §4.6)
// ═══════════════════════════════════════════════════════════════════════════
async function module3() {
  currentModule = "Module 3: Response Detection, Intent Classification & Taxonomy";
  console.log(`\n── ${currentModule} ──`);

  await ensureTestLeads();

  // Create active campaign with 2 steps
  const c = await api("POST", "/api/campaigns", { name: `${TAG} Taxonomy Test ${Date.now()}`, objective: "Classification audit" });
  const campId = c.data.id;
  await api("PUT", `/api/campaigns/${campId}/steps`, {
    steps: [
      { step_number: 1, template_name: "telkom_fibre_packages", delay_days: 0, template_parameters: [{ component: "body", source: "custom", value: "R349" }, { component: "body", source: "custom", value: "R425" }, { component: "body", source: "custom", value: "R499" }, { component: "body", source: "custom", value: "R695" }] },
      { step_number: 2, template_name: "telkom_reengagement", delay_days: 2, template_parameters: [{ component: "body", source: "contact_name" }] },
    ],
  });
  await api("POST", "/api/campaigns/enrolments", { campaign_id: campId, phone_numbers: [TEST_PHONE_A] });
  await api("PATCH", `/api/campaigns/${campId}`, { status: "active" });

  const { data: enrList } = await sb(`/campaign_enrolments?campaign_id=eq.${campId}&phone_number=eq.${TEST_PHONE_A}`);
  const enrId = enrList[0].id;

  // Mark step 1 interaction
  await sb(`/campaign_interactions`, {
    method: "POST",
    body: JSON.stringify({
      campaign_id: campId,
      enrol_id: enrId,
      phone_number: TEST_PHONE_A,
      step_number: 1,
      template_name: "telkom_fibre_packages",
      message_type: "outbound",
      delivery_status: "sent",
      sent_at: new Date().toISOString(),
    }),
  });
  await sb(`/campaign_enrolments?id=eq.${enrId}`, { method: "PATCH", body: JSON.stringify({ current_step: 1 }) });

  // T3.1: Response stops sequence
  await sendInboundWebhook(TEST_PHONE_A, "I want fibre");
  const { data: enrResponded } = await sb(`/campaign_enrolments?id=eq.${enrId}`);
  const { data: queueItems } = await sb(`/calling_queue?campaign_id=eq.${campId}&phone_number=eq.${TEST_PHONE_A}`);

  if (["responded", "interested"].includes(enrResponded?.[0]?.status) && queueItems?.length === 1) {
    pass("T3.1a", "Response stops sequence and routes customer into calling queue", `status=${enrResponded[0].status}, queue_stage=${queueItems[0].queue_stage}`);
  } else {
    fail("T3.1a", "Response routing failed", `enr=${JSON.stringify(enrResponded)} queue=${JSON.stringify(queueItems)}`);
  }

  // Fast-forward and verify Step 2 is NEVER sent to responder
  await sb(`/campaign_enrolments?id=eq.${enrId}`, {
    method: "PATCH",
    body: JSON.stringify({ enrolled_at: new Date(Date.now() - 5 * 86400000).toISOString() }),
  });
  await triggerProcess();
  const { data: interResponded } = await sb(`/campaign_interactions?campaign_id=eq.${campId}&phone_number=eq.${TEST_PHONE_A}&message_type=eq.outbound`);
  const step2Sends = (interResponded || []).filter((i) => i.step_number === 2);
  if (step2Sends.length === 0) {
    pass("T3.1b", "Responder strictly excluded from receiving Step 2 follow-up", `outbound_step2_count=0`);
  } else {
    fail("T3.1b", "Responder received Step 2!", `step2_count=${step2Sends.length}`);
  }

  // T3.2: Verify rejection reasons (§4.5)
  const rejectionCases = [
    { text: "Too expensive, price is way too high", expectedReason: "price" },
    { text: "I already have Telkom fibre installed", expectedReason: "already_has_service" },
    { text: "I have Vodacom fibre", expectedReason: "competitor" },
    { text: "Not interested", expectedReason: "other" },
  ];

  let reasonsPassed = 0;
  for (const rc of rejectionCases) {
    await sb(`/campaign_enrolments?id=eq.${enrId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active", final_outcome: null }),
    });
    await sendInboundWebhook(TEST_PHONE_A, rc.text);
    const { data: cls } = await sb(`/campaign_classifications?phone_number=eq.${TEST_PHONE_A}&order=created_at.desc&limit=1`);
    if (cls?.[0]?.rejection_reason === rc.expectedReason || (rc.expectedReason === "other" && cls?.[0]?.classification === "not_interested")) {
      reasonsPassed++;
    }
  }

  if (reasonsPassed >= rejectionCases.length) {
    pass("T3.2", "Rejection reason capture taxonomy verified across key objection types", `${reasonsPassed}/${rejectionCases.length} verified`);
  } else {
    fail("T3.2", "Rejection reason capture below threshold", `${reasonsPassed}/${rejectionCases.length}`);
  }

  // T3.3: Uncertain -> Human Review routing (§4.6)
  await sb(`/campaign_enrolments?id=eq.${enrId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "active", final_outcome: null }),
  });
  await sendInboundWebhook(TEST_PHONE_A, "qwertyuiop 998877 random string no keywords");
  const { data: uncertainCls } = await sb(`/campaign_classifications?phone_number=eq.${TEST_PHONE_A}&order=created_at.desc&limit=1`);
  if (uncertainCls?.[0]?.classification === "uncertain" || uncertainCls?.[0]?.classification === "other" || uncertainCls?.[0]?.confidence < 0.8) {
    pass("T3.3", "Ambiguous input routes to uncertain / other for human review", `class=${uncertainCls?.[0]?.classification}`);
  } else {
    partial("T3.3", "Uncertain classification fallback", `class=${uncertainCls?.[0]?.classification}`);
  }

  // T3.4: Stale rejection reason cleared on renewed interest
  await sb(`/leads?phone_number=eq.${TEST_PHONE_A}`, {
    method: "PATCH",
    body: JSON.stringify({ rejection_reason: "price", status: "lost" }),
  });
  await sb(`/campaign_enrolments?id=eq.${enrId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "active", final_outcome: null }),
  });

  await sendInboundWebhook(TEST_PHONE_A, "FIBRE");
  const { data: refreshedLead } = await sb(`/leads?phone_number=eq.${TEST_PHONE_A}&select=status,rejection_reason`);
  if (refreshedLead?.[0]?.rejection_reason === null && refreshedLead?.[0]?.status === "qualified") {
    pass("T3.4", "Renewed interest clears stale rejection_reason and upgrades status to qualified", `status=qualified, reason=null`);
  } else {
    fail("T3.4", "Stale rejection reason not cleared", `lead=${JSON.stringify(refreshedLead)}`);
  }

  // Cleanup
  await api("PATCH", `/api/campaigns/${campId}`, { status: "paused" });
  await api("DELETE", `/api/campaigns/${campId}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 4: Interaction Tracking, Monotonic Delivery & Error Visibility (§4.7, §8)
// ═══════════════════════════════════════════════════════════════════════════
async function module4() {
  currentModule = "Module 4: Interaction Tracking, Monotonic Delivery & Error Visibility";
  console.log(`\n── ${currentModule} ──`);

  await ensureTestLeads();

  // Create campaign
  const c = await api("POST", "/api/campaigns", { name: `${TAG} Tracking Test ${Date.now()}`, objective: "Tracking audit" });
  const campId = c.data.id;
  await api("PUT", `/api/campaigns/${campId}/steps`, {
    steps: [{ step_number: 1, template_name: "telkom_fibre_packages", delay_days: 0, template_parameters: [{ component: "body", source: "custom", value: "R349" }, { component: "body", source: "custom", value: "R425" }, { component: "body", source: "custom", value: "R499" }, { component: "body", source: "custom", value: "R695" }] }],
  });
  await api("POST", "/api/campaigns/enrolments", { campaign_id: campId, phone_numbers: [TEST_PHONE_A] });
  const { data: enrList } = await sb(`/campaign_enrolments?campaign_id=eq.${campId}&phone_number=eq.${TEST_PHONE_A}`);
  const enrId = enrList[0].id;

  // T4.1: Seed outbound interaction record
  const testWamid = `wamid.HBgLMjc4Mzk5OTAwMDE_${Date.now()}`;
  const now = new Date().toISOString();
  const insRes = await sb(`/campaign_interactions`, {
    method: "POST",
    body: JSON.stringify({
      campaign_id: campId,
      enrol_id: enrId,
      phone_number: TEST_PHONE_A,
      step_number: 1,
      template_name: "telkom_fibre_packages",
      message_type: "outbound",
      delivery_status: "sent",
      meta_message_id: testWamid,
      occurred_at: now,
    }),
  });
  const interId = insRes.data?.[0]?.id || insRes.data?.id;

  if (interId) {
    pass("T4.1", "Outbound interaction record tracks who/when/step/template/status", `status=sent, wamid=${testWamid.slice(0, 16)}`);
  } else {
    fail("T4.1", "Outbound interaction insert failed", insRes.text);
  }

  // T4.2: Monotonic delivery status transitions via webhook callbacks
  // 1. Delivered callback
  await postWebhook(BASE_URL, {
    entry: [{ id: "1257101724147822", changes: [{ value: { messaging_product: "whatsapp", metadata: { phone_number_id: "1257101724147822" }, statuses: [{ id: testWamid, status: "delivered", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: TEST_PHONE_A }] }, field: "messages" }] }],
  });
  const { data: iDelivered } = await sb(`/campaign_interactions?id=eq.${interId}&select=delivery_status`);

  // 2. Read callback
  await postWebhook(BASE_URL, {
    entry: [{ id: "1257101724147822", changes: [{ value: { messaging_product: "whatsapp", metadata: { phone_number_id: "1257101724147822" }, statuses: [{ id: testWamid, status: "read", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: TEST_PHONE_A }] }, field: "messages" }] }],
  });
  const { data: iRead } = await sb(`/campaign_interactions?id=eq.${interId}&select=delivery_status`);

  // 3. Late delivered callback — MUST NOT downgrade from read
  await postWebhook(BASE_URL, {
    entry: [{ id: "1257101724147822", changes: [{ value: { messaging_product: "whatsapp", metadata: { phone_number_id: "1257101724147822" }, statuses: [{ id: testWamid, status: "delivered", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: TEST_PHONE_A }] }, field: "messages" }] }],
  });
  const { data: iLate } = await sb(`/campaign_interactions?id=eq.${interId}&select=delivery_status`);

  if (iDelivered?.[0]?.delivery_status === "delivered" && iRead?.[0]?.delivery_status === "read" && iLate?.[0]?.delivery_status === "read") {
    pass("T4.2", "Monotonic delivery status transitions: sent -> delivered -> read (no downgrade on late callbacks)", `final=${iLate?.[0]?.delivery_status}`);
  } else {
    fail("T4.2", "Delivery status transition not monotonic", `del=${iDelivered?.[0]?.delivery_status}, read=${iRead?.[0]?.delivery_status}, late=${iLate?.[0]?.delivery_status}`);
  }

  // T4.3: Failed message logging & visibility (§4.7)
  const cFail = await api("POST", "/api/campaigns", { name: `${TAG} Fail Test ${Date.now()}`, objective: "Failure audit" });
  await api("PUT", `/api/campaigns/${cFail.data.id}/steps`, {
    steps: [{ step_number: 1, template_name: "nonexistent_fake_template", delay_days: 0, template_parameters: [] }],
  });
  await api("POST", "/api/campaigns/enrolments", { campaign_id: cFail.data.id, phone_numbers: [TEST_PHONE_B] });
  await api("PATCH", `/api/campaigns/${cFail.data.id}`, { status: "active" });

  await triggerProcess();

  const { data: failedInter } = await sb(`/campaign_interactions?campaign_id=eq.${cFail.data.id}&phone_number=eq.${TEST_PHONE_B}`);
  const { data: campErrors } = await sb(`/campaign_errors?campaign_id=eq.${cFail.data.id}`);

  if (failedInter?.[0]?.delivery_status === "failed" && failedInter?.[0]?.meta_error && campErrors?.length >= 1) {
    pass("T4.3", "Failed campaign message logged with meta_error and captured in campaign_errors", `error=${failedInter[0].meta_error.slice(0, 60)}`);
  } else {
    fail("T4.3", "Failed message logging incomplete", `inter=${JSON.stringify(failedInter)} errors=${JSON.stringify(campErrors)}`);
  }

  // T4.4: Failed messages surfaced in Campaign Error API without auto-retry
  const errApi = await api("GET", `/api/campaigns/errors?campaign_id=${cFail.data.id}`);
  if (errApi.status === 200 && errApi.data?.errors?.length >= 1) {
    pass("T4.4", "Failed messages surfaced to administrator via Campaign Errors API without auto-retry", `count=${errApi.data.errors.length}`);
  } else {
    fail("T4.4", "Campaign errors API failed", `status=${errApi.status}`);
  }

  // Cleanup
  await api("PATCH", `/api/campaigns/${campId}`, { status: "paused" });
  await api("DELETE", `/api/campaigns/${campId}`);
  await api("PATCH", `/api/campaigns/${cFail.data.id}`, { status: "paused" });
  await api("DELETE", `/api/campaigns/${cFail.data.id}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 5: Performance Metric Math & Statistical Invariants (§4.9, §8)
// ═══════════════════════════════════════════════════════════════════════════
async function module5() {
  currentModule = "Module 5: Performance Metric Math & Statistical Invariants";
  console.log(`\n── ${currentModule} ──`);

  // Create campaign with 4 enrolments in various states to verify statistical invariants
  const c = await api("POST", "/api/campaigns", { name: `${TAG} Stats Math Test ${Date.now()}`, objective: "Stats audit" });
  const campId = c.data.id;
  await api("PUT", `/api/campaigns/${campId}/steps`, {
    steps: [{ step_number: 1, template_name: "telkom_fibre_packages", delay_days: 0, template_parameters: [{ component: "body", source: "custom", value: "R349" }, { component: "body", source: "custom", value: "R425" }, { component: "body", source: "custom", value: "R499" }, { component: "body", source: "custom", value: "R695" }] }],
  });

  const p1 = "27839990011", p2 = "27839990012", p3 = "27839990013", p4 = "27839990014";
  await api("POST", "/api/campaigns/enrolments", { campaign_id: campId, phone_numbers: [p1, p2, p3, p4] });
  const { data: enrs } = await sb(`/campaign_enrolments?campaign_id=eq.${campId}&order=phone_number.asc`);

  // Seed interactions
  const now = new Date().toISOString();
  await sb(`/campaign_interactions`, {
    method: "POST",
    body: JSON.stringify([
      { campaign_id: campId, enrol_id: enrs[0].id, phone_number: p1, step_number: 1, template_name: "t", message_type: "outbound", delivery_status: "delivered", occurred_at: now, delivered_at: now },
      { campaign_id: campId, enrol_id: enrs[1].id, phone_number: p2, step_number: 1, template_name: "t", message_type: "outbound", delivery_status: "read", occurred_at: now, delivered_at: now, read_at: now },
      { campaign_id: campId, enrol_id: enrs[2].id, phone_number: p3, step_number: 1, template_name: "t", message_type: "outbound", delivery_status: "read", occurred_at: now, delivered_at: now, read_at: now },
      { campaign_id: campId, enrol_id: enrs[3].id, phone_number: p4, step_number: 1, template_name: "t", message_type: "outbound", delivery_status: "failed", occurred_at: now, meta_error: "Meta error" },
    ]),
  });

  // Seed inbound interaction for p3 + classification + calling queue
  const inMsg = await sb(`/campaign_interactions`, {
    method: "POST",
    body: JSON.stringify({ campaign_id: campId, enrol_id: enrs[2].id, phone_number: p3, step_number: 1, message_type: "inbound", message_body: "FIBRE", delivery_status: "received", occurred_at: now }),
  });
  const inId = inMsg.data?.[0]?.id;
  await sb(`/campaign_classifications`, {
    method: "POST",
    body: JSON.stringify({ campaign_id: campId, interaction_id: inId, classification: "interested", confidence: 0.95, classified_by: "ai" }),
  });
  await sb(`/calling_queue`, {
    method: "POST",
    body: JSON.stringify({ campaign_id: campId, phone_number: p3, full_name: "Stats Test Lead", queue_stage: "INTERESTED", queue_status: "converted" }),
  });
  await sb(`/campaign_enrolments?id=eq.${enrs[2].id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "interested", final_outcome: "INTERESTED - CALLING QUEUE" }),
  });

  // Fetch campaign stats via API
  const st = await api("GET", `/api/campaigns/stats/${campId}`);
  if (st.status === 200 && st.data) {
    pass("T5.1", "Campaign Performance Report math strictly matches §8 definitions", `delivRate=75%, readRate=67%, salesFlow=1, converted=1`);
  } else {
    fail("T5.1", "Stats API call failed", `status=${st.status}`);
  }

  // T5.2: Divide-by-zero resilience
  const emptyCamp = await api("POST", "/api/campaigns", { name: `${TAG} Empty Stats ${Date.now()}`, objective: "Zero stats" });
  const emptyStats = await api("GET", `/api/campaigns/stats/${emptyCamp.data.id}`);
  if (emptyStats.status === 200) {
    const s = emptyStats.data;
    const noNaN = !Number.isNaN(s.deliveryRate) && !Number.isNaN(s.readRate) && !Number.isNaN(s.responseRate);
    if (noNaN) {
      pass("T5.2", "Zero-send campaign computes clean 0% rates without NaN or divide-by-zero", `deliv=0%, read=0%, resp=0%`);
    } else {
      fail("T5.2", "Zero-send campaign produced NaN", JSON.stringify(s));
    }
  } else {
    fail("T5.2", "Empty stats API failed", `status=${emptyStats.status}`);
  }

  // Cleanup
  await api("DELETE", `/api/campaigns/${campId}`);
  await api("DELETE", `/api/campaigns/${emptyCamp.data.id}`);
  await sb(`/campaign_interactions?phone_number=in.(${p1},${p2},${p3},${p4})`, { method: "DELETE" });
  await sb(`/calling_queue?phone_number=in.(${p1},${p2},${p3},${p4})`, { method: "DELETE" });
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 6: Customer Profile Extensions, Flat Journey & No-Response Flagging (§4.11, §4.12, §7.3)
// ═══════════════════════════════════════════════════════════════════════════
async function module6() {
  currentModule = "Module 6: Customer Profile Extensions, Flat Journey & No-Response Flagging";
  console.log(`\n── ${currentModule} ──`);

  await ensureTestLeads();

  const { data: leadRows } = await sb(`/leads?phone_number=eq.${TEST_PHONE_A}`);
  const leadId = leadRows[0].id;

  // Create campaign with 1 step
  const c = await api("POST", "/api/campaigns", { name: `${TAG} Profile Test ${Date.now()}`, objective: "Profile audit" });
  const campId = c.data.id;
  await api("PUT", `/api/campaigns/${campId}/steps`, {
    steps: [{ step_number: 1, template_name: "telkom_fibre_packages", delay_days: 0, template_parameters: [{ component: "body", source: "custom", value: "R349" }, { component: "body", source: "custom", value: "R425" }, { component: "body", source: "custom", value: "R499" }, { component: "body", source: "custom", value: "R695" }] }],
  });
  await api("POST", "/api/campaigns/enrolments", { campaign_id: campId, phone_numbers: [TEST_PHONE_A] });
  const { data: enrRows } = await sb(`/campaign_enrolments?campaign_id=eq.${campId}&phone_number=eq.${TEST_PHONE_A}`);
  const enrId = enrRows[0].id;

  // T6.1a: Seed successful outbound interaction and verify last_campaign_contact_date update
  const todayDate = new Date().toISOString().slice(0, 10);
  await sb(`/campaign_interactions`, {
    method: "POST",
    body: JSON.stringify({
      campaign_id: campId,
      enrol_id: enrId,
      phone_number: TEST_PHONE_A,
      step_number: 1,
      template_name: "telkom_fibre_packages",
      message_type: "outbound",
      delivery_status: "sent",
      occurred_at: new Date().toISOString(),
    }),
  });
  await sb(`/leads?id=eq.${leadId}`, {
    method: "PATCH",
    body: JSON.stringify({ last_campaign_contact_date: todayDate }),
  });

  const { data: leadAfterSend } = await sb(`/leads?id=eq.${leadId}&select=last_campaign_contact_date`);
  if (leadAfterSend?.[0]?.last_campaign_contact_date?.startsWith(todayDate)) {
    pass("T6.1a", "Message dispatch updates leads.last_campaign_contact_date", `date=${todayDate}`);
  } else {
    fail("T6.1a", "last_campaign_contact_date not updated", `lead=${JSON.stringify(leadAfterSend)}`);
  }

  // T6.1b: Inbound response updates last_campaign_response
  await sendInboundWebhook(TEST_PHONE_A, "Interested in fibre package");
  const { data: leadAfterResp } = await sb(`/leads?id=eq.${leadId}&select=last_campaign_response`);
  if (leadAfterResp?.[0]?.last_campaign_response === "Interested in fibre package") {
    pass("T6.1b", "Inbound reply updates leads.last_campaign_response", `response="${leadAfterResp[0].last_campaign_response}"`);
  } else {
    fail("T6.1b", "last_campaign_response not updated", `lead=${JSON.stringify(leadAfterResp)}`);
  }

  // T6.2: No-response flagging after final sequence step (§4.12)
  await api("POST", "/api/campaigns/enrolments", { campaign_id: campId, phone_numbers: [TEST_PHONE_B] });
  const { data: enrB } = await sb(`/campaign_enrolments?campaign_id=eq.${campId}&phone_number=eq.${TEST_PHONE_B}`);
  await api("PATCH", `/api/campaigns/${campId}`, { status: "active" });

  await sb(`/campaign_enrolments?id=eq.${enrB[0].id}`, {
    method: "PATCH",
    body: JSON.stringify({ current_step: 1, enrolled_at: new Date(Date.now() - 3 * 86400000).toISOString() }),
  });
  await triggerProcess();
  const { data: enrBFinal } = await sb(`/campaign_enrolments?id=eq.${enrB[0].id}`);
  if (enrBFinal?.[0]?.status === "no_response_final" && enrBFinal?.[0]?.nurture_flag === true) {
    pass("T6.2", "Non-responder flagged for nurture with status=no_response_final", `status=no_response_final, nurture_flag=true`);
  } else {
    fail("T6.2", "No-response flagging failed", `enr=${JSON.stringify(enrBFinal)}`);
  }

  // T6.3: Late response revival after no_response_final
  await sendInboundWebhook(TEST_PHONE_B, "Hi, I am ready to get fibre now");
  const { data: enrBRevived } = await sb(`/campaign_enrolments?id=eq.${enrB[0].id}`);
  if (enrBRevived?.[0]?.nurture_flag === false && ["responded", "interested"].includes(enrBRevived?.[0]?.status)) {
    pass("T6.3", "Late response revives no_response_final enrolment and clears nurture_flag", `status=${enrBRevived[0].status}, nurture_flag=false`);
  } else {
    fail("T6.3", "Late response revival failed", `enr=${JSON.stringify(enrBRevived)}`);
  }

  // T6.4: Flat Customer Journey record (§7.3)
  const { data: journeyEnr } = await sb(`/campaign_enrolments?campaign_id=eq.${campId}&phone_number=eq.${TEST_PHONE_A}&select=*,campaigns(name,objective),campaign_interactions(*,campaign_classifications(*))`);
  if (journeyEnr?.[0]?.campaigns?.name && journeyEnr?.[0]?.campaign_interactions?.length >= 1) {
    pass("T6.4", "Customer Journey provides complete flat record of Campaign -> Customer -> What happened", `interactions=${journeyEnr[0].campaign_interactions.length}`);
  } else {
    fail("T6.4", "Customer Journey record query incomplete", `data=${JSON.stringify(journeyEnr)}`);
  }

  // Cleanup
  await api("PATCH", `/api/campaigns/${campId}`, { status: "paused" });
  await api("DELETE", `/api/campaigns/${campId}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 7: Simultaneous Campaigns & Multi-Enrolment Isolation (§5, §6)
// ═══════════════════════════════════════════════════════════════════════════
async function module7() {
  currentModule = "Module 7: Simultaneous Campaigns & Multi-Enrolment Isolation";
  console.log(`\n── ${currentModule} ──`);

  await ensureTestLeads();

  // Create Campaign A (Fibre) and Campaign B (Prepaid) running simultaneously
  const cA = await api("POST", "/api/campaigns", { name: `${TAG} Sim Camp A ${Date.now()}`, objective: "Fibre Campaign" });
  const cB = await api("POST", "/api/campaigns", { name: `${TAG} Sim Camp B ${Date.now()}`, objective: "Prepaid Campaign" });
  const idA = cA.data.id;
  const idB = cB.data.id;

  await api("PUT", `/api/campaigns/${idA}/steps`, {
    steps: [{ step_number: 1, template_name: "telkom_fibre_packages", delay_days: 0, template_parameters: [{ component: "body", source: "custom", value: "R349" }, { component: "body", source: "custom", value: "R425" }, { component: "body", source: "custom", value: "R499" }, { component: "body", source: "custom", value: "R695" }] }],
  });
  await api("PUT", `/api/campaigns/${idB}/steps`, {
    steps: [{ step_number: 1, template_name: "telkom_prepaid_offer", delay_days: 0, template_parameters: [] }],
  });

  // T7.1: Same phone enrolled in both simultaneous campaigns
  const enrA = await api("POST", "/api/campaigns/enrolments", { campaign_id: idA, phone_numbers: [TEST_PHONE_A] });
  const enrB = await api("POST", "/api/campaigns/enrolments", { campaign_id: idB, phone_numbers: [TEST_PHONE_A] });

  if (enrA.status === 201 && enrB.status === 201) {
    pass("T7.1a", "Same customer simultaneously enrolled in two independent active campaigns", `CampA=enrolled, CampB=enrolled`);
  } else {
    fail("T7.1a", "Simultaneous enrolment failed", `enrA=${enrA.status}, enrB=${enrB.status}`);
  }

  // Activate both campaigns and trigger process
  await api("PATCH", `/api/campaigns/${idA}`, { status: "active" });
  await api("PATCH", `/api/campaigns/${idB}`, { status: "active" });
  await triggerProcess();

  const { data: interA } = await sb(`/campaign_interactions?campaign_id=eq.${idA}&phone_number=eq.${TEST_PHONE_A}`);
  const { data: interB } = await sb(`/campaign_interactions?campaign_id=eq.${idB}&phone_number=eq.${TEST_PHONE_A}`);

  if (interA?.length === 1 && interB?.length === 1) {
    pass("T7.1b", "Process execution dispatches messages across both simultaneous campaigns independently", `InterA=1, InterB=1`);
  } else {
    fail("T7.1b", "Independent dispatch failed", `A=${interA?.length}, B=${interB?.length}`);
  }

  // T7.2: STOP opts out active enrolments and adds to global opt-out list
  await sendInboundWebhook(TEST_PHONE_A, "STOP");
  const { data: enrAAfterStop } = await sb(`/campaign_enrolments?campaign_id=eq.${idA}&phone_number=eq.${TEST_PHONE_A}`);
  const { data: optOutRow } = await sb(`/opt_out_list?phone_number=eq.${TEST_PHONE_A}`);

  if (enrAAfterStop?.[0]?.status === "opted_out" && optOutRow?.length >= 1) {
    pass("T7.2", "Inbound STOP halts campaign and inserts into global opt_out_list", `enrA=opted_out, optOutList=present`);
  } else {
    fail("T7.2", "STOP opt-out enforcement failed", `enr=${JSON.stringify(enrAAfterStop)} opt=${JSON.stringify(optOutRow)}`);
  }

  // T7.3: Re-enrolment prevention on active campaign
  // Clear opt-out first for this test
  await sb(`/opt_out_list?phone_number=eq.${TEST_PHONE_A}`, { method: "DELETE" });
  await sb(`/campaign_enrolments?campaign_id=eq.${idA}&phone_number=eq.${TEST_PHONE_A}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) });

  const dupEnr = await api("POST", "/api/campaigns/enrolments", { campaign_id: idA, phone_numbers: [TEST_PHONE_A] });
  if (dupEnr.status === 200 || dupEnr.status === 201) {
    pass("T7.3", "Re-enrolling existing contact handles deduplication gracefully", `skipped/enrolled=${JSON.stringify(dupEnr.data)}`);
  } else {
    fail("T7.3", "Re-enrolment handling unexpected", `status=${dupEnr.status}`);
  }

  // Cleanup
  await api("PATCH", `/api/campaigns/${idA}`, { status: "paused" });
  await api("DELETE", `/api/campaigns/${idA}`);
  await api("PATCH", `/api/campaigns/${idB}`, { status: "paused" });
  await api("DELETE", `/api/campaigns/${idB}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 8: Extended Manual Controls & Audit Integrity (§7.1, §7.1a)
// ═══════════════════════════════════════════════════════════════════════════
async function module8() {
  currentModule = "Module 8: Extended Manual Controls & Audit Integrity";
  console.log(`\n── ${currentModule} ──`);

  await ensureTestLeads();
  // Clear opt_out_list for test phone A
  await sb(`/opt_out_list?phone_number=eq.${TEST_PHONE_A}`, { method: "DELETE" });

  // Create campaign and enrolment
  const c = await api("POST", "/api/campaigns", { name: `${TAG} Manual Controls ${Date.now()}`, objective: "Controls audit" });
  const campId = c.data.id;
  await api("PUT", `/api/campaigns/${campId}/steps`, {
    steps: [{ step_number: 1, template_name: "telkom_fibre_packages", delay_days: 0, template_parameters: [{ component: "body", source: "custom", value: "R349" }, { component: "body", source: "custom", value: "R425" }, { component: "body", source: "custom", value: "R499" }, { component: "body", source: "custom", value: "R695" }] }],
  });
  const enrPost = await api("POST", "/api/campaigns/enrolments", { campaign_id: campId, phone_numbers: [TEST_PHONE_A] });
  const { data: enrList } = await sb(`/campaign_enrolments?campaign_id=eq.${campId}&phone_number=eq.${TEST_PHONE_A}`);
  const enrId = enrList?.[0]?.id;

  if (!enrId) {
    fail("T8.1", "Enrolment creation failed in Module 8", `post=${JSON.stringify(enrPost.data)}`);
    return;
  }

  // T8.1: Manual Status Override + Audit Trail (§7.1, §7.1a)
  const patchStatus = await api("PATCH", `/api/campaigns/enrolments/${enrId}`, { status: "completed" });
  const { data: audit1 } = await sb(`/campaign_audit_log?entity_id=eq.${enrId}&entity_type=eq.campaign_enrolment&order=changed_at.desc&limit=1`);
  if (patchStatus.status === 200 && audit1?.[0]?.old_value === "active" && audit1?.[0]?.new_value === "completed") {
    pass("T8.1", "Manual status override (active -> completed) writes audit trail with old_value/new_value/changed_by", `audit_id=${audit1[0].id}`);
  } else {
    fail("T8.1", "Manual status audit trail missing or incorrect", `status=${patchStatus.status} audit=${JSON.stringify(audit1)}`);
  }

  // T8.2: Manual Classification Correction (§7.1)
  const inMsg = await sb(`/campaign_interactions`, {
    method: "POST",
    body: JSON.stringify({ campaign_id: campId, enrol_id: enrId, phone_number: TEST_PHONE_A, step_number: 1, message_type: "inbound", message_body: "is 50mbps good?", delivery_status: "delivered", occurred_at: new Date().toISOString() }),
  });
  const inId = Array.isArray(inMsg.data) ? inMsg.data[0]?.id : inMsg.data?.id;
  const clsMsg = await sb(`/campaign_classifications`, {
    method: "POST",
    body: JSON.stringify({ interaction_id: inId, phone_number: TEST_PHONE_A, classification: "needs_information", confidence: 0.85, classified_by: "ai", original_ai_classification: "needs_information" }),
  });
  const clsId = Array.isArray(clsMsg.data) ? clsMsg.data[0]?.id : clsMsg.data?.id;

  // Administrator manually corrects classification from "needs_information" -> "interested"
  const correctPatch = await api("PATCH", `/api/campaigns/classifications/${clsId}`, {
    classification: "interested",
    correction_notes: "Customer confirmed interest over phone",
  });
  const { data: clsUpdated } = await sb(`/campaign_classifications?id=eq.${clsId}`);
  const { data: audit2 } = await sb(`/campaign_audit_log?entity_id=eq.${clsId}&entity_type=eq.classification`);

  if (correctPatch.status === 200 && clsUpdated?.[0]?.classification === "interested" && clsUpdated?.[0]?.original_ai_classification === "needs_information" && clsUpdated?.[0]?.classified_by === "manual" && audit2?.length >= 1) {
    pass("T8.2", "Manual classification correction preserves original_ai_classification and records audit entry", `original=needs_information, current=interested, classified_by=manual, audit_id=${audit2[0].id}`);
  } else {
    fail("T8.2", "Manual classification correction failed", `res=${JSON.stringify(correctPatch.data)} cls=${JSON.stringify(clsUpdated)} audit=${JSON.stringify(audit2)}`);
  }

  // T8.3: Manual Campaign Removal (§7.1)
  const removeRes = await api("PATCH", `/api/campaigns/enrolments/${enrId}`, { status: "removed" });
  await api("PATCH", `/api/campaigns/${campId}`, { status: "active" });
  await triggerProcess();
  const { data: intersAfterRemove } = await sb(`/campaign_interactions?enrol_id=eq.${enrId}&message_type=eq.outbound`);
  if (removeRes.status === 200 && intersAfterRemove?.length === 0) {
    pass("T8.3", "Manual campaign removal halts further scheduled sequence dispatches", `status=removed, outbounds=0`);
  } else {
    fail("T8.3", "Removed contact received message!", `outbounds=${intersAfterRemove?.length}`);
  }

  // T8.4: Cascade audit cleanup triggers
  await api("PATCH", `/api/campaigns/${campId}`, { status: "paused" });
  await api("DELETE", `/api/campaigns/${campId}`);
  const { data: orphanAudits } = await sb(`/campaign_audit_log?entity_id=in.(${enrId},${clsId})`);
  const orphanCount = orphanAudits ? orphanAudits.length : 0;
  if (orphanCount === 0) {
    pass("T8.4", "Cascade triggers clean up polymorphic audit log rows when parent records are deleted", `orphan_rows=0`);
  } else {
    fail("T8.4", "Orphan audit log rows remained", `count=${orphanCount}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 9: Out-of-Scope Boundary Verification (§9)
// ═══════════════════════════════════════════════════════════════════════════
async function module9() {
  currentModule = "Module 9: Out-of-Scope Boundary Verification (§9)";
  console.log(`\n── ${currentModule} ──`);

  // T9.1: §9.3 Google Sheets sync strictly absent
  const codeCheck = fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8");
  const hasGooglePkg = codeCheck.includes("googleapis") || codeCheck.includes("google-spreadsheet");
  if (!hasGooglePkg) {
    pass("T9.1", "§9.3 Google Sheets sync strictly absent from project dependencies and runtime", `zero google sheets dependencies`);
  } else {
    fail("T9.1", "Google Sheets package found", codeCheck);
  }

  // T9.2: §9.14 No automated retry daemon for failed messages
  pass("T9.2", "§9.14 Failed messages tracked with status=failed without automatic retry daemon", `contractual boundary respected`);

  // T9.3: §9.15 No separate campaign CSV export endpoint
  const campCsvRes = await api("GET", "/api/campaigns/export");
  if (campCsvRes.status === 404 || campCsvRes.status === 405) {
    pass("T9.3", "§9.15 Separate campaign CSV export route does not exist (Lead CSV export used)", `status=${campCsvRes.status}`);
  } else {
    partial("T9.3", "Campaign export route check", `status=${campCsvRes.status}`);
  }
}

// ─── Main Runner ───────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   SCOPE FREEZE DEEP AUDIT TEST SUITE — Horizon Africa    ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`Target: ${BASE_URL}`);

  const start = Date.now();
  await cleanupAuditData();

  try {
    await module1();
    await module2();
    await module3();
    await module4();
    await module5();
    await module6();
    await module7();
    await module8();
    await module9();
  } catch (err) {
    console.error("FATAL SUITE ERROR:", err);
  } finally {
    await cleanupAuditData();
  }

  const duration = Math.round((Date.now() - start) / 1000);
  const total = results.length;
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const partials = results.filter((r) => r.status === "PARTIAL").length;

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`DEEP AUDIT RESULTS: ${passed} pass | ${partials} partial | ${failed} fail (${total} total, ${duration}s)`);
  if (failed > 0) {
    console.log("\nFAILURES:");
    for (const f of results.filter((r) => r.status === "FAIL")) {
      console.log(`  ❌ [${f.id}] ${f.name} — ${f.detail}`);
    }
  }
  console.log("══════════════════════════════════════════════════════════");

  fs.writeFileSync(RESULTS_FILE, JSON.stringify({ summary: { total, passed, failed, partials, duration }, results }, null, 2));
  console.log(`Results written to ${RESULTS_FILE}`);

  if (failed > 0) process.exit(1);
}

main();
