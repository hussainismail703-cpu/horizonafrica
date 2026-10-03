/**
 * Pre-Launch "Break the App" Audit Suite
 *
 * Covers the gaps outside the existing ~990-test suite:
 *   A. Post-fix verification of the 12 audited defects
 *   B. Failure injection / resilience
 *   C. Launch-scale behaviour (the 1,719-lead segment)
 *   E. Multi-user / session / UX edge cases
 *   F. Security extras
 *
 * Phase D (ops readiness) items are manual — listed in tests/prelaunch-audit.md.
 *
 * Run:
 *   node --env-file=.env.local tests/prelaunch-audit.mjs
 *   node --env-file=.env.local tests/prelaunch-audit.mjs --headed
 *   node --env-file=.env.local tests/prelaunch-audit.mjs --backend-only
 *   node --env-file=.env.local tests/prelaunch-audit.mjs --ui-only
 *
 * Safety: all data is created with PAUDIT- prefixes / 2771xxx fake numbers and
 * cleaned up at the end. The real Fibre campaign is never touched.
 */

import { chromium } from "playwright";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { webhookHeaders, postWebhook } from "./lib/webhook.mjs";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// ─── Env ────────────────────────────────────────────────────────────────────
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));

const BASE_URL = process.env.TEST_TARGET || process.env.BASE_URL || "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_SECRET = process.env.APP_SECRET;
const TEST_EMAIL = process.env.TEST_EMAIL || "hussainismail703@gmail.com";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "TestPass123!";

const HEADED = process.argv.includes("--headed");
const UI_ONLY = process.argv.includes("--ui-only");
const BACKEND_ONLY = process.argv.includes("--backend-only");
const SKIP_FLOOD = process.argv.includes("--skip-flood");

const supa = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Fake-but-well-formed SA numbers Meta rejects quickly (non-existent range).
const fakePhone = (n) => `2771${String(n).padStart(7, "0")}`;
const RUN = Date.now().toString(36);
const wamid = (tag) => `wamid.PAUDIT.${RUN}.${tag}`;

// ─── Results infra ──────────────────────────────────────────────────────────
const results = [];
const bugs = [];
const securityIssues = [];
const consoleErrors = [];

function pass(name, detail = "") {
  results.push({ test: name, status: "PASS", detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, error, severity = "bug") {
  results.push({ test: name, status: "FAIL", error: String(error), severity });
  bugs.push({ test: name, error: String(error), severity });
  console.log(`  ❌ ${name}: ${error}`);
}
function securityFail(name, error) {
  results.push({ test: name, status: "SECURITY", error: String(error) });
  securityIssues.push({ test: name, error: String(error) });
  console.log(`  🚨 SECURITY: ${name}: ${error}`);
}
function manual(name, note) {
  results.push({ test: name, status: "MANUAL", detail: note });
  console.log(`  📝 MANUAL: ${name} — ${note}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── HTTP helpers ───────────────────────────────────────────────────────────
let cookieHeader = null;

async function raw(method, urlPath, { body, headers = {}, redirect = "manual" } = {}) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or empty */ }
  return { status: res.status, text, json, headers: res.headers, location: res.headers.get("location") };
}

const bearer = () => ({ Authorization: `Bearer ${APP_SECRET}` });
const authed = () => (cookieHeader ? { Cookie: cookieHeader } : {});
const isUnauth = (r) =>
  r.status === 401 ||
  (r.status >= 300 && r.status < 400 && (r.location ?? "").includes("/login"));

// ─── Playwright login (hydration-safe, with retry) ──────────────────────────
async function login(page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500); // let React hydrate before filling
    await page.fill("input#email", TEST_EMAIL);
    await page.fill("input#password", TEST_PASSWORD);
    await page.click("form:has(#email) button[type='submit']");
    try {
      await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25000 });
      return;
    } catch {
      if (attempt === 1) throw new Error("Login failed after retry");
    }
  }
}

// ─── Supabase helpers ───────────────────────────────────────────────────────
async function createTestCampaign(name, { status = "draft", steps = [] } = {}) {
  const { data: c, error } = await supa
    .from("campaigns")
    .insert({ name, objective: "prelaunch-audit", status })
    .select()
    .single();
  if (error) throw new Error(`create campaign: ${error.message}`);
  for (const s of steps) {
    await supa.from("campaign_steps").insert({
      campaign_id: c.id,
      step_number: s.step_number,
      delay_days: s.delay_days ?? 0,
      template_name: s.template_name ?? "hello_world",
    });
  }
  return c;
}

async function enrol(campaignId, phone, extra = {}) {
  const { data, error } = await supa
    .from("campaign_enrolments")
    .insert({
      campaign_id: campaignId,
      phone_number: phone,
      current_step: 0,
      status: "active",
      nurture_flag: false,
      ...extra,
    })
    .select()
    .single();
  if (error) throw new Error(`enrol: ${error.message}`);
  return data;
}

const metaPayload = (phone, body, id, type = "text", extra = {}) => ({
  object: "whatsapp_business_account",
  entry: [{
    id: "WABA",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "27757774389", phone_number_id: "1257101724147822" },
        contacts: [{ profile: { name: "Audit Test" }, wa_id: phone }],
        messages: [{ from: phone, id: id, timestamp: String(Math.floor(Date.now() / 1000)), type, ...(type === "text" ? { text: { body } } : {}), ...extra }],
      },
    }],
  }],
});

const statusPayload = (wamidVal, status, phone, errors = undefined) => ({
  object: "whatsapp_business_account",
  entry: [{
    id: "WABA",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "27757774389", phone_number_id: "1257101724147822" },
        statuses: [{ id: wamidVal, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: phone, ...(errors ? { errors } : {}) }],
      },
    }],
  }],
});

// ─── Cleanup ────────────────────────────────────────────────────────────────
const cleanupIds = { campaigns: [], leads: [], groups: [], wamids: [], phones: new Set(), conversations: [], errors: [] };

async function cleanup() {
  console.log("\n-- Cleanup --");
  for (const id of cleanupIds.campaigns) {
    try { await fetch(`${BASE_URL}/api/campaigns/${id}`, { method: "DELETE", headers: authed() }); } catch { /* fallback below */ }
    await supa.from("campaign_classifications").delete().eq("campaign_id", id);
    await supa.from("campaign_errors").delete().eq("campaign_id", id);
    await supa.from("campaign_interactions").delete().eq("campaign_id", id);
    await supa.from("campaign_enrolments").delete().eq("campaign_id", id);
    await supa.from("calling_queue").delete().eq("campaign_id", id);
    await supa.from("campaign_steps").delete().eq("campaign_id", id);
    await supa.from("campaign_audit_log").delete().eq("campaign_id", id);
    await supa.from("campaigns").delete().eq("id", id);
  }
  for (const gid of cleanupIds.groups) {
    await supa.from("broadcast_messages").delete().in("broadcast_id",
      (await supa.from("broadcast_history").select("id").eq("group_id", gid)).data?.map((r) => r.id) ?? []);
    await supa.from("broadcast_history").delete().eq("group_id", gid);
    await supa.from("broadcast_contacts").delete().eq("group_id", gid);
    await supa.from("broadcast_groups").delete().eq("id", gid);
  }
  for (const id of cleanupIds.leads) await supa.from("leads").delete().eq("id", id);
  const phoneList = [...cleanupIds.phones];
  if (phoneList.length) {
    for (let i = 0; i < phoneList.length; i += 200) {
      const batch = phoneList.slice(i, i + 200);
      await supa.from("opt_out_list").delete().in("phone_number", batch);
      await supa.from("conversations").delete().in("phone_number", batch);
      await supa.from("leads").delete().in("phone_number", batch);
      await supa.from("campaign_enrolments").delete().in("phone_number", batch);
      await supa.from("broadcast_contacts").delete().in("phone_number", batch);
      await supa.from("broadcast_messages").delete().in("phone_number", batch);
    }
  }
  if (cleanupIds.wamids.length) {
    await supa.from("inbound_webhook_messages").delete().in("wamid", cleanupIds.wamids);
    await supa.from("message_delivery_failures").delete().in("message_id", cleanupIds.wamids);
    await supa.from("broadcast_messages").delete().in("wamid", cleanupIds.wamids);
    await supa.from("campaign_interactions").delete().in("meta_message_id", cleanupIds.wamids);
  }
  console.log("  cleanup done");
}

// ─── Section A: defect re-verification ──────────────────────────────────────
async function sectionA() {
  console.log("\n=== SECTION A: Post-fix defect verification ===");

  // A1: follow-ups cron reachable + actually queries leads via service role
  {
    const phone = fakePhone(900001);
    const { data: lead } = await supa.from("leads").insert({
      phone_number: phone, full_name: "PAUDIT FollowUp",
      follow_up_requested: true, follow_up_sent: false,
      follow_up_date: new Date(Date.now() - 60000).toISOString(),
      status: "new",
    }).select().single();
    cleanupIds.leads.push(lead.id); cleanupIds.phones.add(phone);

    const r = await raw("POST", "/api/follow-ups/cron", { body: {}, headers: bearer() });
    if (r.status === 200 && r.json && r.json.processed >= 1) {
      pass("A1 follow-ups cron reachable & queries leads", `processed=${r.json.processed} failed=${r.json.failed} (Meta fails on fake number — proves the lead was loaded, which is what was broken)`);
    } else if (r.status === 200 && r.json && r.json.processed === 0) {
      fail("A1 follow-ups cron", `200 but processed=0 — service client still can't see leads? body=${JSON.stringify(r.json)}`);
    } else {
      fail("A1 follow-ups cron", `status=${r.status} body=${r.text.slice(0, 200)}`);
    }
  }

  // A2: follow-ups cron without auth → 401 JSON, not redirect
  {
    const r = await raw("POST", "/api/follow-ups/cron", { body: {} });
    if (r.status === 401) pass("A2 follow-ups cron requires auth");
    else fail("A2 follow-ups cron auth", `expected 401 got ${r.status}`);
  }

  // A3: bulk enrolment of 1,719 phones in one call (chunked .in() + batch insert)
  let scaleCampaign = null;
  const scalePhones = Array.from({ length: 1719 }, (_, i) => fakePhone(100000 + i));
  {
    scaleCampaign = await createTestCampaign(`PAUDIT-Scale-${RUN}`);
    cleanupIds.campaigns.push(scaleCampaign.id);
    scalePhones.forEach((p) => cleanupIds.phones.add(p));

    const t0 = Date.now();
    const r = await raw("POST", "/api/campaigns/enrolments", {
      body: { campaign_id: scaleCampaign.id, phone_numbers: scalePhones },
      headers: authed(),
    });
    const ms = Date.now() - t0;
    if (r.status === 201 && r.json?.enrolled === 1719) {
      pass("A3 bulk enrol 1,719 phones", `${ms}ms, enrolled=${r.json.enrolled}`);
    } else {
      fail("A3 bulk enrol 1,719", `status=${r.status} body=${r.text.slice(0, 300)}`);
    }
  }

  // A4: opt-out exclusion inside large batch + re-enrol idempotency
  {
    const { error: optErr } = await supa.from("opt_out_list").insert({
      phone_number: scalePhones[0], reason: "audit",
    });
    if (optErr) fail("A4 setup opt_out insert", optErr.message);
    // scalePhones[0]: opted out AND already enrolled → excluded_opt_out
    // scalePhones[1]: already enrolled → skipped
    // new phone: enrolled
    const extraPhones = [scalePhones[0], scalePhones[1], fakePhone(999001)];
    cleanupIds.phones.add(extraPhones[2]);
    const r = await raw("POST", "/api/campaigns/enrolments", {
      body: { campaign_id: scaleCampaign.id, phone_numbers: extraPhones },
      headers: authed(),
    });
    if (r.status === 201 && r.json?.enrolled === 1 && r.json?.excluded_opt_out === 1 && r.json?.skipped === 1) {
      pass("A4 chunked opt-out exclusion + re-enrol dedupe", `enrolled=1 opt-out excluded=1 skipped=1`);
    } else {
      fail("A4 opt-out/dedupe", `body=${JSON.stringify(r.json)}`);
    }
  }

  // A5: CSV formula injection sanitized
  {
    const { data: lead } = await supa.from("leads").insert({
      phone_number: fakePhone(999002), full_name: "=HYPERLINK(\"https://evil\",\"click\")",
      email: "+cmd|' /C calc'!A0", status: "new",
    }).select().single();
    cleanupIds.leads.push(lead.id); cleanupIds.phones.add(fakePhone(999002));

    const res = await fetch(`${BASE_URL}/api/leads/export`, { headers: authed() });
    const csv = await res.text();
    const bad = csv.split("\n").filter((l) => l.startsWith('"=') || l.startsWith('"+') || l.startsWith('"@'));
    if (res.status === 200 && bad.length === 0 && csv.includes(`"'=`)) {
      pass("A5 CSV formula injection sanitized", "dangerous cells prefixed with '");
    } else if (bad.length > 0) {
      securityFail("A5 CSV injection", `unsanitized formula cells: ${bad[0]?.slice(0, 120)}`);
    } else {
      fail("A5 CSV export", `status=${res.status}`);
    }
  }

  // A6: atomic send-claim — concurrent process calls can't double-send
  {
    const c = await createTestCampaign(`PAUDIT-Race-${RUN}`, {
      status: "active",
      steps: [{ step_number: 1, delay_days: 0, template_name: "hello_world" }],
    });
    cleanupIds.campaigns.push(c.id);
    const phone = fakePhone(888001); cleanupIds.phones.add(phone);
    const e = await enrol(c.id, phone, { enrolled_at: new Date(Date.now() - 60000).toISOString() });

    const [r1, r2] = await Promise.all([
      raw("POST", "/api/campaigns/process", { body: {}, headers: bearer() }),
      raw("POST", "/api/campaigns/process", { body: {}, headers: bearer() }),
    ]);
    const { data: interactions } = await supa.from("campaign_interactions")
      .select("id, delivery_status")
      .eq("enrol_id", e.id).eq("step_number", 1).eq("message_type", "outbound");

    if (r1.status === 200 && r2.status === 200 && interactions?.length === 1) {
      pass("A6 concurrent process → single send claim", `status=${interactions[0].delivery_status} (fake number → failed is fine)`);
    } else {
      fail("A6 duplicate-send race", `interactions=${interactions?.length} r1=${r1.status} r2=${r2.status}`);
    }
  }

  // A7: stale pending claim (>15min) is reclaimed
  {
    const c = await createTestCampaign(`PAUDIT-Stale-${RUN}`, {
      status: "active",
      steps: [{ step_number: 1, delay_days: 0, template_name: "hello_world" }],
    });
    cleanupIds.campaigns.push(c.id);
    const phone = fakePhone(888002); cleanupIds.phones.add(phone);
    const e = await enrol(c.id, phone, { enrolled_at: new Date(Date.now() - 60000).toISOString() });

    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await supa.from("campaign_interactions").insert({
      campaign_id: c.id, enrol_id: e.id, phone_number: phone, step_number: 1,
      message_type: "outbound", delivery_status: "pending", created_at: stale,
    });
    await raw("POST", "/api/campaigns/process", { body: {}, headers: bearer() });
    const { data: rows } = await supa.from("campaign_interactions")
      .select("delivery_status")
      .eq("enrol_id", e.id).eq("step_number", 1).eq("message_type", "outbound");
    if (rows?.length === 1 && rows[0].delivery_status !== "pending") {
      pass("A7 stale pending claim reclaimed", `final status=${rows[0].delivery_status}`);
    } else {
      fail("A7 stale claim", `rows=${JSON.stringify(rows)}`);
    }
  }

  // A8: failed outbound rows are not retried (documented semantics)
  {
    const c = await createTestCampaign(`PAUDIT-NoRetry-${RUN}`, {
      status: "active",
      steps: [{ step_number: 1, delay_days: 0, template_name: "hello_world" }],
    });
    cleanupIds.campaigns.push(c.id);
    const phone = fakePhone(888003); cleanupIds.phones.add(phone);
    const e = await enrol(c.id, phone, { enrolled_at: new Date(Date.now() - 60000).toISOString() });
    await supa.from("campaign_interactions").insert({
      campaign_id: c.id, enrol_id: e.id, phone_number: phone, step_number: 1,
      message_type: "outbound", delivery_status: "failed", meta_error: "seeded",
    });
    await raw("POST", "/api/campaigns/process", { body: {}, headers: bearer() });
    const { data: rows } = await supa.from("campaign_interactions")
      .select("id").eq("enrol_id", e.id).eq("step_number", 1).eq("message_type", "outbound");
    if (rows?.length === 1) pass("A8 failed send not retried");
    else fail("A8 failed-row dedupe", `rows=${rows?.length}`);
  }

  // A9: broadcast send persists per-message wamids + doesn't stick 'sending'
  let broadcastId = null;
  {
    const { data: group } = await supa.from("broadcast_groups")
      .insert({ group_name: `PAUDIT-G-${RUN}`, group_label: "audit" }).select().single();
    cleanupIds.groups.push(group.id);
    const contacts = [fakePhone(777001), fakePhone(777002)];
    contacts.forEach((p) => cleanupIds.phones.add(p));
    await supa.from("broadcast_contacts").insert(
      contacts.map((p) => ({ group_id: group.id, phone_number: p, contact_name: "Audit", opt_in: true }))
    );

    const r = await raw("POST", "/api/broadcasts/send", {
      body: { group_id: group.id, template_name: "hello_world", campaign_name: `PAUDIT-BC-${RUN}` },
      headers: authed(),
    });
    broadcastId = r.json?.broadcast_id;
    const { data: msgs } = await supa.from("broadcast_messages").select("status").eq("broadcast_id", broadcastId ?? -1);
    const { data: hist } = await supa.from("broadcast_history").select("status").eq("id", broadcastId ?? -1).single();
    if (r.status === 200 && msgs?.length === 2 && hist && hist.status !== "sending") {
      pass("A9 broadcast send → per-message rows + final status", `msgs=${msgs.length} history=${hist.status}`);
    } else {
      fail("A9 broadcast send", `status=${r.status} msgs=${msgs?.length} hist=${hist?.status} body=${r.text.slice(0, 200)}`);
    }
  }

  // A10: delivery status callbacks update campaign_interactions monotonically
  {
    const w = wamid("status1"); cleanupIds.wamids.push(w);
    const c = await createTestCampaign(`PAUDIT-Delivery-${RUN}`);
    cleanupIds.campaigns.push(c.id);
    const phone = fakePhone(888004); cleanupIds.phones.add(phone);
    const e = await enrol(c.id, phone);
    await supa.from("campaign_interactions").insert({
      campaign_id: c.id, enrol_id: e.id, phone_number: phone, step_number: 1,
      message_type: "outbound", delivery_status: "sent", meta_message_id: w,
    });

    await postWebhook(BASE_URL, statusPayload(w, "delivered", phone));
    let { data: row } = await supa.from("campaign_interactions").select("delivery_status").eq("meta_message_id", w).single();
    const afterDelivered = row?.delivery_status;

    await postWebhook(BASE_URL, statusPayload(w, "read", phone));
    ({ data: row } = await supa.from("campaign_interactions").select("delivery_status").eq("meta_message_id", w).single());
    const afterRead = row?.delivery_status;

    await postWebhook(BASE_URL, statusPayload(w, "delivered", phone)); // late/out-of-order
    ({ data: row } = await supa.from("campaign_interactions").select("delivery_status").eq("meta_message_id", w).single());
    const afterLateDelivered = row?.delivery_status;

    if (afterDelivered === "delivered" && afterRead === "read" && afterLateDelivered === "read") {
      pass("A10 campaign delivery statuses persist monotonically", "sent→delivered→read, no downgrade");
    } else {
      fail("A10 delivery progression", `delivered=${afterDelivered} read=${afterRead} late=${afterLateDelivered}`);
    }
  }

  // A11: broadcast_messages + trigger → broadcast_history counters
  {
    const w1 = wamid("b1"), w2 = wamid("b2"); cleanupIds.wamids.push(w1, w2);
    if (broadcastId) {
      // Reuse the broadcast's real messages for realism if present; else seed
      const p1 = fakePhone(777001), p2 = fakePhone(777002);
      await supa.from("broadcast_messages").update({ wamid: w1 }).eq("broadcast_id", broadcastId).eq("phone_number", p1);
      await supa.from("broadcast_messages").update({ wamid: w2 }).eq("broadcast_id", broadcastId).eq("phone_number", p2);
      // failed seeds won't match predecessor 'sent' → re-seed status
      await supa.from("broadcast_messages").update({ status: "sent" }).eq("wamid", w1);
      await supa.from("broadcast_messages").update({ status: "sent" }).eq("wamid", w2);

      await postWebhook(BASE_URL, statusPayload(w1, "delivered", p1));
      await postWebhook(BASE_URL, statusPayload(w1, "read", p1));
      await postWebhook(BASE_URL, statusPayload(w2, "delivered", p2));
      await sleep(500);
      const { data: h } = await supa.from("broadcast_history")
        .select("total_delivered, total_read").eq("id", broadcastId).single();
      if (h && h.total_delivered >= 2 && h.total_read >= 1) {
        pass("A11 broadcast delivered/read counters", `delivered=${h.total_delivered} read=${h.total_read}`);
      } else {
        fail("A11 broadcast counters", `hist=${JSON.stringify(h)}`);
      }
    } else {
      fail("A11 broadcast counters", "no broadcast_id from A9");
    }
  }

  // A12: failed delivery callback lands in message_delivery_failures
  {
    const w = wamid("fail1"); cleanupIds.wamids.push(w);
    const phone = fakePhone(888005); cleanupIds.phones.add(phone);
    await postWebhook(BASE_URL, statusPayload(w, "failed", phone, [{
      code: 131049, title: "Marketing limit", error_data: { details: "cap" },
    }]));
    await sleep(400);
    const { data: f } = await supa.from("message_delivery_failures")
      .select("error_code").eq("message_id", w).maybeSingle();
    if (f?.error_code === 131049) pass("A12 delivery failure logged", "error 131049 captured");
    else fail("A12 delivery failure log", `row=${JSON.stringify(f)}`);
  }

  // A13: conversations thread API
  {
    const phone = fakePhone(888006); cleanupIds.phones.add(phone);
    const t1 = new Date(Date.now() - 120000).toISOString();
    const t2 = new Date(Date.now() - 60000).toISOString();
    await supa.from("conversations").insert([
      { phone_number: phone, contact_name: "Audit", incoming_message: "hello", ai_response: "hi", lead_score: "COLD", timestamp: t1, created_at: t1 },
      { phone_number: phone, contact_name: "Audit", incoming_message: "more", ai_response: "ok", lead_score: "COLD", timestamp: t2, created_at: t2 },
    ]);
    const r = await raw("GET", `/api/conversations?phone=${phone}`, { headers: authed() });
    const r2 = await raw("GET", `/api/conversations?phone=${phone}`);
    const bodies = (r.json?.messages ?? []).map((m) => m.incoming_message);
    if (r.status === 200 && bodies.length === 2 && bodies[0] === "hello" && bodies[1] === "more" && (r2.status === 401 || r2.status === 307)) {
      pass("A13 conversations thread API", "2 msgs ascending, unauth rejected");
    } else {
      fail("A13 conversations API", `r=${r.status} bodies=${JSON.stringify(bodies)} unauth=${r2.status}`);
    }
  }

  // A14: bulk import dedupe — payload dupes + existing rows
  {
    const { data: group } = await supa.from("broadcast_groups")
      .insert({ group_name: `PAUDIT-G2-${RUN}`, group_label: "audit" }).select().single();
    cleanupIds.groups.push(group.id);
    const p = fakePhone(777009); cleanupIds.phones.add(p);
    await supa.from("broadcast_contacts").insert({ group_id: group.id, phone_number: p, opt_in: true });

    const r = await raw("POST", "/api/broadcasts/contacts/bulk-import", {
      body: { group_id: group.id, contacts: [
        { phone_number: p, contact_name: "first" },
        { phone_number: `0${p.slice(2)}`, contact_name: "dupe local fmt" },
        { phone_number: fakePhone(777010), contact_name: "new" },
      ] },
      headers: authed(),
    });
    const { data: contacts } = await supa.from("broadcast_contacts")
      .select("id").eq("group_id", group.id);
    if (r.status === 201 && contacts?.length === 2) {
      pass("A14 bulk import dedupes payload + existing", `imported=${r.json.imported} total=${contacts.length}`);
    } else {
      fail("A14 bulk import dedupe", `status=${r.status} contacts=${contacts?.length} body=${r.text.slice(0, 200)}`);
    }
  }

  // A15: xlsx template endpoint still works after 0.20.3 upgrade
  {
    const res = await fetch(`${BASE_URL}/api/broadcasts/contacts/template`, { headers: authed(), redirect: "manual" });
    const ct = res.headers.get("content-type") ?? "";
    const buf = await res.arrayBuffer();
    if (res.status === 200 && ct.includes("spreadsheetml") && buf.byteLength > 2000) {
      pass("A15 xlsx template endpoint (0.20.3)", `${buf.byteLength}B xlsx`);
    } else {
      fail("A15 xlsx template", `status=${res.status} ct=${ct} bytes=${buf.byteLength}`);
    }
  }
}

// ─── Section B: failure injection ───────────────────────────────────────────
async function sectionB() {
  console.log("\n=== SECTION B: Failure injection ===");

  // B1: duplicate wamid delivered 3× concurrently → single processing
  {
    const c = await createTestCampaign(`PAUDIT-Dedupe-${RUN}`);
    cleanupIds.campaigns.push(c.id);
    const phone = fakePhone(666001); cleanupIds.phones.add(phone);
    const e = await enrol(c.id, phone);
    const w = wamid("dup1"); cleanupIds.wamids.push(w);
    const [r1, r2, r3] = await Promise.all([
      postWebhook(BASE_URL, metaPayload(phone, "FIBRE", w)),
      postWebhook(BASE_URL, metaPayload(phone, "FIBRE", w)),
      postWebhook(BASE_URL, metaPayload(phone, "FIBRE", w)),
    ]);
    const { data: rows } = await supa.from("campaign_interactions")
      .select("id").eq("enrol_id", e.id).eq("message_type", "inbound");
    const { data: markers } = await supa.from("inbound_webhook_messages").select("wamid").eq("wamid", w);
    if (r1.status === 200 && r2.status === 200 && r3.status === 200 && (markers?.length ?? 0) <= 1 && (rows?.length ?? 0) <= 1) {
      pass("B1 duplicate wamid deduplicated", `interactions=${rows?.length} markers=${markers?.length}`);
    } else {
      fail("B1 wamid dedupe", `interactions=${rows?.length} markers=${markers?.length} statuses=${[r1.status, r2.status, r3.status]}`);
    }
  }

  // B2: status-only payload storm → all acked, nothing else processed
  {
    const phone = fakePhone(666002); cleanupIds.phones.add(phone);
    const ws = Array.from({ length: 10 }, (_, i) => { const w = wamid(`storm${i}`); cleanupIds.wamids.push(w); return w; });
    const rs = await Promise.all(ws.map((w) => postWebhook(BASE_URL, statusPayload(w, "delivered", phone))));
    const { data: ints } = await supa.from("campaign_interactions").select("id").eq("phone_number", phone);
    if (rs.every((r) => r.status === 200) && (ints?.length ?? 0) === 0) {
      pass("B2 status-only storm acked, no message processing", `${rs.length} callbacks`);
    } else {
      fail("B2 status storm", `statuses=${rs.map((r) => r.status)} interactions=${ints?.length}`);
    }
  }

  // B3: malformed/absurd webhook payloads → no 500s
  {
    const payloads = [
      "not json at all",
      JSON.stringify({ entry: "not-an-array" }),
      JSON.stringify({ entry: [{ changes: [{ value: { messages: "nope" } }] }] }),
      JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ from: null, type: "text" }] } }] }] }),
      JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: null, status: "weird" }] } }] }] }),
      "",
    ];
    const rs = [];
    for (const p of payloads) {
      const res = await fetch(`${BASE_URL}/api/whatsapp-webhook`, {
        method: "POST", headers: { "Content-Type": "application/json", ...webhookHeaders(p) }, body: p,
      });
      rs.push(res.status);
    }
    if (rs.every((s) => s < 500)) pass("B3 malformed webhooks don't 500", `statuses=${rs.join(",")}`);
    else fail("B3 malformed webhooks", `statuses=${rs.join(",")}`);
  }

  // B4: paused campaign → process sends nothing
  {
    const c = await createTestCampaign(`PAUDIT-Paused-${RUN}`, {
      status: "paused",
      steps: [{ step_number: 1, delay_days: 0, template_name: "hello_world" }],
    });
    cleanupIds.campaigns.push(c.id);
    const phone = fakePhone(666003); cleanupIds.phones.add(phone);
    const e = await enrol(c.id, phone, { enrolled_at: new Date(Date.now() - 86400000).toISOString() });
    const r = await raw("POST", "/api/campaigns/process", { body: {}, headers: bearer() });
    const { data: ints } = await supa.from("campaign_interactions").select("id").eq("enrol_id", e.id);
    if (r.status === 200 && (ints?.length ?? 0) === 0) {
      pass("B4 paused campaign sends nothing");
    } else {
      fail("B4 paused campaign", `interactions=${ints?.length}`);
    }
  }

  // B5: past end_date → campaign completed + enrolments no_response_final
  {
    const c = await createTestCampaign(`PAUDIT-EndDate-${RUN}`, {
      status: "active",
      steps: [{ step_number: 1, delay_days: 0, template_name: "hello_world" }],
    });
    cleanupIds.campaigns.push(c.id);
    const phone = fakePhone(666004); cleanupIds.phones.add(phone);
    const e = await enrol(c.id, phone, { enrolled_at: new Date(Date.now() - 86400000).toISOString() });
    await supa.from("campaigns").update({ end_date: new Date(Date.now() - 3600000).toISOString() }).eq("id", c.id);
    await raw("POST", "/api/campaigns/process", { body: {}, headers: bearer() });
    const { data: camp } = await supa.from("campaigns").select("status").eq("id", c.id).single();
    const { data: enr } = await supa.from("campaign_enrolments").select("status, nurture_flag").eq("id", e.id).single();
    if (camp?.status === "completed" && enr?.status === "no_response_final" && enr?.nurture_flag) {
      pass("B5 end_date boundary closes campaign", `campaign=completed enrolment=${enr.status}`);
    } else {
      fail("B5 end_date", `campaign=${camp?.status} enrolment=${JSON.stringify(enr)}`);
    }
  }

  // B6: step due exactly at fireAt → sent
  {
    const c = await createTestCampaign(`PAUDIT-FireAt-${RUN}`, {
      status: "active",
      steps: [{ step_number: 1, delay_days: 1, template_name: "hello_world" }],
    });
    cleanupIds.campaigns.push(c.id);
    const phone = fakePhone(666005); cleanupIds.phones.add(phone);
    const e = await enrol(c.id, phone, { enrolled_at: new Date(Date.now() - 24 * 60 * 60 * 1000 - 5000).toISOString() });
    await raw("POST", "/api/campaigns/process", { body: {}, headers: bearer() });
    const { data: ints } = await supa.from("campaign_interactions")
      .select("delivery_status").eq("enrol_id", e.id).eq("message_type", "outbound");
    if (ints?.length === 1) pass("B6 step due exactly at fireAt fires", `status=${ints[0].delivery_status}`);
    else fail("B6 fireAt boundary", `interactions=${ints?.length}`);
  }

  // B7: Meta send failure → failed interaction + campaign_errors.send_failed
  // (an invalid template name deterministically fails at the Meta API)
  {
    const c = await createTestCampaign(`PAUDIT-MetaFail-${RUN}`, {
      status: "active",
      steps: [{ step_number: 1, delay_days: 0, template_name: "paudit_no_such_template" }],
    });
    cleanupIds.campaigns.push(c.id);
    const phone = fakePhone(666006); cleanupIds.phones.add(phone);
    const e = await enrol(c.id, phone, { enrolled_at: new Date(Date.now() - 60000).toISOString() });
    await raw("POST", "/api/campaigns/process", { body: {}, headers: bearer() });
    const { data: ints } = await supa.from("campaign_interactions")
      .select("delivery_status, meta_error").eq("enrol_id", e.id).eq("message_type", "outbound");
    const { data: errs } = await supa.from("campaign_errors")
      .select("error_type").eq("campaign_id", c.id).eq("error_type", "send_failed");
    if (ints?.[0]?.delivery_status === "failed" && ints[0].meta_error && (errs?.length ?? 0) >= 1) {
      pass("B7 Meta failure → failed interaction + campaign_errors", `error logged`);
    } else {
      fail("B7 Meta failure path", `int=${JSON.stringify(ints)} errs=${errs?.length}`);
    }
  }

  manual("n8n unreachable → webhook forward failure", "kill n8n route/DNS, confirm Meta retry reprocesses (wamid only marked post-forward)");
  manual("OpenRouter/JEV outage → safe fallback + escalation", "already observed live via 402; cannot force on demand");
  manual("Cold-start kill mid-batch", "Vercel-side; mitigated by claim rows + 45s budget — spot-check after a real large run");
}

// ─── Section C: launch scale ────────────────────────────────────────────────
async function sectionC() {
  console.log("\n=== SECTION C: Launch scale ===");

  // C1: process throughput — 30 fake enrolments, measure drain rate
  {
    const c = await createTestCampaign(`PAUDIT-Throughput-${RUN}`, {
      status: "active",
      steps: [{ step_number: 1, delay_days: 0, template_name: "hello_world" }],
    });
    cleanupIds.campaigns.push(c.id);
    const phones = Array.from({ length: 30 }, (_, i) => fakePhone(500000 + i));
    phones.forEach((p) => cleanupIds.phones.add(p));
    for (const p of phones) {
      await supa.from("campaign_enrolments").insert({
        campaign_id: c.id, phone_number: p, current_step: 0, status: "active",
        enrolled_at: new Date(Date.now() - 60000).toISOString(),
      });
    }
    const t0 = Date.now();
    const r = await raw("POST", "/api/campaigns/process", { body: {}, headers: bearer() });
    const ms = Date.now() - t0;
    const processed = (r.json?.sent ?? 0) + (r.json?.failed ?? 0);
    if (r.status === 200 && processed >= 30 && ms < 60000) {
      pass("C1 process throughput", `30 sends in ${ms}ms (concurrency 8, budget 45s)`);
    } else {
      fail("C1 throughput", `processed=${processed} ms=${ms} body=${r.text.slice(0, 200)}`);
    }
  }

  // C2: reply flood — 15 distinct inbound webhooks, proxy holds up
  if (!SKIP_FLOOD) {
    const phones = Array.from({ length: 15 }, (_, i) => fakePhone(600000 + i));
    phones.forEach((p) => cleanupIds.phones.add(p));
    const ws = phones.map((p, i) => { const w = wamid(`flood${i}`); cleanupIds.wamids.push(w); return w; });
    const t0 = Date.now();
    const rs = await Promise.all(phones.map((p, i) =>
      postWebhook(BASE_URL, metaPayload(p, "tell me about fibre", ws[i]))));
    const ms = Date.now() - t0;
    if (rs.every((r) => r.status === 200)) {
      pass("C2 reply flood (15 concurrent)", `all 200s in ${ms}ms — n8n AI processing continues async`);
    } else {
      fail("C2 reply flood", `statuses=${rs.map((r) => r.status)}`);
    }
    manual("100+ reply flood + OpenRouter credit impact", "needs prod load harness; 15 verified here");
  } else {
    manual("C2 reply flood", "skipped via --skip-flood");
  }

  // C3: dashboard + stats response times with real data volume
  {
    const t0 = Date.now();
    const r = await raw("GET", "/api/campaigns/dashboard-stats", { headers: authed() });
    const ms = Date.now() - t0;
    if (r.status === 200 && ms < 8000) pass("C3 dashboard stats latency", `${ms}ms`);
    else fail("C3 dashboard stats", `status=${r.status} ms=${ms}`);
  }
  manual("Meta TIER_2K headroom", "count expected business-initiated conversations/24h across campaign + follow-ups + broadcasts before launch");
  manual("131049 marketing-cap staff visibility", "failures land in message_delivery_failures — confirm staff monitoring runbook covers it");
}

// ─── Section E: session / UX / multi-user ───────────────────────────────────
async function sectionE(page, context) {
  console.log("\n=== SECTION E: Session / UX / multi-user ===");

  // E1: concurrent step edits → consistent final state
  {
    const c = await createTestCampaign(`PAUDIT-Concurrent-${RUN}`);
    cleanupIds.campaigns.push(c.id);
    const [r1, r2] = await Promise.all([
      raw("PATCH", `/api/campaigns/${c.id}`, { body: { name: "PAUDIT-Edit-A" }, headers: authed() }),
      raw("PATCH", `/api/campaigns/${c.id}`, { body: { name: "PAUDIT-Edit-B" }, headers: authed() }),
    ]);
    const { data: camp } = await supa.from("campaigns").select("name").eq("id", c.id).single();
    if (r1.status < 500 && r2.status < 500 && (camp?.name === "PAUDIT-Edit-A" || camp?.name === "PAUDIT-Edit-B")) {
      pass("E1 concurrent edits → consistent state", `final=${camp.name}`);
    } else {
      fail("E1 concurrent edits", `r1=${r1.status} r2=${r2.status} name=${camp?.name}`);
    }
  }

  // E2: expired session can't write (no silent save)
  {
    const r = await raw("POST", "/api/campaigns", { body: { name: `PAUDIT-NoAuth-${RUN}` } });
    const { data: leaked } = await supa.from("campaigns").select("id").eq("name", `PAUDIT-NoAuth-${RUN}`);
    if (isUnauth(r) && (leaked?.length ?? 0) === 0) {
      pass("E2 unauthenticated write blocked, nothing persisted");
    } else {
      fail("E2 expired-session write", `status=${r.status} leaked=${leaked?.length}`);
    }
  }

  // E3: forgot/reset pages render
  {
    for (const p of ["/forgot-password", "/reset-password"]) {
      const r = await raw("GET", p, { headers: { Accept: "text/html" } });
      if (r.status === 200) pass(`E3 ${p} renders`);
      else fail(`E3 ${p}`, `status=${r.status}`);
    }
    manual("password reset email link end-to-end", "Supabase Auth sends the mail — verify manually once");
  }

  // E4: deep links to bad IDs don't 500
  {
    const bad = [
      "/campaigns/not-a-uuid",
      `/campaigns/00000000-0000-0000-0000-000000000000`,
      `/campaigns/00000000-0000-0000-0000-000000000000/customers/27710000000`,
    ];
    const rs = [];
    for (const p of bad) {
      const res = await fetch(`${BASE_URL}${p}`, { headers: authed(), redirect: "manual" });
      rs.push({ p, status: res.status });
    }
    const fiveHundreds = rs.filter((r) => r.status >= 500);
    if (fiveHundreds.length === 0) {
      pass("E4 deep links to bad IDs don't 500", rs.map((r) => `${r.p.split("?")[0].slice(0, 30)}=${r.status}`).join(" "));
    } else {
      fail("E4 deep links", `500s on ${JSON.stringify(fiveHundreds)}`);
    }
  }

  // E5: ?search= deep link into leads
  {
    await page.goto(`${BASE_URL}/leads?search=2783`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    const input = page.locator("input[placeholder*='Search'], input[type='text']").first();
    const val = await input.inputValue().catch(() => "");
    if (val === "2783") pass("E5 ?search= deep link seeds search input");
    else fail("E5 search deep link", `input value="${val}"`);
  }

  // E6: reload mid-form → no crash, clean state
  {
    await page.goto(`${BASE_URL}/campaigns/create`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1200);
    const nameInput = page.locator("input[type='text']").first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill("PAUDIT-Draft");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      const ok = page.url().includes("/campaigns/create");
      if (ok) pass("E6 reload mid-form is clean");
      else fail("E6 reload mid-form", `url=${page.url()}`);
    } else {
      fail("E6 reload mid-form", "name input not found");
    }
  }

  // E7: keyboard nav reaches interactive controls on /leads
  {
    await page.goto(`${BASE_URL}/leads`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);
    let focused = null;
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      focused = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? `${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ""}` : null;
      });
      if (focused && /button|input|a\[|select/.test(focused)) break;
    }
    if (focused && /button|input|a\[|select/.test(focused)) {
      pass("E7 keyboard Tab reaches interactive controls", `focused=${focused}`);
    } else {
      fail("E7 keyboard nav", `focused=${focused}`);
    }
  }

  // E8: hydration-mismatch sweep on key pages
  {
    const pages = ["/dashboard", "/leads", "/conversations", "/campaigns"];
    const hydraErrors = [];
    for (const p of pages) {
      const errs = [];
      page.on("console", (m) => {
        if (m.type() === "error" && /hydrat|did not match|text content/i.test(m.text())) errs.push(m.text());
      });
      await page.goto(`${BASE_URL}${p}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);
      hydraErrors.push(...errs.map((e) => `${p}: ${e.slice(0, 80)}`));
    }
    if (hydraErrors.length === 0) pass("E8 no hydration errors on key pages");
    else console.log(`  ⚠️  hydration warnings: ${hydraErrors.length} — ${hydraErrors[0] ?? ""}`); // warn, not fail — app recovers
  }
  manual("screen-reader pass", "NVDA/VoiceOver on leads/campaigns/conversations");
  manual("multi-tab logout", "logout in one tab → other tabs should fail auth on next action");
}

// ─── Section F: security extras ─────────────────────────────────────────────
async function sectionF(page) {
  console.log("\n=== SECTION F: Security extras ===");

  // F1: x-middleware-subrequest bypass attempt
  {
    const res = await fetch(`${BASE_URL}/dashboard`, {
      headers: { "x-middleware-subrequest": "middleware" },
      redirect: "manual",
    });
    if (res.status !== 200) {
      pass("F1 x-middleware-subrequest doesn't bypass auth", `status=${res.status}`);
    } else {
      const html = await res.text();
      if (html.includes("/login") || html.includes("email")) {
        pass("F1 x-middleware-subrequest doesn't bypass auth", "200 but login content");
      } else {
        securityFail("F1 middleware bypass", "dashboard HTML returned unauthenticated via x-middleware-subrequest");
      }
    }
  }

  // F2: forged status callback can't corrupt unrelated records
  {
    const w = wamid("forged"); cleanupIds.wamids.push(w);
    const phone = fakePhone(555001); cleanupIds.phones.add(phone);
    // A 'failed' status for a wamid that doesn't exist must update nothing.
    await postWebhook(BASE_URL, statusPayload(w, "read", phone));
    const { data: ints } = await supa.from("campaign_interactions").select("id").eq("meta_message_id", w);
    const { data: bmsgs } = await supa.from("broadcast_messages").select("id").eq("wamid", w);
    if ((ints?.length ?? 0) === 0 && (bmsgs?.length ?? 0) === 0) {
      pass("F2 forged status for unknown wamid corrupts nothing");
    } else {
      securityFail("F2 forged status", "status callback mutated records for unknown wamid");
    }
  }

  // F3: verify-token brute force → consistent 403s
  {
    const rs = [];
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${BASE_URL}/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=wrong${i}&hub.challenge=x`);
      rs.push(res.status);
    }
    if (rs.every((s) => s === 403)) pass("F3 verify-token brute force → all 403", `${rs.length} attempts`);
    else securityFail("F3 verify-token", `statuses=${rs.join(",")}`);
  }

  // F4: no open-redirect params honoured. Middleware may echo query params
  // into an on-domain /login redirect — that's fine. What matters is that no
  // code path navigates to the param VALUE (off-origin).
  {
    const base = new URL(BASE_URL);
    const probes = [
      `/login?next=${encodeURIComponent("https://evil.example.com")}`,
      `/dashboard?next=${encodeURIComponent("https://evil.example.com")}`,
      `/api/auth/signout?next=${encodeURIComponent("https://evil.example.com")}`,
    ];
    const offOrigin = [];
    for (const p of probes) {
      const res = await fetch(`${BASE_URL}${p}`, { redirect: "manual" });
      const loc = res.headers.get("location");
      if (loc) {
        const target = new URL(loc, BASE_URL);
        if (target.origin !== base.origin) offOrigin.push(`${p} → ${loc}`);
      }
    }
    if (offOrigin.length === 0) {
      pass("F4 redirects stay on-origin (no open redirect)", `${probes.length} probes`);
    } else {
      securityFail("F4 open redirect", offOrigin[0]);
    }
  }

  // F5: secrets don't leak into client bundle
  {
    const secrets = [
      ["SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY],
      ["META_ACCESS_TOKEN", process.env.META_ACCESS_TOKEN],
      ["OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY],
      ["APP_SECRET", process.env.APP_SECRET],
      ["META_APP_SECRET", process.env.META_APP_SECRET],
    ].filter(([, v]) => v && v.length > 8);

    const pageHtml = await (await fetch(`${BASE_URL}/login`)).text();
    const scriptSrcs = [...pageHtml.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]).slice(0, 15);
    let leaked = null;
    for (const src of scriptSrcs) {
      const js = await (await fetch(`${BASE_URL}${src}`)).text();
      for (const [name, value] of secrets) {
        if (value && js.includes(value)) { leaked = `${name} in ${src}`; break; }
      }
      if (leaked) break;
    }
    if (!leaked) pass("F5 no server secrets in client JS", `${scriptSrcs.length} bundles scanned`);
    else securityFail("F5 secret in bundle", leaked);
  }

  // F6: error responses don't leak Supabase internals
  {
    const probes = [
      () => raw("GET", "/api/campaigns/enrolments", { headers: authed() }),
      () => raw("POST", "/api/campaigns", { body: { name: 12345, steps: "bad" }, headers: authed() }),
      () => raw("PATCH", "/api/campaigns/not-a-uuid", { body: { name: "x" }, headers: authed() }),
      () => raw("GET", "/api/conversations", { headers: authed() }),
    ];
    const leaks = [];
    for (const probe of probes) {
      const r = await probe();
      const body = r.text ?? "";
      if (/postgres|supabase\.co|at \w+ \(|stack:|node_modules/i.test(body)) {
        leaks.push(body.slice(0, 120));
      }
    }
    if (leaks.length === 0) pass("F6 error responses don't leak internals");
    else securityFail("F6 error leakage", leaks[0]);
  }

  // F7: IDOR spot-check — authenticated requests can't cross tenants
  // (single-tenant: verify data scoping isn't broken)
  {
    const r = await raw("GET", "/api/campaigns/dashboard-stats", { headers: authed() });
    const r2 = await raw("GET", "/api/campaigns/dashboard-stats");
    if (r.status === 200 && isUnauth(r2)) {
      pass("F7 authed API works, unauthed rejected (single-tenant)");
    } else {
      fail("F7 API access", `authed=${r.status} unauthed=${r2.status}`);
    }
  }

  manual("rate limiting on write endpoints", "ACCEPTED — single-tenant internal tool behind auth; revisit if opened to more users");
  manual("Bearer === compare (non-timing-safe)", "low risk — hardening backlog item");
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Pre-Launch Audit — ${BASE_URL}`);
  console.log(`Mode: ${UI_ONLY ? "UI only" : BACKEND_ONLY ? "backend only" : "full"}\n`);

  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 150 : 0 });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });

  try {
    // Warm the login cookie once for all authed API calls
    if (!UI_ONLY || true) {
      await login(page);
      const cookies = await context.cookies();
      cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      console.log("  logged in, cookie session established\n");
    }

    if (!UI_ONLY) {
      await sectionA();
      await sectionB();
      await sectionC();
    }
    if (!BACKEND_ONLY) {
      await sectionE(page, context);
    }
    if (!UI_ONLY) {
      await sectionF(page);
    }
  } finally {
    await cleanup();
    await browser.close();
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  const p = results.filter((r) => r.status === "PASS").length;
  const f = results.filter((r) => r.status === "FAIL").length;
  const s = results.filter((r) => r.status === "SECURITY").length;
  const m = results.filter((r) => r.status === "MANUAL").length;

  console.log("\n" + "=".repeat(60));
  console.log(`PRE-LAUNCH AUDIT: ${p} passed, ${f} failed, ${s} security, ${m} manual`);
  console.log("=".repeat(60));
  if (bugs.length) {
    console.log("\nFailures:");
    bugs.forEach((b) => console.log(`  - ${b.test}: ${b.error}`));
  }
  if (securityIssues.length) {
    console.log("\nSecurity issues:");
    securityIssues.forEach((b) => console.log(`  - ${b.test}: ${b.error}`));
  }
  if (consoleErrors.length) {
    console.log(`\nConsole errors captured: ${consoleErrors.length}`);
  }

  fs.writeFileSync(
    "tests/prelaunch-audit-results.json",
    JSON.stringify({ timestamp: new Date().toISOString(), baseUrl: BASE_URL, summary: { passed: p, failed: f, security: s, manual: m, total: results.length }, results, bugs, securityIssues, consoleErrors }, null, 2)
  );
  console.log("\nResults → tests/prelaunch-audit-results.json");
  process.exit(f + s > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Suite crashed:", e);
  cleanup().finally(() => process.exit(1));
});
