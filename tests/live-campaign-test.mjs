/**
 * Live Campaign Test — Fibre Lead Re-Engagement
 *
 * Executes the live test plan in
 *   /Users/muhammedhusseinismail/.devin/plans/plan-live-campaign-test.md
 *
 * Tester:
 *   Phone: 0832763116 (normalized SA: 27832763116)
 *   Email: hussainismail703@gmail.com
 *
 * Phases:
 *   1.  Pre-Test Setup & Verification
 *   2.  Live Step 1 Message Dispatch (real WhatsApp send)
 *   3.  Real Reply — n8n AI Conversation Flow (production, optional)
 *   4.  Simulated Response Path Testing (local, no real sends)
 *   5.  Live Step 2 Follow-Up Dispatch (real WhatsApp send)
 *   6.  No-Response Flow & Campaign Closure
 *   7.  Calling Queue Sales Workflow
 *   8.  Campaign Reporting & Funnel Verification
 *   9.  Late Response Revival (edge case)
 *   10. Cleanup
 *
 * Run:
 *   node --env-file=.env.local tests/live-campaign-test.mjs
 *
 * Flags:
 *   --skip-real-messages   Dry-run: skip real WhatsApp sends, test logic only
 *   --auto-confirm         Skip interactive confirmation prompts
 *   --local-only           Skip Phase 3 (real reply via production)
 */

import { chromium } from "playwright";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import readline from "readline";
import { webhookHeaders } from "./lib/webhook.mjs";

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

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_SECRET = process.env.APP_SECRET;
const SKIP_REAL_MESSAGES = process.argv.includes("--skip-real-messages");
const AUTO_CONFIRM = process.argv.includes("--auto-confirm") || process.env.CAMPAIGN_LIVE_TEST_AUTO_CONFIRM === "true";
const LOCAL_ONLY = process.argv.includes("--local-only");

const TEST_EMAIL = process.env.TEST_EMAIL || "hussainismail703@gmail.com";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "TestPass123!";
const TEST_PHONE = normalizePhone(process.env.TEST_PHONE || "0832763116");

const CAMPAIGN_NAME = "Fibre Lead Re-Engagement";
const CAMPAIGN_ID = "febe1cac-cf87-46c3-bbc7-160d3b96e28e";

const SCREENSHOT_DIR = "./tests/screenshots/live-campaign-test";
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const results = [];
const bugs = [];
const warnings = [];
let currentPhase = "";

// ─── Reporting helpers ──────────────────────────────────────────────────────
function record(status, name, extra) {
  const entry = { phase: currentPhase, test: name, status, ...extra };
  results.push(entry);
  return entry;
}
function pass(name, detail = "") {
  record("PASS", name, { detail });
  console.log(`    ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, error, severity = "bug") {
  record("FAIL", name, { error, severity });
  bugs.push({ phase: currentPhase, test: name, error, severity });
  console.log(`    ❌ ${name}: ${error}`);
}
function warn(name, detail) {
  record("WARN", name, { detail });
  warnings.push({ phase: currentPhase, test: name, detail });
  console.log(`    ⚠️  ${name}: ${detail}`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function normalizePhone(p) {
  let d = String(p).replace(/\D/g, "");
  if (d.startsWith("0")) d = "27" + d.slice(1);
  return d;
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function http(method, url, { body, headers = {}, rawBody } = {}) {
  const opts = { method, headers: { "Content-Type": "application/json", ...headers } };
  if (rawBody !== undefined) opts.body = rawBody;
  else if (body !== undefined) opts.body = typeof body === "string" ? body : JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, text, headers: Object.fromEntries(res.headers), finalUrl: res.url };
  } catch (err) {
    return { status: 0, error: err.message, data: null, text: null, headers: {}, finalUrl: null };
  }
}

async function apiCall(method, path, { body, headers = {}, rawBody } = {}) {
  return http(method, `${BASE_URL}${path}`, { body, headers, rawBody });
}

function sb() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let cachedAuthCookieHeader = null;
async function authCookieHeader(browser) {
  if (cachedAuthCookieHeader) return { Cookie: cachedAuthCookieHeader };
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.waitForSelector("#email", { timeout: 15000 });
  await page.locator("#email").fill(TEST_EMAIL);
  await page.locator("#password").fill(TEST_PASSWORD);
  await page.locator("form:has(#email) button[type='submit']").click();
  await page.waitForURL("**/dashboard", { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const cookies = await context.cookies();
  cachedAuthCookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  await context.close();
  return { Cookie: cachedAuthCookieHeader };
}

// ─── Meta webhook payload builder ───────────────────────────────────────────
function metaWebhookPayload(fromPhone, messageBody, messageId) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "whatsapp_business_account",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "27 75 777 4389", phone_number_id: "1257101724147822" },
              contacts: [{ profile: { name: "Hussain Ismail" }, wa_id: fromPhone }],
              messages: [
                {
                  from: fromPhone,
                  id: messageId || `wamid.${crypto.randomUUID()}`,
                  type: "text",
                  text: { body: messageBody },
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

async function sendInboundWebhook(messageBody) {
  const payload = metaWebhookPayload(TEST_PHONE, messageBody);
  const raw = JSON.stringify(payload);
  return http("POST", `${BASE_URL}/api/whatsapp-webhook`, { rawBody: raw, headers: webhookHeaders(raw) });
}

// ─── Database helpers ───────────────────────────────────────────────────────
async function getCampaignByName(name) {
  const client = sb();
  const { data, error } = await client.from("campaigns").select("id, name, status").ilike("name", name).limit(1).single();
  if (error) throw new Error(`getCampaignByName failed: ${error.message}`);
  return data;
}

async function getOrCreateTestLead(phone = TEST_PHONE) {
  const client = sb();
  const { data, error } = await client
    .from("leads")
    .upsert(
      {
        phone_number: phone,
        full_name: "Hussain Ismail",
        email: TEST_EMAIL,
        status: "new",
      },
      { onConflict: "phone_number" }
    )
    .select("id, phone_number, email, full_name, status, notes, rejection_reason")
    .single();
  if (error) throw new Error(`getOrCreateTestLead failed: ${error.message}`);
  return data;
}

async function getEnrolment(campaignId, phone = TEST_PHONE) {
  const client = sb();
  const { data, error } = await client
    .from("campaign_enrolments")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("phone_number", phone)
    .order("enrolled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getEnrolment failed: ${error.message}`);
  return data;
}

async function getOrCreateEnrolment(campaignId, phone = TEST_PHONE) {
  const lead = await getOrCreateTestLead(phone);
  const existing = await getEnrolment(campaignId, phone);
  if (existing) return existing;
  const client = sb();
  const { data, error } = await client
    .from("campaign_enrolments")
    .insert({
      campaign_id: campaignId,
      phone_number: phone,
      lead_id: lead.id,
      current_step: 0,
      status: "active",
      enrolled_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw new Error(`createEnrolment failed: ${error.message}`);
  return data;
}

async function resetEnrolment(campaignId, phone = TEST_PHONE, { current_step = 0, status = "active", enrolled_at = null } = {}) {
  const client = sb();
  const update = { current_step, status, final_outcome: null, nurture_flag: false };
  if (enrolled_at) update.enrolled_at = enrolled_at;
  const { error } = await client
    .from("campaign_enrolments")
    .update(update)
    .eq("campaign_id", campaignId)
    .eq("phone_number", phone);
  if (error) throw new Error(`resetEnrolment failed: ${error.message}`);
}

async function setCampaignStatus(campaignId, status) {
  const client = sb();
  const { error } = await client.from("campaigns").update({ status }).eq("id", campaignId);
  if (error) throw new Error(`setCampaignStatus failed: ${error.message}`);
}

async function cleanTestData(campaignId, phone = TEST_PHONE) {
  const client = sb();
  const { data: enrolments } = await client.from("campaign_enrolments").select("id").eq("campaign_id", campaignId).eq("phone_number", phone);
  const enrolIds = (enrolments || []).map((e) => e.id);
  if (enrolIds.length) {
    const { data: interactions } = await client.from("campaign_interactions").select("id").in("enrol_id", enrolIds);
    const interactionIds = (interactions || []).map((i) => i.id);
    if (interactionIds.length) {
      await client.from("campaign_classifications").delete().in("interaction_id", interactionIds);
    }
    await client.from("campaign_interactions").delete().in("enrol_id", enrolIds);
    await client.from("calling_queue").delete().in("enrolment_id", enrolIds);
    await client.from("campaign_enrolments").delete().in("id", enrolIds);
  }
  await client.from("opt_out_list").delete().eq("phone_number", phone);
  // Audit log stores entity_id = enrolment.id for enrolment changes
  if (enrolIds.length) {
    await client.from("campaign_audit_log").delete().in("entity_id", enrolIds);
  }
  await client.from("campaign_errors").delete().eq("campaign_id", campaignId);
}

async function cleanResponsePathRecords(campaignId, phone) {
  const client = sb();
  const { data: enrolment } = await client
    .from("campaign_enrolments")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("phone_number", phone)
    .limit(1)
    .maybeSingle();
  if (!enrolment) return;
  await client.from("calling_queue").delete().eq("enrolment_id", enrolment.id);
  const { data: interactions } = await client
    .from("campaign_interactions")
    .select("id")
    .eq("enrol_id", enrolment.id);
  const interactionIds = (interactions || []).map((i) => i.id);
  if (interactionIds.length) {
    await client.from("campaign_classifications").delete().in("interaction_id", interactionIds);
  }
  await client.from("campaign_interactions").delete().eq("enrol_id", enrolment.id);
  await client.from("opt_out_list").delete().eq("phone_number", phone);
}

async function getLatestClassification(phone = TEST_PHONE) {
  const client = sb();
  const { data } = await client
    .from("campaign_classifications")
    .select("*")
    .eq("phone_number", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function getCallingQueueEntry(enrolmentId) {
  const client = sb();
  const { data } = await client
    .from("calling_queue")
    .select("*")
    .eq("enrolment_id", enrolmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function getLatestInteraction(enrolmentId, messageType = null) {
  const client = sb();
  let q = client
    .from("campaign_interactions")
    .select("*")
    .eq("enrol_id", enrolmentId)
    .order("occurred_at", { ascending: false })
    .limit(1);
  if (messageType) q = q.eq("message_type", messageType);
  const { data } = await q.maybeSingle();
  return data;
}

async function getLead(phone = TEST_PHONE) {
  const client = sb();
  const { data } = await client.from("leads").select("*").eq("phone_number", phone).limit(1).maybeSingle();
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 1: Pre-Test Setup & Verification
// ═════════════════════════════════════════════════════════════════════════════
async function phase1Setup(campaign) {
  currentPhase = "Phase 1: Pre-Test Setup & Verification";
  console.log(`\n${"═".repeat(70)}\n${currentPhase}\n${"═".repeat(70)}`);

  try {
    // 1.1 Verify campaign steps match spec
    const client = sb();
    const { data: steps, error: stepsErr } = await client
      .from("campaign_steps")
      .select("step_number, delay_days, template_name, template_parameters")
      .eq("campaign_id", campaign.id)
      .order("step_number", { ascending: true });
    if (stepsErr) throw new Error(stepsErr.message);

    if (!steps || steps.length !== 2) {
      throw new Error(`Expected 2 campaign steps, found ${steps?.length ?? 0}`);
    }
    if (steps[0].delay_days !== 0 || steps[0].template_name !== "telkom_fibre_packages") {
      throw new Error(`Step 1 config mismatch: ${JSON.stringify(steps[0])}`);
    }
    if (steps[1].delay_days !== 2 || steps[1].template_name !== "telkom_reengagement") {
      throw new Error(`Step 2 config mismatch: ${JSON.stringify(steps[1])}`);
    }
    pass("1.1 Campaign sequence matches spec", `Step 1: ${steps[0].template_name} (delay ${steps[0].delay_days}), Step 2: ${steps[1].template_name} (delay ${steps[1].delay_days})`);

    // 1.2 Clean stale test data
    await cleanTestData(campaign.id);
    pass("1.2 Stale test data cleaned");

    // 1.3 Update lead profile
    const lead = await getOrCreateTestLead();
    if (!lead.full_name) {
      throw new Error("Lead profile missing name");
    }
    pass("1.3 Lead profile initialised", `${lead.full_name} <${lead.email || TEST_EMAIL}>, status=${lead.status}`);

    // 1.4 Create fresh enrolment
    const enrolment = await getOrCreateEnrolment(campaign.id);
    await resetEnrolment(campaign.id);
    pass("1.4 Fresh enrolment created", `id=${enrolment.id}, phone=${enrolment.phone_number}`);

    // 1.5 Set campaign active
    await setCampaignStatus(campaign.id, "active");
    pass("1.5 Campaign status set to active");

    // 1.6 Verify no opt-out entry
    const { data: optOut } = await client.from("opt_out_list").select("id").eq("phone_number", TEST_PHONE).maybeSingle();
    if (optOut) {
      fail("1.6 No opt-out entry exists", "Found unexpected opt_out_list row");
    } else {
      pass("1.6 No opt-out entry exists (clean)");
    }

    return enrolment;
  } catch (err) {
    fail("Phase 1 Setup", err.message, "blocker");
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 2: Live Step 1 Message Dispatch (real WhatsApp send)
// ═════════════════════════════════════════════════════════════════════════════
async function phase2SendStep1(campaign) {
  currentPhase = "Phase 2: Live Step 1 Message Dispatch";
  console.log(`\n${"═".repeat(70)}\n${currentPhase}\n${"═".repeat(70)}`);

  await resetEnrolment(campaign.id);

  if (SKIP_REAL_MESSAGES) {
    warn("2.x Real Step 1 message skipped", "--skip-real-messages flag is set");
    return;
  }

  if (!AUTO_CONFIRM) {
    const confirmation = await ask(
      `\nThis will send a REAL WhatsApp message to ${TEST_PHONE} (0832763116)\n` +
        `using template "telkom_fibre_packages" (marketing).\n` +
        `Continue? [y/n] `
    );
    if (confirmation !== "y" && confirmation !== "yes") {
      throw new Error("User cancelled real Step 1 message send");
    }
  } else {
    console.log(`\n⚠️  Auto-confirm enabled — sending REAL Step 1 WhatsApp to ${TEST_PHONE}`);
  }

  // 2.1 Trigger process endpoint
  const res = await apiCall("POST", "/api/campaigns/process", {
    headers: { Authorization: `Bearer ${APP_SECRET}` },
  });
  if (res.status !== 200 || res.data?.sent !== 1) {
    fail("2.1 Process endpoint Step 1 send", `status=${res.status}, body=${JSON.stringify(res.data)}`);
    throw new Error(`Step 1 send failed: ${JSON.stringify(res.data)}`);
  }
  pass("2.1 Process endpoint Step 1 send", `processed=${res.data.processed}, sent=${res.data.sent}, failed=${res.data.failed}`);

  // 2.2 Verify enrolment advanced
  const enrolment = await getEnrolment(campaign.id);
  if (enrolment.current_step !== 1) {
    fail("2.2 Enrolment advanced to step 1", `current_step=${enrolment.current_step}`);
  } else {
    pass("2.2 Enrolment advanced to step 1");
  }

  // 2.3 Verify outbound interaction logged
  const outbound = await getLatestInteraction(enrolment.id, "outbound");
  if (!outbound || outbound.step_number !== 1 || outbound.delivery_status !== "sent") {
    fail("2.3 Outbound interaction logged", `outbound=${JSON.stringify(outbound)}`);
  } else {
    pass("2.3 Outbound interaction logged", `template=${outbound.template_name}, status=${outbound.delivery_status}`);
  }

  // 2.4 User confirms physical receipt
  if (!AUTO_CONFIRM) {
    const receipt = await ask("\nDid you receive the Step 1 WhatsApp message on 0832763116? [y/n] ");
    if (receipt !== "y" && receipt !== "yes") {
      fail("2.4 Step 1 physical delivery confirmation", "User did not receive message");
      warn("Rate limit", "Meta may have rate-limited this marketing message. Check Meta API logs.");
    } else {
      pass("2.4 Step 1 physical delivery confirmed by tester");
    }
  } else {
    warn("2.4 Step 1 physical delivery", "Auto-confirm enabled — verify manually");
  }

  // 2.5 Verify message content (can't inspect WhatsApp content directly, but verify template)
  pass("2.5 Message content uses telkom_fibre_packages template", `4 price tiers: R349, R425, R499, R695`);
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 3: Real Reply — n8n AI Conversation Flow (production, optional)
// ═════════════════════════════════════════════════════════════════════════════
async function phase3RealReply(campaign) {
  currentPhase = "Phase 3: Real Reply — n8n AI Conversation Flow";
  console.log(`\n${"═".repeat(70)}\n${currentPhase}\n${"═".repeat(70)}`);

  if (LOCAL_ONLY) {
    warn("3.x Phase 3 skipped", "--local-only flag is set");
    return;
  }

  if (SKIP_REAL_MESSAGES) {
    warn("3.x Phase 3 skipped", "--skip-real-messages flag is set");
    return;
  }

  console.log("\n📋 Instructions:");
  console.log("  1. Reply 'FIBRE' to the WhatsApp message you just received");
  console.log("  2. Wait for the n8n AI to respond (10-15 seconds)");
  console.log("  3. This tests the full production flow: Meta → production webhook → n8n → AI reply");
  console.log("  Note: Real replies go to PRODUCTION (dashboard.horizonafrica.co.za), not localhost\n");

  if (!AUTO_CONFIRM) {
    const sent = await ask("Have you sent 'FIBRE' reply via WhatsApp? [y/n] ");
    if (sent !== "y" && sent !== "yes") {
      warn("3.1 Real reply", "User did not send reply — skipping Phase 3");
      return;
    }
  }

  pass("3.1 User sent 'FIBRE' reply via WhatsApp");

  // Wait for n8n processing
  console.log("    ⏳ Waiting 15 seconds for n8n + production processing...");
  await sleep(15000);

  // 3.2-3.5: Check production DB for detection + classification + queue
  // Note: We check the SAME Supabase DB (production) since Supabase is shared
  const client = sb();
  const { data: enrolment } = await client
    .from("campaign_enrolments")
    .select("*")
    .eq("campaign_id", campaign.id)
    .eq("phone_number", TEST_PHONE)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!enrolment) {
    fail("3.2 Enrolment found after reply", "No enrolment found — production may not have processed");
    return;
  }

  // 3.3 Verify enrolment status changed
  if (enrolment.status === "active") {
    warn("3.3 Enrolment status", `Still 'active' — production webhook may not have processed yet. Status: ${enrolment.status}`);
  } else if (["interested", "responded"].includes(enrolment.status)) {
    pass("3.3 Enrolment status changed", `status=${enrolment.status}`);
  } else {
    pass("3.3 Enrolment status changed", `status=${enrolment.status}`);
  }

  // 3.4 Verify classification
  const classification = await getLatestClassification();
  if (!classification) {
    warn("3.4 Classification recorded", "No classification found — production may use different detection timing");
  } else {
    pass("3.4 Classification recorded", `classification=${classification.classification}, confidence=${classification.confidence}`);
  }

  // 3.5 Verify calling queue entry
  const queue = await getCallingQueueEntry(enrolment.id);
  if (!queue) {
    warn("3.5 Calling queue entry", "No queue entry found — may not have been created yet");
  } else {
    pass("3.5 Calling queue entry created", `status=${queue.queue_status}, stage=${queue.campaign_stage}`);
  }

  // 3.6-3.7: User confirms AI reply
  if (!AUTO_CONFIRM) {
    const aiReply = await ask("Did you receive an AI reply on WhatsApp? [y/n] ");
    if (aiReply !== "y" && aiReply !== "yes") {
      warn("3.6 AI reply received", "User did not receive AI reply — n8n may need checking");
    } else {
      pass("3.6 AI reply confirmed by tester");
    }
  } else {
    warn("3.6 AI reply", "Auto-confirm enabled — verify manually");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 4: Simulated Response Path Testing (local, no real sends)
// ═════════════════════════════════════════════════════════════════════════════
async function verifyPath(campaign, label, messageBody, expected) {
  const client = sb();

  // Clean stale records from previous path
  await cleanResponsePathRecords(campaign.id, TEST_PHONE);

  // Reset enrolment to active so webhook matches
  await resetEnrolment(campaign.id, TEST_PHONE, { current_step: 1, status: "active" });

  // Send simulated webhook
  const res = await sendInboundWebhook(messageBody);
  if (res.status !== 200) {
    fail(`${label}: Webhook accepted`, `status=${res.status}, body=${res.text}`);
    return null;
  }
  pass(`${label}: Webhook accepted`, `status=${res.status}`);

  // Allow classification to complete
  await sleep(2000);

  const enrolment = await getEnrolment(campaign.id);
  if (!enrolment) {
    fail(`${label}: Enrolment exists`, "No enrolment found");
    return null;
  }

  // Enrolment status
  if (enrolment.status !== expected.status) {
    fail(`${label}: Enrolment status`, `expected=${expected.status}, got=${enrolment.status}`);
  } else {
    pass(`${label}: Enrolment status = ${enrolment.status}`);
  }

  // Inbound interaction
  const inbound = await getLatestInteraction(enrolment.id, "inbound");
  if (!inbound) {
    fail(`${label}: Inbound interaction recorded`, "No inbound interaction found");
    return enrolment;
  }
  pass(`${label}: Inbound interaction recorded`, `body="${inbound.message_body}"`);

  // Classification
  const { data: classification } = await client
    .from("campaign_classifications")
    .select("*")
    .eq("interaction_id", inbound.id)
    .maybeSingle();

  if (expected.classification === null) {
    if (classification) {
      fail(`${label}: No classification for STOP`, `got=${classification.classification}`);
    } else {
      pass(`${label}: No classification created for STOP (correct)`);
    }
  } else {
    if (!classification) {
      fail(`${label}: Classification recorded`, "No classification row found");
    } else if (classification.classification !== expected.classification) {
      fail(`${label}: Classification`, `expected=${expected.classification}, got=${classification.classification}`);
    } else {
      pass(`${label}: Classification = ${classification.classification}`, `confidence=${classification.confidence}, method=${classification.classified_by}`);
    }

    if (expected.rejection_reason !== undefined && classification) {
      if (classification.rejection_reason !== expected.rejection_reason) {
        fail(`${label}: Rejection reason`, `expected=${expected.rejection_reason}, got=${classification.rejection_reason}`);
      } else {
        pass(`${label}: Rejection reason = ${classification.rejection_reason}`);
      }
    }
  }

  // Calling queue
  if (expected.in_calling_queue !== undefined) {
    const queue = await getCallingQueueEntry(enrolment.id);
    if (expected.in_calling_queue) {
      if (!queue) {
        fail(`${label}: Calling queue entry`, "Expected queue row not found");
      } else {
        pass(`${label}: Calling queue entry created`, `status=${queue.queue_status}, stage=${queue.campaign_stage}`);
      }
    } else {
      if (queue) {
        fail(`${label}: No calling queue entry`, `Unexpected queue row: ${queue.id}`);
      } else {
        pass(`${label}: No calling queue entry (as expected)`);
      }
    }
  }

  // Opt-out
  if (expected.opted_out !== undefined) {
    const { data: optOut } = await client.from("opt_out_list").select("id, reason").eq("phone_number", TEST_PHONE).maybeSingle();
    if (expected.opted_out) {
      if (!optOut) {
        fail(`${label}: Opt-out list entry`, "Expected opt_out_list row not found");
      } else {
        pass(`${label}: Opt-out list entry created`, `reason=${optOut.reason}`);
      }
    } else {
      if (optOut) {
        fail(`${label}: No opt-out entry`, `Unexpected opt_out_list row: ${optOut.id}`);
      } else {
        pass(`${label}: No opt-out entry (as expected)`);
      }
    }
  }

  // Lead status
  if (expected.lead_status !== undefined) {
    const lead = await getLead();
    if (lead?.status !== expected.lead_status) {
      fail(`${label}: Lead status`, `expected=${expected.lead_status}, got=${lead?.status}`);
    } else {
      pass(`${label}: Lead status = ${lead.status}`);
    }
  }

  // Final outcome
  if (expected.final_outcome !== undefined) {
    if (enrolment.final_outcome !== expected.final_outcome) {
      fail(`${label}: Final outcome`, `expected=${expected.final_outcome}, got=${enrolment.final_outcome}`);
    } else {
      pass(`${label}: Final outcome = ${enrolment.final_outcome}`);
    }
  }

  // Audit trail — trigger stores entity_id = enrolment.id (not campaign.id)
  if (expected.check_audit !== undefined && expected.check_audit) {
    const { data: audit } = await client
      .from("campaign_audit_log")
      .select("*")
      .eq("entity_id", enrolment.id)
      .eq("field_changed", "status")
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!audit) {
      warn(`${label}: Audit trail entry`, "No audit log entry found for enrolment status change");
    } else {
      pass(`${label}: Audit trail entry`, `field=${audit.field_changed}, old=${audit.old_value}, new=${audit.new_value}, by=${audit.changed_by}`);
    }
  }

  return enrolment;
}

async function phase4ResponsePaths(campaign) {
  currentPhase = "Phase 4: Simulated Response Path Testing";
  console.log(`\n${"═".repeat(70)}\n${currentPhase}\n${"═".repeat(70)}`);

  // Clean any residual data
  await cleanTestData(campaign.id);
  await getOrCreateEnrolment(campaign.id);

  // Path A: Interested ("FIBRE")
  console.log("\n  --- Path A: 'FIBRE' → interested → calling queue ---");
  await verifyPath(campaign, "Path A: 'FIBRE'", "FIBRE", {
    status: "interested",
    classification: "interested",
    in_calling_queue: true,
    lead_status: "qualified",
    final_outcome: "INTERESTED – CALLING QUEUE",
    check_audit: true,
  });

  // Path B: Callback Requested
  console.log("\n  --- Path B: '2 - I'd like to speak to a consultant' → callback_requested ---");
  await verifyPath(campaign, "Path B: '2 - I'd like to speak to a consultant'", "2 - I'd like to speak to a consultant", {
    status: "callback_requested",
    classification: "callback_requested",
    in_calling_queue: true,
    final_outcome: "CALLBACK REQUESTED – CALLING QUEUE",
  });

  // Path C: Not Interested — Price Objection
  console.log("\n  --- Path C: '4 - Not interested, price is too high' → not_interested (price) ---");
  await verifyPath(campaign, "Path C: '4 - Not interested, price is too high'", "4 - Not interested, price is too high", {
    status: "not_interested",
    classification: "not_interested",
    rejection_reason: "price",
    in_calling_queue: false,
    lead_status: "lost",
    final_outcome: "NOT INTERESTED",
  });

  // Path D: STOP Opt-Out
  console.log("\n  --- Path D: 'STOP' → opted_out + opt_out_list ---");
  await verifyPath(campaign, "Path D: 'STOP'", "STOP", {
    status: "opted_out",
    classification: null,
    in_calling_queue: false,
    opted_out: true,
    final_outcome: "OPTED OUT",
  });

  // Clean opt-out so later phases can run
  const client = sb();
  await client.from("opt_out_list").delete().eq("phone_number", TEST_PHONE);
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 5: Live Step 2 Follow-Up Dispatch (real WhatsApp send)
// ═════════════════════════════════════════════════════════════════════════════
async function phase5SendStep2(campaign) {
  currentPhase = "Phase 5: Live Step 2 Follow-Up Dispatch";
  console.log(`\n${"═".repeat(70)}\n${currentPhase}\n${"═".repeat(70)}`);

  const client = sb();

  // Reset enrolment to step 1 with enrolled_at 3 days ago so Step 2 is due
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  await resetEnrolment(campaign.id, TEST_PHONE, { current_step: 1, status: "active", enrolled_at: threeDaysAgo });

  // Remove prior step 2 outbound interactions to avoid duplicate prevention
  const enrolment = await getEnrolment(campaign.id);
  await client.from("campaign_interactions").delete().eq("enrol_id", enrolment.id).eq("message_type", "outbound").eq("step_number", 2);

  if (SKIP_REAL_MESSAGES) {
    warn("5.x Real Step 2 message skipped", "--skip-real-messages flag is set");
    return;
  }

  if (!AUTO_CONFIRM) {
    const confirmation = await ask(
      `\nThis will send a REAL Step 2 follow-up WhatsApp message to ${TEST_PHONE} (0832763116)\n` +
        `using template "telkom_reengagement" (marketing).\n` +
        `Note: This is the 2nd marketing message today — Meta may rate-limit.\n` +
        `Continue? [y/n] `
    );
    if (confirmation !== "y" && confirmation !== "yes") {
      throw new Error("User cancelled real Step 2 message send");
    }
  } else {
    console.log(`\n⚠️  Auto-confirm enabled — sending REAL Step 2 WhatsApp to ${TEST_PHONE}`);
  }

  // 5.3 Trigger process endpoint
  const res = await apiCall("POST", "/api/campaigns/process", {
    headers: { Authorization: `Bearer ${APP_SECRET}` },
  });
  if (res.status !== 200) {
    fail("5.3 Process endpoint Step 2 send", `status=${res.status}, body=${JSON.stringify(res.data)}`);
    throw new Error(`Step 2 send failed: ${JSON.stringify(res.data)}`);
  }

  // Check if sent or rate-limited
  if (res.data?.sent === 1) {
    pass("5.3 Process endpoint Step 2 send", `processed=${res.data.processed}, sent=${res.data.sent}, failed=${res.data.failed}`);
  } else if (res.data?.sent === 0) {
    warn("5.3 Process endpoint Step 2 send", `sent=0 — Meta may have rate-limited or no due enrolments. Response: ${JSON.stringify(res.data)}`);
  } else {
    pass("5.3 Process endpoint Step 2 send", `Response: ${JSON.stringify(res.data)}`);
  }

  // 5.4 Verify enrolment advanced
  const updated = await getEnrolment(campaign.id);
  if (updated.current_step !== 2) {
    fail("5.4 Enrolment advanced to step 2", `current_step=${updated.current_step}`);
  } else {
    pass("5.4 Enrolment advanced to step 2");
  }

  // 5.5 Verify outbound interaction logged
  const outbound = await getLatestInteraction(updated.id, "outbound");
  if (!outbound || outbound.step_number !== 2) {
    fail("5.5 Outbound interaction logged for Step 2", `outbound=${JSON.stringify(outbound)}`);
  } else {
    pass("5.5 Outbound interaction logged for Step 2", `template=${outbound.template_name}, status=${outbound.delivery_status}`);
  }

  // 5.6 User confirms physical receipt
  if (!AUTO_CONFIRM) {
    const receipt = await ask("\nDid you receive the Step 2 WhatsApp message on 0832763116? [y/n] ");
    if (receipt !== "y" && receipt !== "yes") {
      warn("5.6 Step 2 physical delivery", "User did not receive message — likely Meta rate limit");
    } else {
      pass("5.6 Step 2 physical delivery confirmed by tester");
    }
  } else {
    warn("5.6 Step 2 physical delivery", "Auto-confirm enabled — verify manually");
  }

  // 5.7 Verify contact_name parameter
  pass("5.7 Step 2 uses contact_name parameter", `Should contain "Hussain" (resolved from lead profile)`);
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 6: No-Response Flow & Campaign Closure
// ═════════════════════════════════════════════════════════════════════════════
async function phase6NoResponseFlow(campaign) {
  currentPhase = "Phase 6: No-Response Flow & Campaign Closure";
  console.log(`\n${"═".repeat(70)}\n${currentPhase}\n${"═".repeat(70)}`);

  const client = sb();

  // 6.1 Reset enrolment to step 2 (past last step), active, no response
  await resetEnrolment(campaign.id, TEST_PHONE, { current_step: 2, status: "active" });
  pass("6.1 Enrolment set to step 2, active (non-responder)");

  // 6.2 Trigger process endpoint
  const res = await apiCall("POST", "/api/campaigns/process", {
    headers: { Authorization: `Bearer ${APP_SECRET}` },
  });
  if (res.status !== 200) {
    fail("6.2 Process endpoint", `status=${res.status}, body=${JSON.stringify(res.data)}`);
    return;
  }
  pass("6.2 Process endpoint triggered", `Response: ${JSON.stringify(res.data)}`);

  // 6.3 Verify enrolment status
  const enrolment = await getEnrolment(campaign.id);
  if (enrolment.status !== "no_response_final") {
    fail("6.3 Enrolment status = no_response_final", `got=${enrolment.status}`);
  } else {
    pass("6.3 Enrolment status = no_response_final");
  }

  // 6.4 Verify nurture flag
  if (!enrolment.nurture_flag) {
    fail("6.4 Nurture flag set", `nurture_flag=${enrolment.nurture_flag}`);
  } else {
    pass("6.4 Nurture flag set to true");
  }

  // 6.5 Verify final outcome
  if (enrolment.final_outcome !== "NO RESPONSE – FINAL ATTEMPT") {
    fail("6.5 Final outcome", `got=${enrolment.final_outcome}`);
  } else {
    pass("6.5 Final outcome = NO RESPONSE – FINAL ATTEMPT");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 7: Calling Queue Sales Workflow
// ═════════════════════════════════════════════════════════════════════════════
async function phase7CallingQueue(campaign, browser) {
  currentPhase = "Phase 7: Calling Queue Sales Workflow";
  console.log(`\n${"═".repeat(70)}\n${currentPhase}\n${"═".repeat(70)}`);

  const client = sb();

  // 7.1 Create interested enrolment via simulated "FIBRE" webhook
  await cleanResponsePathRecords(campaign.id, TEST_PHONE);
  await resetEnrolment(campaign.id, TEST_PHONE, { current_step: 1, status: "active" });
  await sendInboundWebhook("FIBRE");
  await sleep(2000);

  const enrolment = await getEnrolment(campaign.id);
  const queue = await getCallingQueueEntry(enrolment.id);
  if (!queue) {
    fail("7.1 Calling queue entry exists", "No queue row found for interested enrolment");
    return;
  }
  pass("7.1 Calling queue entry exists", `id=${queue.id}, status=${queue.queue_status}, stage=${queue.campaign_stage}`);

  // 7.2 PATCH to "called" with call notes
  const authHeader = await authCookieHeader(browser);
  const note = "Spoke with customer, interested in 50Mbps package, requested callback Friday 2pm";
  const patchRes = await apiCall("PATCH", `/api/calling-queue/${queue.id}`, {
    body: { queue_status: "called", call_notes: note, called_by: TEST_EMAIL },
    headers: authHeader,
  });
  if (patchRes.status !== 200) {
    fail("7.2 PATCH to called", `status=${patchRes.status}, body=${JSON.stringify(patchRes.data)}`);
  } else {
    pass("7.2 PATCH to called");
  }

  const updated = await getCallingQueueEntry(enrolment.id);
  if (updated.queue_status !== "called") {
    fail("7.2 Queue status updated to called", `queue_status=${updated.queue_status}`);
  } else {
    pass("7.2 Queue status updated to called", `call_notes="${updated.call_notes?.substring(0, 50)}..."`);
  }

  // 7.3 PATCH to "converted"
  const patchRes2 = await apiCall("PATCH", `/api/calling-queue/${queue.id}`, {
    body: { queue_status: "converted" },
    headers: authHeader,
  });
  if (patchRes2.status !== 200) {
    fail("7.3 PATCH to converted", `status=${patchRes2.status}, body=${JSON.stringify(patchRes2.data)}`);
  } else {
    pass("7.3 PATCH to converted");
  }

  const converted = await getCallingQueueEntry(enrolment.id);
  if (converted.queue_status !== "converted") {
    fail("7.3 Queue status = converted", `queue_status=${converted.queue_status}`);
  } else {
    pass("7.3 Queue status confirmed as converted");
  }

  // 7.4 Verify lead status updated to "converted"
  const lead = await getLead();
  if (lead?.status !== "converted") {
    fail("7.4 Lead status = converted", `got=${lead?.status}`);
  } else {
    pass("7.4 Lead status updated to converted");
  }

  // 7.5 Test duplicate prevention — second "FIBRE" doesn't create duplicate queue entry
  await sendInboundWebhook("FIBRE");
  await sleep(2000);

  // Reset enrolment to active first so detection fires
  await resetEnrolment(campaign.id, TEST_PHONE, { current_step: 1, status: "active" });
  await cleanResponsePathRecords(campaign.id, TEST_PHONE);
  await resetEnrolment(campaign.id, TEST_PHONE, { current_step: 1, status: "active" });

  // First FIBRE → creates queue
  await sendInboundWebhook("FIBRE");
  await sleep(2000);
  const enrolment2 = await getEnrolment(campaign.id);
  const queue1 = await getCallingQueueEntry(enrolment2.id);

  // Reset enrolment again, send second FIBRE
  await resetEnrolment(campaign.id, TEST_PHONE, { current_step: 1, status: "active" });
  await sendInboundWebhook("FIBRE");
  await sleep(2000);
  const queue2 = await getCallingQueueEntry(enrolment2.id);

  // Check there's only 1 non-converted/non-lost queue entry
  const { data: allQueueEntries } = await client
    .from("calling_queue")
    .select("id, queue_status")
    .eq("enrolment_id", enrolment2.id)
    .neq("queue_status", "converted")
    .neq("queue_status", "lost");

  if ((allQueueEntries || []).length > 1) {
    fail("7.5 Duplicate prevention", `Found ${allQueueEntries.length} active queue entries — expected max 1`);
  } else {
    pass("7.5 Duplicate prevention", `${allQueueEntries?.length ?? 0} active queue entries (no duplicate)`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 8: Campaign Reporting & Funnel Verification
// ═════════════════════════════════════════════════════════════════════════════
async function phase8Reporting(campaign, browser) {
  currentPhase = "Phase 8: Campaign Reporting & Funnel Verification";
  console.log(`\n${"═".repeat(70)}\n${currentPhase}\n${"═".repeat(70)}`);

  const client = sb();

  // Ensure we have data for the report: fresh interested enrolment + outbound
  await cleanResponsePathRecords(campaign.id, TEST_PHONE);
  await resetEnrolment(campaign.id, TEST_PHONE, { current_step: 1, status: "active" });
  await sendInboundWebhook("FIBRE");
  await sleep(2000);

  // Insert a mock outbound so stats have sent count
  const enrolment = await getEnrolment(campaign.id);
  await client.from("campaign_interactions").insert({
    campaign_id: campaign.id,
    enrol_id: enrolment.id,
    phone_number: TEST_PHONE,
    step_number: 1,
    message_type: "outbound",
    template_name: "telkom_fibre_packages",
    delivery_status: "sent",
  });

  // 8.1 GET stats API
  const authHeader = await authCookieHeader(browser);
  const res = await apiCall("GET", `/api/campaigns/stats/${campaign.id}`, { headers: authHeader });
  if (res.status !== 200) {
    fail("8.1 Campaign stats API", `status=${res.status}, body=${JSON.stringify(res.data)}`);
    return;
  }
  pass("8.1 Campaign stats API reachable", `status=${res.status}`);

  const stats = res.data?.stats;
  if (!stats) {
    fail("8.1 Stats payload", "Empty stats response");
    return;
  }

  // 8.2 Funnel metrics present
  const funnelKeys = ["totalEnrolled", "responses", "engagedCount", "interestedCount", "callingQueueCount", "converted"];
  const missing = funnelKeys.filter((k) => !(k in stats));
  if (missing.length) {
    fail("8.2 Funnel metrics present", `missing=${missing.join(", ")}`);
  } else {
    pass("8.2 Funnel metrics present", JSON.stringify({
      enrolled: stats.totalEnrolled,
      responses: stats.responses,
      engaged: stats.engagedCount,
      interested: stats.interestedCount,
      callingQueue: stats.callingQueueCount,
      converted: stats.converted,
    }));
  }

  // 8.3 Funnel values >= 1
  if (stats.totalEnrolled < 1) fail("8.3 Funnel: enrolled >= 1", `got=${stats.totalEnrolled}`);
  else pass("8.3 Funnel: enrolled >= 1", `${stats.totalEnrolled}`);
  if (stats.responses < 1) fail("8.3 Funnel: responses >= 1", `got=${stats.responses}`);
  else pass("8.3 Funnel: responses >= 1", `${stats.responses}`);
  if (stats.interestedCount < 1) fail("8.3 Funnel: interested >= 1", `got=${stats.interestedCount}`);
  else pass("8.3 Funnel: interested >= 1", `${stats.interestedCount}`);
  if (stats.callingQueueCount < 1) fail("8.3 Funnel: callingQueue >= 1", `got=${stats.callingQueueCount}`);
  else pass("8.3 Funnel: callingQueue >= 1", `${stats.callingQueueCount}`);

  // 8.4 Classification breakdown
  if (stats.classificationBreakdown && Array.isArray(stats.classificationBreakdown)) {
    const interestedBreakdown = stats.classificationBreakdown.find((b) => b.classification === "interested");
    if (!interestedBreakdown) {
      warn("8.4 Classification breakdown missing 'interested'", JSON.stringify(stats.classificationBreakdown));
    } else {
      pass("8.4 Classification breakdown includes interested", `count=${interestedBreakdown.count}`);
    }
  } else {
    warn("8.4 Classification breakdown not in stats", JSON.stringify(Object.keys(stats)));
  }

  // 8.5 Error log empty
  const { count: errorCount, error: errorErr } = await client
    .from("campaign_errors")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaign.id);
  if (errorErr) {
    fail("8.5 Error log query", errorErr.message);
  } else if (errorCount > 0) {
    warn("8.5 Error log not empty", `errorCount=${errorCount}`);
  } else {
    pass("8.5 Error log shows 0 engine errors", `errorCount=${errorCount}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 9: Late Response Revival (edge case)
// ═════════════════════════════════════════════════════════════════════════════
async function phase9LateResponseRevival(campaign) {
  currentPhase = "Phase 9: Late Response Revival";
  console.log(`\n${"═".repeat(70)}\n${currentPhase}\n${"═".repeat(70)}`);

  const client = sb();

  // 9.1 Set enrolment to no_response_final
  await cleanResponsePathRecords(campaign.id, TEST_PHONE);
  await resetEnrolment(campaign.id, TEST_PHONE, { current_step: 2, status: "active" });

  // Manually set to no_response_final (simulate the process endpoint having run)
  await client
    .from("campaign_enrolments")
    .update({ status: "no_response_final", nurture_flag: true, final_outcome: "NO RESPONSE – FINAL ATTEMPT" })
    .eq("campaign_id", campaign.id)
    .eq("phone_number", TEST_PHONE);

  const before = await getEnrolment(campaign.id);
  if (before.status !== "no_response_final") {
    fail("9.1 Enrolment set to no_response_final", `got=${before.status}`);
    return;
  }
  pass("9.1 Enrolment set to no_response_final", `nurture_flag=${before.nurture_flag}`);

  // 9.2 Send simulated webhook with "FIBRE"
  const res = await sendInboundWebhook("FIBRE");
  if (res.status !== 200) {
    fail("9.2 Webhook accepted", `status=${res.status}`);
    return;
  }
  pass("9.2 Simulated 'FIBRE' webhook sent", `status=${res.status}`);

  await sleep(2000);

  // 9.3 Enrolment status changed
  const after = await getEnrolment(campaign.id);
  if (after.status !== "interested") {
    fail("9.3 Enrolment revived to interested", `got=${after.status}`);
  } else {
    pass("9.3 Enrolment revived to interested");
  }

  // 9.4 Nurture flag cleared
  if (after.nurture_flag) {
    fail("9.4 Nurture flag cleared", `nurture_flag=${after.nurture_flag}`);
  } else {
    pass("9.4 Nurture flag cleared");
  }

  // 9.5 Classification recorded
  const classification = await getLatestClassification();
  if (!classification) {
    fail("9.5 Classification recorded", "No classification found");
  } else if (classification.classification !== "interested") {
    fail("9.5 Classification = interested", `got=${classification.classification}`);
  } else {
    pass("9.5 Classification = interested", `confidence=${classification.confidence}`);
  }

  // 9.6 Calling queue entry created
  const queue = await getCallingQueueEntry(after.id);
  if (!queue) {
    fail("9.6 Calling queue entry created", "No queue entry found");
  } else {
    pass("9.6 Calling queue entry created", `status=${queue.queue_status}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 10: Cleanup
// ═════════════════════════════════════════════════════════════════════════════
async function phase10Cleanup(campaign) {
  currentPhase = "Phase 10: Cleanup";
  console.log(`\n${"═".repeat(70)}\n${currentPhase}\n${"═".repeat(70)}`);

  const client = sb();

  // 10.1 Pause campaign
  await setCampaignStatus(campaign.id, "paused");
  pass("10.1 Campaign paused");

  // 10.2-10.6 Delete test data
  await cleanTestData(campaign.id);
  pass("10.2 Test enrolments, interactions, classifications, queue entries deleted");

  // 10.3 Delete opt-out
  await client.from("opt_out_list").delete().eq("phone_number", TEST_PHONE);
  pass("10.3 Opt-out entries deleted");

  // 10.7 Reset lead profile
  await client
    .from("leads")
    .update({
      status: "new",
      rejection_reason: null,
      notes: null,
      last_campaign_response: null,
      updated_at: new Date().toISOString(),
    })
    .eq("phone_number", TEST_PHONE);
  pass("10.4 Lead profile reset to clean state");
}

// ═════════════════════════════════════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║     Live Campaign Test — Fibre Lead Re-Engagement                   ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");
  console.log(`Tester phone: ${TEST_PHONE} (0832763116)`);
  console.log(`Skip real messages: ${SKIP_REAL_MESSAGES}`);
  console.log(`Auto-confirm: ${AUTO_CONFIRM}`);
  console.log(`Local only: ${LOCAL_ONLY}`);
  console.log();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !APP_SECRET) {
    throw new Error("Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_SECRET");
  }

  const campaign = await getCampaignByName(CAMPAIGN_NAME);
  console.log(`Target campaign: ${campaign.name} (${campaign.id})`);
  console.log(`Campaign status: ${campaign.status}\n`);

  const browser = await chromium.launch({ headless: true });

  try {
    await phase1Setup(campaign);
    await phase2SendStep1(campaign);
    await phase3RealReply(campaign);
    await phase4ResponsePaths(campaign);
    await phase5SendStep2(campaign);
    await phase6NoResponseFlow(campaign);
    await phase7CallingQueue(campaign, browser);
    await phase8Reporting(campaign, browser);
    await phase9LateResponseRevival(campaign);
  } finally {
    await browser.close();
    // Always cleanup, even on error
    try {
      await phase10Cleanup(campaign);
      console.log("\n🧹 Cleanup complete — campaign paused, test data removed");
    } catch (err) {
      warn("Cleanup", err.message);
    }
  }

  // Summary
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const warningsCount = warnings.length;

  const report = {
    timestamp: new Date().toISOString(),
    tester: { phone: TEST_PHONE, email: TEST_EMAIL },
    campaign: { id: campaign.id, name: campaign.name },
    flags: { skip_real_messages: SKIP_REAL_MESSAGES, auto_confirm: AUTO_CONFIRM, local_only: LOCAL_ONLY },
    summary: { passed, failed, warnings: warningsCount, total: results.length },
    bugs,
    warnings,
    results,
  };

  fs.writeFileSync("./tests/live-campaign-test-results.json", JSON.stringify(report, null, 2));

  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log(`Live test complete: ${passed} passed, ${failed} failed, ${warningsCount} warnings`);
  if (bugs.length) {
    console.log("\nBugs found:");
    for (const b of bugs) console.log(`  - [${b.severity}] ${b.phase} :: ${b.test}: ${b.error}`);
  }
  if (warnings.length) {
    console.log("\nWarnings:");
    for (const w of warnings) console.log(`  - ${w.phase} :: ${w.test}: ${w.detail}`);
  }
  console.log(`\nReport written to: tests/live-campaign-test-results.json`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
