/**
 * Campaign Workflow Live Test Runner
 *
 * Executes the live test plan in /Users/muhammedhusseinismail/.devin/plans/plan-1d2c56ab7b173d30.md
 * for the "Fibre Lead Re-Engagement" campaign using the tester's live phone.
 *
 * Tester credentials:
 *   Phone: 0832763116 (normalized SA: 27832763116)
 *   Email: hussainismail703@gmail.com
 *
 * The runner:
 *   1. Resets the test enrolment and cleans stale test data.
 *   2. Activates the campaign and triggers /api/campaigns/process.
 *   3. Sends a REAL Step 1 WhatsApp message to 0832763116.
 *   4. Simulates inbound Meta webhooks to verify all 4 response paths:
 *        A. "FIBRE" -> interested -> calling queue
 *        B. "2 - I'd like to speak to a consultant" -> callback_requested -> calling queue
 *        C. "4 - Not interested, price is too high" -> not_interested (reason: price)
 *        D. "STOP" -> opted_out + opt_out_list
 *   5. Resets the enrolment and triggers Step 2 follow-up (real WhatsApp message).
 *   6. Tests the calling queue sales workflow via the protected API.
 *   7. Verifies campaign reporting / funnel metrics.
 *
 * Run:
 *   node --env-file=.env.local tests/campaign-workflow-live-test.mjs
 *
 * To skip real WhatsApp sends (dry-run the response/queue/report logic only):
 *   node --env-file=.env.local tests/campaign-workflow-live-test.mjs --skip-real-messages
 */

import { chromium } from "playwright";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import readline from "readline";

// ─── Env loading (fallback for environments without --env-file) ─────────────
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

const TEST_EMAIL = process.env.TEST_EMAIL || "hussainismail703@gmail.com";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "TestPass123!";
const TEST_PHONE = normalizePhone(process.env.TEST_PHONE || "0832763116");

const CAMPAIGN_NAME = "Fibre Lead Re-Engagement";
const CAMPAIGN_ID = "febe1cac-cf87-46c3-bbc7-160d3b96e28e"; // determined dynamically if available

const SCREENSHOT_DIR = "./tests/screenshots/campaign-workflow-live";
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const results = [];
const bugs = [];
const warnings = [];
let currentStep = "";

function record(status, name, extra) {
  const entry = { step: currentStep, test: name, status, ...extra };
  results.push(entry);
  return entry;
}
function pass(name, detail = "") {
  record("PASS", name, { detail });
  console.log(`    ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, error, severity = "bug") {
  record("FAIL", name, { error, severity });
  bugs.push({ step: currentStep, test: name, error, severity });
  console.log(`    ❌ ${name}: ${error}`);
}
function warn(name, detail) {
  record("WARN", name, { detail });
  warnings.push({ step: currentStep, test: name, detail });
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
    .select("id, phone_number, email, full_name")
    .single();
  if (error) throw new Error(`ensureTestLead failed: ${error.message}`);
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
  await client.from("campaign_audit_log").delete().eq("entity_id", campaignId);
  await client.from("campaign_errors").delete().eq("campaign_id", campaignId);
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

async function countOutboundsForStep(campaignId, phone, stepNumber) {
  const client = sb();
  const { data: enrolment } = await client
    .from("campaign_enrolments")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("phone_number", phone)
    .limit(1)
    .maybeSingle();
  if (!enrolment) return 0;
  const { count, error } = await client
    .from("campaign_interactions")
    .select("*", { count: "exact", head: true })
    .eq("enrol_id", enrolment.id)
    .eq("message_type", "outbound")
    .eq("step_number", stepNumber);
  if (error) throw new Error(`countOutboundsForStep failed: ${error.message}`);
  return count || 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ═════════════════════════════════════════════════════════════════════════════
// STEP 1: Pre-Test Setup & Lead Profile Initialisation
// ═════════════════════════════════════════════════════════════════════════════
async function step1Setup(campaign) {
  currentStep = "Step 1: Pre-Test Setup & Lead Profile Initialisation";
  console.log(`\n=== ${currentStep} ===`);

  try {
    // Verify campaign sequence matches the plan
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
    pass("Campaign sequence configuration matches plan", `Step 1: ${steps[0].template_name} (delay ${steps[0].delay_days}), Step 2: ${steps[1].template_name} (delay ${steps[1].delay_days})`);

    // Clean stale test data for the test phone and create/verify enrolment
    await cleanTestData(campaign.id);
    const enrolment = await getOrCreateEnrolment(campaign.id);
    await resetEnrolment(campaign.id);
    pass("Test enrolment created/reset", `id=${enrolment.id}, phone=${enrolment.phone_number}`);

    // Verify lead profile
    const lead = await getOrCreateTestLead();
    if (!lead.full_name || !lead.email) {
      throw new Error("Lead profile missing name or email");
    }
    pass("Lead profile initialised", `${lead.full_name} <${lead.email}>`);

    // Set campaign active
    await setCampaignStatus(campaign.id, "active");
    pass("Campaign status set to active");

    return enrolment;
  } catch (err) {
    fail("Setup", err.message, "blocker");
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 2: Live Message Dispatch — Step 1 (Initial Fibre Offer)
// ═════════════════════════════════════════════════════════════════════════════
async function step2SendStep1(campaign) {
  currentStep = "Step 2: Live Message Dispatch — Step 1 (Initial Fibre Offer)";
  console.log(`\n=== ${currentStep} ===`);

  // Ensure enrolment is fresh active / step 0
  await resetEnrolment(campaign.id);

  if (SKIP_REAL_MESSAGES) {
    warn("Real Step 1 message skipped", "--skip-real-messages flag is set");
    return;
  }

  if (!AUTO_CONFIRM) {
    const confirmation = await ask(
      `\nThis will send a REAL WhatsApp message to ${TEST_PHONE} (0832763116) using template "telkom_fibre_packages".\n` +
        `Continue? [y/n] `
    );
    if (confirmation !== "y" && confirmation !== "yes") {
      throw new Error("User cancelled real Step 1 message send");
    }
  } else {
    console.log(`\n⚠️  Auto-confirm enabled — sending REAL Step 1 WhatsApp to ${TEST_PHONE}`);
  }

  const res = await apiCall("POST", "/api/campaigns/process", {
    headers: { Authorization: `Bearer ${APP_SECRET}` },
  });
  if (res.status !== 200 || res.data?.sent !== 1) {
    fail("Process endpoint Step 1 send", `status=${res.status}, body=${JSON.stringify(res.data)}`);
    throw new Error(`Step 1 send failed: ${JSON.stringify(res.data)}`);
  }
  pass("Process endpoint Step 1 send", `processed=${res.data.processed}, sent=${res.data.sent}, failed=${res.data.failed}`);

  const enrolment = await getEnrolment(campaign.id);
  if (enrolment.current_step !== 1) {
    fail("Enrolment advanced to step 1", `current_step=${enrolment.current_step}`);
  } else {
    pass("Enrolment advanced to step 1");
  }

  const outbound = await getLatestInteraction(enrolment.id, "outbound");
  if (!outbound || outbound.step_number !== 1 || outbound.delivery_status !== "sent") {
    fail("Outbound interaction logged for Step 1", `outbound=${JSON.stringify(outbound)}`);
  } else {
    pass("Outbound interaction logged for Step 1", `template=${outbound.template_name}, status=${outbound.delivery_status}`);
  }

  if (!AUTO_CONFIRM) {
    const receipt = await ask("\nDid you receive the Step 1 WhatsApp message on 0832763116? [y/n] ");
    if (receipt !== "y" && receipt !== "yes") {
      fail("Step 1 physical delivery confirmation", "User did not receive message");
      throw new Error("Step 1 message not received - aborting live test");
    }
    pass("Step 1 physical delivery confirmed by tester");
  } else {
    warn("Step 1 physical delivery", "Auto-confirm enabled — Meta API returned sent status; physical receipt requires manual verification");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 3: Response Handling & Automated Classification (Paths A-D)
// ═════════════════════════════════════════════════════════════════════════════
async function sendInboundWebhook(messageBody) {
  const payload = metaWebhookPayload(TEST_PHONE, messageBody);
  const res = await http("POST", `${BASE_URL}/api/whatsapp-webhook`, { rawBody: JSON.stringify(payload) });
  return res;
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

async function verifyPath(campaign, label, messageBody, expected) {
  const client = sb();

  // Clean stale records from previous path so each path starts fresh
  await cleanResponsePathRecords(campaign.id, TEST_PHONE);

  // Reset enrolment to active so the webhook matches an active campaign enrolment
  await resetEnrolment(campaign.id, TEST_PHONE, { current_step: 1, status: "active" });

  const res = await sendInboundWebhook(messageBody);
  if (res.status !== 200) {
    fail(`${label}: Webhook accepted`, `status=${res.status}, body=${res.text}`);
    return null;
  }
  pass(`${label}: Webhook accepted`, `status=${res.status}`);

  // Allow classification to complete
  await sleep(1500);

  const enrolment = await getEnrolment(campaign.id);
  if (enrolment.status !== expected.status) {
    fail(`${label}: Enrolment status`, `expected=${expected.status}, got=${enrolment.status}`);
  } else {
    pass(`${label}: Enrolment status = ${enrolment.status}`);
  }

  const inbound = await getLatestInteraction(enrolment.id, "inbound");
  if (!inbound) {
    fail(`${label}: Inbound interaction recorded`, "No inbound interaction found");
    return enrolment;
  }
  pass(`${label}: Inbound interaction recorded`, `body=${inbound.message_body}`);

  // Look up classification tied to this specific inbound interaction
  const { data: classification } = await client
    .from("campaign_classifications")
    .select("*")
    .eq("interaction_id", inbound.id)
    .maybeSingle();

  if (expected.classification === null) {
    if (classification) {
      fail(`${label}: Classification should not be created for STOP`, `got=${classification.classification}`);
    } else {
      pass(`${label}: No classification created for STOP (correct)`);
    }
  } else {
    if (!classification) {
      fail(`${label}: Classification recorded`, "No classification row found for this interaction");
    } else if (classification.classification !== expected.classification) {
      fail(`${label}: Classification`, `expected=${expected.classification}, got=${classification.classification}`);
    } else {
      pass(`${label}: Classification = ${classification.classification}`, `confidence=${classification.confidence}, method=${classification.classified_by}`);
    }

    if (expected.rejection_reason !== undefined) {
      if (classification.rejection_reason !== expected.rejection_reason) {
        fail(`${label}: Rejection reason`, `expected=${expected.rejection_reason}, got=${classification.rejection_reason}`);
      } else {
        pass(`${label}: Rejection reason = ${classification.rejection_reason}`);
      }
    }
  }

  if (expected.in_calling_queue !== undefined) {
    const queue = await getCallingQueueEntry(enrolment.id);
    if (expected.in_calling_queue) {
      if (!queue) {
        fail(`${label}: Calling queue entry`, "Expected calling_queue row not found");
      } else {
        pass(`${label}: Calling queue entry created`, `status=${queue.queue_status}, stage=${queue.campaign_stage}`);
      }
    } else {
      if (queue) {
        fail(`${label}: Calling queue entry`, `Unexpected calling_queue row found: ${queue.id}`);
      } else {
        pass(`${label}: No calling queue entry (as expected)`);
      }
    }
  }

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
        fail(`${label}: Opt-out list entry`, `Unexpected opt_out_list row found: ${optOut.id}`);
      } else {
        pass(`${label}: No opt-out list entry (as expected)`);
      }
    }
  }

  return enrolment;
}

async function step3ResponsePaths(campaign) {
  currentStep = "Step 3: Response Handling & Automated Classification";
  console.log(`\n=== ${currentStep} ===`);

  // Clean any residual classifications / opt-outs for a clean run
  await cleanTestData(campaign.id);
  await getOrCreateEnrolment(campaign.id);

  // Path A: Positive interest
  await verifyPath(campaign, "Path A: 'FIBRE'", "FIBRE", {
    status: "interested",
    classification: "interested",
    in_calling_queue: true,
  });

  // Path B: Callback request
  await verifyPath(campaign, "Path B: '2 - I'd like to speak to a consultant'", "2 - I'd like to speak to a consultant", {
    status: "callback_requested",
    classification: "callback_requested",
    in_calling_queue: true,
  });

  // Path C: Price objection
  await verifyPath(campaign, "Path C: '4 - Not interested, price is too high'", "4 - Not interested, price is too high", {
    status: "not_interested",
    classification: "not_interested",
    rejection_reason: "price",
    in_calling_queue: false,
  });

  // Path D: STOP opt-out
  await verifyPath(campaign, "Path D: 'STOP'", "STOP", {
    status: "opted_out",
    classification: null, // STOP is handled by detection; classifyResponse is skipped
    in_calling_queue: false,
    opted_out: true,
  });

  // Note: STOP path stops future sends. Clean opt-out so later steps can run.
  const client = sb();
  await client.from("opt_out_list").delete().eq("phone_number", TEST_PHONE);
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 4: Step 2 Follow-Up Dispatch (Non-Responder Path)
// ═════════════════════════════════════════════════════════════════════════════
async function step4SendStep2(campaign) {
  currentStep = "Step 4: Step 2 Follow-Up Dispatch (Non-Responder Path)";
  console.log(`\n=== ${currentStep} ===`);

  const client = sb();

  // Reset enrolment to step 1 with an enrolled_at 3 days ago so Step 2 is due
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  await resetEnrolment(campaign.id, TEST_PHONE, { current_step: 1, status: "active", enrolled_at: threeDaysAgo });

  // Remove prior outbound interactions for step 2 to avoid duplicate-prevention blocking
  const enrolment = await getEnrolment(campaign.id);
  await client.from("campaign_interactions").delete().eq("enrol_id", enrolment.id).eq("message_type", "outbound").eq("step_number", 2);

  if (SKIP_REAL_MESSAGES) {
    warn("Real Step 2 message skipped", "--skip-real-messages flag is set");
    return;
  }

  if (!AUTO_CONFIRM) {
    const confirmation = await ask(
      `\nThis will send a REAL Step 2 follow-up WhatsApp message to ${TEST_PHONE} (0832763116) using template "telkom_reengagement".\n` +
        `Continue? [y/n] `
    );
    if (confirmation !== "y" && confirmation !== "yes") {
      throw new Error("User cancelled real Step 2 message send");
    }
  } else {
    console.log(`\n⚠️  Auto-confirm enabled — sending REAL Step 2 WhatsApp to ${TEST_PHONE}`);
  }

  const res = await apiCall("POST", "/api/campaigns/process", {
    headers: { Authorization: `Bearer ${APP_SECRET}` },
  });
  if (res.status !== 200 || res.data?.sent !== 1) {
    fail("Process endpoint Step 2 send", `status=${res.status}, body=${JSON.stringify(res.data)}`);
    throw new Error(`Step 2 send failed: ${JSON.stringify(res.data)}`);
  }
  pass("Process endpoint Step 2 send", `processed=${res.data.processed}, sent=${res.data.sent}, failed=${res.data.failed}`);

  const updated = await getEnrolment(campaign.id);
  if (updated.current_step !== 2) {
    fail("Enrolment advanced to step 2", `current_step=${updated.current_step}`);
  } else {
    pass("Enrolment advanced to step 2");
  }

  const outbound = await getLatestInteraction(updated.id, "outbound");
  if (!outbound || outbound.step_number !== 2 || outbound.delivery_status !== "sent") {
    fail("Outbound interaction logged for Step 2", `outbound=${JSON.stringify(outbound)}`);
  } else {
    pass("Outbound interaction logged for Step 2", `template=${outbound.template_name}, status=${outbound.delivery_status}`);
  }

  if (!AUTO_CONFIRM) {
    const receipt = await ask("\nDid you receive the Step 2 WhatsApp message on 0832763116? [y/n] ");
    if (receipt !== "y" && receipt !== "yes") {
      fail("Step 2 physical delivery confirmation", "User did not receive message");
    } else {
      pass("Step 2 physical delivery confirmed by tester");
    }
  } else {
    warn("Step 2 physical delivery", "Auto-confirm enabled — Meta API returned sent status; physical receipt requires manual verification");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 5: Calling Queue Sales Workflow
// ═════════════════════════════════════════════════════════════════════════════
async function step5CallingQueue(campaign, browser) {
  currentStep = "Step 5: Calling Queue Sales Workflow";
  console.log(`\n=== ${currentStep} ===`);

  const client = sb();

  // Ensure we have an interested enrolment with a queue entry
  await resetEnrolment(campaign.id, TEST_PHONE, { current_step: 1, status: "active" });
  await sendInboundWebhook("FIBRE");
  await sleep(1500);

  const enrolment = await getEnrolment(campaign.id);
  const queue = await getCallingQueueEntry(enrolment.id);
  if (!queue) {
    fail("Calling queue entry exists", "No calling_queue row found for interested enrolment");
    return;
  }
  pass("Calling queue entry exists", `id=${queue.id}, status=${queue.queue_status}, stage=${queue.campaign_stage}`);

  // Use auth cookie for protected PATCH
  const authHeader = await authCookieHeader(browser);
  const note = "Spoke with customer, interested in 50Mbps package, requested callback Friday 2pm";
  const patchRes = await apiCall("PATCH", `/api/calling-queue/${queue.id}`, {
    body: { queue_status: "called", call_notes: note, called_by: TEST_EMAIL },
    headers: authHeader,
  });
  if (patchRes.status !== 200) {
    fail("Calling queue PATCH to called", `status=${patchRes.status}, body=${JSON.stringify(patchRes.data)}`);
  } else {
    pass("Calling queue PATCH to called");
  }

  const updated = await getCallingQueueEntry(enrolment.id);
  if (updated.queue_status !== "called") {
    fail("Calling queue status updated", `queue_status=${updated.queue_status}`);
  } else {
    pass("Calling queue status updated to called", `call_notes=${updated.call_notes}`);
  }

  const patchRes2 = await apiCall("PATCH", `/api/calling-queue/${queue.id}`, {
    body: { queue_status: "converted" },
    headers: authHeader,
  });
  if (patchRes2.status !== 200) {
    fail("Calling queue PATCH to converted", `status=${patchRes2.status}, body=${JSON.stringify(patchRes2.data)}`);
  } else {
    pass("Calling queue PATCH to converted");
  }

  const converted = await getCallingQueueEntry(enrolment.id);
  if (converted.queue_status !== "converted") {
    fail("Calling queue converted status", `queue_status=${converted.queue_status}`);
  } else {
    pass("Calling queue converted status confirmed");
  }

  const { data: lead } = await client.from("leads").select("status").eq("id", enrolment.lead_id).single();
  if (lead?.status !== "converted") {
    fail("Lead status updated to converted", `status=${lead?.status}`);
  } else {
    pass("Lead status updated to converted");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 6: Campaign Performance Reporting & Funnel Verification
// ═════════════════════════════════════════════════════════════════════════════
async function step6Reporting(campaign, browser) {
  currentStep = "Step 6: Campaign Performance Reporting & Funnel Verification";
  console.log(`\n=== ${currentStep} ===`);

  // Re-create a fresh interested enrolment so report funnel has expected numbers
  await resetEnrolment(campaign.id, TEST_PHONE, { current_step: 1, status: "active" });
  await sendInboundWebhook("FIBRE");
  await sleep(1500);
  await resetEnrolment(campaign.id, TEST_PHONE, { current_step: 0, status: "active" });
  // Send an outbound step 1 for this enrolment so stats have sent count
  const client = sb();
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

  const authHeader = await authCookieHeader(browser);
  const res = await apiCall("GET", `/api/campaigns/stats/${campaign.id}`, { headers: authHeader });
  if (res.status !== 200) {
    fail("Campaign stats API", `status=${res.status}, body=${JSON.stringify(res.data)}`);
    return;
  }
  pass("Campaign stats API reachable", `status=${res.status}`);

  const stats = res.data?.stats;
  if (!stats) {
    fail("Campaign stats payload", "Empty stats response");
    return;
  }

  // Verify funnel contains expected keys
  // Note: the report UI Sales Funnel uses `responses` (total inbound messages)
  // for the "Responses" step, not `respondedEnrolled` which only counts current
  // status='responded' enrolments. Response statuses are overwritten to the final
  // classification (interested, callback_requested, not_interested, opted_out).
  const funnelKeys = ["totalEnrolled", "responses", "engagedCount", "interestedCount", "callingQueueCount", "converted"];
  const missing = funnelKeys.filter((k) => !(k in stats));
  if (missing.length) {
    fail("Funnel metrics present", `missing=${missing.join(", ")}`);
  } else {
    pass("Funnel metrics present", JSON.stringify({
      enrolled: stats.totalEnrolled,
      responses: stats.responses,
      engaged: stats.engagedCount,
      interested: stats.interestedCount,
      callingQueue: stats.callingQueueCount,
      converted: stats.converted,
    }));
  }

  // Verify at least 1 enrolled, 1 response, 1 interested, 1 calling queue
  if (stats.totalEnrolled < 1) fail("Funnel: enrolled >= 1", `got=${stats.totalEnrolled}`);
  else pass("Funnel: enrolled >= 1", stats.totalEnrolled);
  if (stats.responses < 1) fail("Funnel: responses >= 1", `got=${stats.responses}`);
  else pass("Funnel: responses >= 1", stats.responses);
  if (stats.interestedCount < 1) fail("Funnel: interested >= 1", `got=${stats.interestedCount}`);
  else pass("Funnel: interested >= 1", stats.interestedCount);
  if (stats.callingQueueCount < 1) fail("Funnel: callingQueue >= 1", `got=${stats.callingQueueCount}`);
  else pass("Funnel: callingQueue >= 1", stats.callingQueueCount);

  // Check classification breakdown
  if (stats.classificationBreakdown && Array.isArray(stats.classificationBreakdown)) {
    const interestedBreakdown = stats.classificationBreakdown.find((b) => b.classification === "interested");
    if (!interestedBreakdown) {
      warn("Classification breakdown missing 'interested'", JSON.stringify(stats.classificationBreakdown));
    } else {
      pass("Classification breakdown includes interested", `count=${interestedBreakdown.count}`);
    }
  } else {
    warn("Classification breakdown not in stats payload", JSON.stringify(Object.keys(stats)));
  }

  // Check error log has 0 engine errors
  const { count: errorCount, error: errorErr } = await client
    .from("campaign_errors")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaign.id);
  if (errorErr) {
    fail("Error log query", errorErr.message);
  } else if (errorCount > 0) {
    warn("Error log not empty", `errorCount=${errorCount}`);
  } else {
    pass("Error log shows 0 engine errors", `errorCount=${errorCount}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("Campaign Workflow Live Test Runner");
  console.log(`Tester phone: ${TEST_PHONE} | Skip real messages: ${SKIP_REAL_MESSAGES}\n`);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !APP_SECRET) {
    throw new Error("Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_SECRET");
  }

  const campaign = await getCampaignByName(CAMPAIGN_NAME);
  console.log(`Target campaign: ${campaign.name} (${campaign.id})`);

  const browser = await chromium.launch({ headless: true });

  try {
    const enrolment = await step1Setup(campaign);
    await step2SendStep1(campaign);
    await step3ResponsePaths(campaign);
    await step4SendStep2(campaign);
    await step5CallingQueue(campaign, browser);
    await step6Reporting(campaign, browser);
  } finally {
    await browser.close();
    // Pause campaign and clean test data so no accidental real sends occur after the run
    try {
      await setCampaignStatus(campaign.id, "paused");
      await cleanTestData(campaign.id);
      console.log("\n🧹 Campaign paused and test data cleaned");
    } catch (err) {
      warn("Cleanup", err.message);
    }
  }

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const warningsCount = warnings.length;

  const report = {
    timestamp: new Date().toISOString(),
    tester: { phone: TEST_PHONE, email: TEST_EMAIL },
    campaign: { id: campaign.id, name: campaign.name },
    skip_real_messages: SKIP_REAL_MESSAGES,
    summary: { passed, failed, warnings: warningsCount, total: results.length },
    bugs,
    warnings,
    results,
  };

  fs.writeFileSync("./tests/campaign-workflow-live-results.json", JSON.stringify(report, null, 2));
  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log(`Live test complete: ${passed} passed, ${failed} failed, ${warningsCount} warnings`);
  if (bugs.length) {
    console.log("\nBugs found:");
    for (const b of bugs) console.log(`  - [${b.severity}] ${b.step} :: ${b.test}: ${b.error}`);
  }
  console.log(`Report written to: tests/campaign-workflow-live-results.json`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
