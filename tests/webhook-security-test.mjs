#!/usr/bin/env node
/**
 * Webhook Security & Hardening Test Suite
 *
 * Verifies the /api/whatsapp-webhook hardening:
 *   A — Meta signature verification (X-Hub-Signature-256)
 *   B — Delivery idempotency (wamid replay protection)
 *   C — Non-text message type extraction
 *   D — Delivery-status callback handling
 *   E — Edge cases + scheduler heartbeat
 *
 * Uses a dedicated fictional test phone (27991112233) so the real test lead's
 * campaign state is never touched.
 *
 * Usage:
 *   node --env-file=.env.local tests/webhook-security-test.mjs
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.TEST_TARGET || "http://localhost:3000";
const APP_SECRET = process.env.META_APP_SECRET || "";
const ENFORCED = process.env.META_WEBHOOK_ENFORCE_SIGNATURE === "true";
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "horizon_africa_verify_2026";
const APP_SECRET_TOKEN = process.env.APP_SECRET;

const TEST_PHONE = "27991112233"; // fictional — never a real lead
const CAMPAIGN_ID = "febe1cac-cf87-46c3-bbc7-160d3b96e28e";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

// ─── Reporting ──────────────────────────────────────────────────────────────
const results = [];
function pass(name, detail = "") {
  results.push({ name, status: "PASS", detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  results.push({ name, status: "FAIL", detail });
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
}
function warn(name, detail = "") {
  results.push({ name, status: "WARN", detail });
  console.log(`  ⚠️  ${name}${detail ? ` — ${detail}` : ""}`);
}

// ─── Supabase REST helper ────────────────────────────────────────────────────
async function sb(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

// ─── Webhook helpers ─────────────────────────────────────────────────────────
function metaMessage(overrides = {}) {
  return {
    from: TEST_PHONE,
    id: `wamid.${crypto.randomUUID()}`,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    type: "text",
    text: { body: "hello" },
    ...overrides,
  };
}

function metaPayload(message) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba_test",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "27 75 777 4389", phone_number_id: "1257101724147822" },
              contacts: [{ profile: { name: "Webhook Test" }, wa_id: TEST_PHONE }],
              messages: [message],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

function metaStatusPayload(status) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba_test",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "27 75 777 4389", phone_number_id: "1257101724147822" },
              statuses: [status],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

/** POST to the webhook. `sig` controls the signature header: "valid" | "invalid" | "none" | a raw string. */
async function postWebhook(rawBody, sig = "valid") {
  let headers = { "Content-Type": "application/json" };
  if (sig === "valid") headers = { ...headers, ...webhookHeaders(rawBody) };
  else if (sig === "invalid") headers["x-hub-signature-256"] = "sha256=" + "0".repeat(64);
  else if (sig === "wrong-secret")
    headers["x-hub-signature-256"] =
      "sha256=" + crypto.createHmac("sha256", "not-the-real-secret").update(rawBody, "utf8").digest("hex");
  else if (sig !== "none") headers["x-hub-signature-256"] = sig; // raw header value

  const res = await fetch(`${BASE_URL}/api/whatsapp-webhook`, {
    method: "POST",
    headers,
    body: rawBody,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* n8n may return text */ }
  return { status: res.status, text, json };
}

// ─── DB helpers ──────────────────────────────────────────────────────────────
async function cleanTestData() {
  await sb(`/campaign_classifications?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await sb(`/calling_queue?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await sb(`/campaign_interactions?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await sb(`/campaign_enrolments?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await sb(`/opt_out_list?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await sb(`/inbound_webhook_messages?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await sb(`/message_delivery_failures?recipient_phone=eq.${TEST_PHONE}`, { method: "DELETE" });
  await sb(`/campaign_errors?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
}

async function createActiveEnrolment() {
  await sb(`/campaign_enrolments?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  const res = await sb(`/campaign_enrolments`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      campaign_id: CAMPAIGN_ID,
      phone_number: TEST_PHONE,
      current_step: 1,
      status: "active",
      enrolled_at: new Date().toISOString(),
    }),
  });
  const rows = await res.json();
  return rows?.[0];
}

async function resetEnrolmentActive(enrolId) {
  await sb(`/campaign_enrolments?id=eq.${enrolId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "active", final_outcome: null }),
  });
}

async function getEnrolment(enrolId) {
  const res = await sb(`/campaign_enrolments?id=eq.${enrolId}&select=*`);
  const rows = await res.json();
  return rows?.[0];
}

async function getInteractions(enrolId) {
  const res = await sb(
    `/campaign_interactions?enrol_id=eq.${enrolId}&message_type=eq.inbound&order=created_at.desc&select=*`
  );
  return (await res.json()) ?? [];
}

async function getDedupeRow(wamid) {
  const res = await sb(`/inbound_webhook_messages?wamid=eq.${encodeURIComponent(wamid)}&select=*`);
  const rows = await res.json();
  return rows?.[0];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  WEBHOOK SECURITY & HARDENING TEST SUITE");
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Signature enforcement: ${ENFORCED ? "ON" : "OFF (soft mode)"}`);
  console.log(`  META_APP_SECRET: ${APP_SECRET ? "configured" : "NOT SET — signature tests will be skipped"}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  await cleanTestData();
  const enrolment = await createActiveEnrolment();
  if (!enrolment?.id) {
    console.error("Could not create test enrolment — aborting");
    process.exit(1);
  }

  // ────────────────────────────────────────────────────────────────────────
  // MODULE A — Signature verification
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Module A: Signature Verification ──");

  // A1: GET verify — correct token
  {
    const res = await fetch(
      `${BASE_URL}/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(VERIFY_TOKEN)}&hub.challenge=ch_12345`
    );
    const text = await res.text();
    if (res.status === 200 && text === "ch_12345") pass("A1 GET verify with correct token echoes challenge");
    else fail("A1 GET verify correct token", `status=${res.status} body=${text.slice(0, 80)}`);
  }

  // A2: GET verify — wrong token
  {
    const res = await fetch(
      `${BASE_URL}/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=definitely-wrong&hub.challenge=ch_x`
    );
    if (res.status === 403) pass("A2 GET verify with wrong token → 403");
    else fail("A2 GET verify wrong token", `status=${res.status}`);
  }

  // A3: GET verify — missing params
  {
    const res = await fetch(`${BASE_URL}/api/whatsapp-webhook`);
    if (res.status === 403) pass("A3 GET verify missing params → 403");
    else fail("A3 GET verify missing params", `status=${res.status}`);
  }

  const sampleRaw = JSON.stringify(metaPayload(metaMessage({ text: { body: "sig test" } })));

  if (!APP_SECRET) {
    warn("A4–A9 signature tests", "META_APP_SECRET not configured — server is in soft mode, skipping");
  } else {
    // A4: no signature header
    {
      const res = await postWebhook(sampleRaw, "none");
      if (ENFORCED) {
        if (res.status === 401) pass("A4 POST without signature → 401 (enforced)");
        else fail("A4 unsigned POST not rejected", `status=${res.status}`);
      } else {
        if (res.status !== 401) pass("A4 unsigned POST allowed in soft mode", `status=${res.status}`);
        else fail("A4 soft mode", `unexpected 401 while enforcement off`);
      }
    }

    // A5: garbage signature
    {
      const res = await postWebhook(sampleRaw, "invalid");
      if (ENFORCED) {
        if (res.status === 401) pass("A5 POST with invalid signature → 401");
        else fail("A5 invalid signature not rejected", `status=${res.status}`);
      } else {
        pass("A5 invalid signature logged, allowed (soft mode)", `status=${res.status}`);
      }
    }

    // A6: signature without sha256= prefix
    {
      const res = await postWebhook(sampleRaw, crypto.randomBytes(32).toString("hex"));
      if (ENFORCED) {
        if (res.status === 401) pass("A6 signature missing sha256= prefix → 401");
        else fail("A6 prefix-less signature", `status=${res.status}`);
      } else pass("A6 prefix-less signature allowed (soft mode)", `status=${res.status}`);
    }

    // A7: signature computed with wrong secret
    {
      const res = await postWebhook(sampleRaw, "wrong-secret");
      if (ENFORCED) {
        if (res.status === 401) pass("A7 signature from wrong secret → 401");
        else fail("A7 wrong-secret signature", `status=${res.status}`);
      } else pass("A7 wrong-secret signature allowed (soft mode)", `status=${res.status}`);
    }

    // A8: valid signature → forwarded
    {
      const res = await postWebhook(sampleRaw, "valid");
      if (res.status !== 401 && res.status !== 403) pass("A8 valid signature accepted", `status=${res.status}`);
      else fail("A8 valid signature rejected", `status=${res.status}`);
    }

    // A9: signed malformed JSON → must not 500
    {
      const raw = `{"entry": [{"changes": broken`;
      const res = await postWebhook(raw, "valid");
      if (res.status === 500) fail("A9 signed malformed JSON", "500 error");
      else pass("A9 signed malformed JSON handled", `status=${res.status}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // MODULE B — Idempotency / replay protection
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Module B: Idempotency (wamid replay) ──");

  const replayWamid = `wamid.replay-${crypto.randomUUID()}`;
  {
    await resetEnrolmentActive(enrolment.id);
    const before = (await getInteractions(enrolment.id)).length;
    const payload = metaPayload(metaMessage({ id: replayWamid, text: { body: "first delivery" } }));
    const raw = JSON.stringify(payload);
    const r1 = await postWebhook(raw, "valid");
    await sleep(2000);

    const interactions1 = await getInteractions(enrolment.id);
    const marker = await getDedupeRow(replayWamid);

    if (r1.status !== 401 && interactions1.length === before + 1) {
      pass("B1 first delivery recorded interaction", `status=${r1.status}`);
    } else if (r1.status === 401 && ENFORCED && !APP_SECRET) {
      warn("B1", "rejected — secret mismatch");
    } else {
      fail("B1 first delivery", `status=${r1.status} interactions ${before}→${interactions1.length}`);
    }

    if (marker) pass("B2 wamid marked delivered in inbound_webhook_messages");
    else warn("B2 wamid marker", "not found — dedupe unavailable?");

    // Replay the EXACT same payload
    const r2 = await postWebhook(raw, "valid");
    await sleep(1000);
    const interactions2 = await getInteractions(enrolment.id);

    if (r2.json?.duplicate === true) pass("B3 replay returns duplicate:true");
    else warn("B3 replay response", `body=${r2.text.slice(0, 120)}`);

    if (interactions2.length === interactions1.length) {
      pass("B4 replay created no duplicate interaction");
    } else {
      fail("B4 replay duplication", `interactions ${interactions1.length} → ${interactions2.length}`);
    }
  }

  // B5: different wamid = new delivery
  {
    await resetEnrolmentActive(enrolment.id);
    const payload = metaPayload(metaMessage({ text: { body: "different message" } }));
    const r = await postWebhook(JSON.stringify(payload), "valid");
    await sleep(2000);
    const interactions = await getInteractions(enrolment.id);
    if (interactions.length >= 2) pass("B5 different wamid processed as new message", `count=${interactions.length}`);
    else fail("B5 new wamid not recorded", `count=${interactions.length} status=${r.status}`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // MODULE C — Non-text message types
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Module C: Non-text message types ──");

  const typeCases = [
    {
      name: "C1 image with caption",
      msg: { type: "image", image: { caption: "my address photo", mime_type: "image/jpeg", id: "media1" }, text: undefined },
      expectType: "image",
      expectBody: "[Image] my address photo",
    },
    {
      name: "C2 voice note (audio)",
      msg: { type: "audio", audio: { id: "aud1", mime_type: "audio/ogg" }, text: undefined },
      expectType: "audio",
      expectBody: "[Voice note]",
    },
    {
      name: "C3 location pin",
      msg: {
        type: "location",
        location: { latitude: -26.2041, longitude: 28.0473, name: "Home", address: "44 4th Avenue Mayfair" },
        text: undefined,
      },
      expectType: "location",
      expectBody: "44 4th Avenue Mayfair",
    },
    {
      name: "C4 document",
      msg: { type: "document", document: { filename: "id-copy.pdf", id: "doc1" }, text: undefined },
      expectType: "document",
      expectBody: "[Document] id-copy.pdf",
    },
    {
      name: "C5 button reply",
      msg: { type: "button", button: { text: "Yes, interested", payload: "BTN1" }, text: undefined },
      expectType: "button",
      expectBody: "Yes, interested",
    },
    {
      name: "C6 interactive list reply",
      msg: {
        type: "interactive",
        interactive: { type: "list_reply", list_reply: { id: "L1", title: "50 Mbps package" } },
        text: undefined,
      },
      expectType: "interactive",
      expectBody: "50 Mbps package",
    },
    {
      name: "C7 sticker",
      msg: { type: "sticker", sticker: { id: "stk1", mime_type: "image/webp" }, text: undefined },
      expectType: "sticker",
      expectBody: "[Sticker]",
    },
    {
      name: "C8 contact share",
      msg: {
        type: "contacts",
        contacts: [{ name: { formatted_name: "Sipho Ndlovu" }, phones: [{ phone: "0821234567" }] }],
        text: undefined,
      },
      expectType: "contacts",
      expectBody: "Sipho Ndlovu",
    },
  ];

  for (const tc of typeCases) {
    await resetEnrolmentActive(enrolment.id);
    const before = (await getInteractions(enrolment.id)).length;
    const message = metaMessage({ id: `wamid.${crypto.randomUUID()}`, ...tc.msg });
    delete message.text;
    const r = await postWebhook(JSON.stringify(metaPayload(message)), "valid");
    await sleep(2500);
    const interactions = await getInteractions(enrolment.id);
    const latest = interactions[0];

    if (r.status === 401) {
      fail(tc.name, "webhook rejected — check signature setup");
      continue;
    }
    if (interactions.length > before && latest?.content_type === tc.expectType) {
      if (latest.message_body?.includes(tc.expectBody)) {
        pass(tc.name, `type=${latest.content_type} body="${latest.message_body.slice(0, 60)}"`);
      } else {
        fail(tc.name, `body="${latest.message_body}" missing "${tc.expectBody}"`);
      }
    } else {
      fail(tc.name, `interactions ${before}→${interactions.length}, content_type=${latest?.content_type}`);
    }
  }

  // C9: empty text body — interaction recorded, enrolment NOT marked responded
  {
    await resetEnrolmentActive(enrolment.id);
    const message = metaMessage({ id: `wamid.${crypto.randomUUID()}`, text: { body: "" } });
    await postWebhook(JSON.stringify(metaPayload(message)), "valid");
    await sleep(2000);
    const e = await getEnrolment(enrolment.id);
    const interactions = await getInteractions(enrolment.id);
    const emptyRec = interactions.find((i) => i.message_body === "" || i.message_body === null);
    if (e?.status === "active" && emptyRec) {
      pass("C9 empty body records interaction but keeps enrolment active");
    } else if (e?.status === "active") {
      warn("C9 empty body", "enrolment active but no interaction row found");
    } else {
      fail("C9 empty body marked enrolment responded", `status=${e?.status}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // MODULE D — Delivery status callbacks
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Module D: Delivery status callbacks ──");

  {
    const failedStatus = {
      id: `wamid.fail-${crypto.randomUUID()}`,
      status: "failed",
      timestamp: Math.floor(Date.now() / 1000).toString(),
      recipient_id: TEST_PHONE,
      errors: [
        {
          code: 131049,
          title: "Marketing message rate limit",
          message: "Message not delivered",
          error_data: { details: "Per-user marketing template limit reached" },
        },
      ],
    };
    const r = await postWebhook(JSON.stringify(metaStatusPayload(failedStatus)), "valid");
    await sleep(1500);
    const res = await sb(
      `/message_delivery_failures?message_id=eq.${encodeURIComponent(failedStatus.id)}&select=*`
    );
    const rows = (await res.json()) ?? [];
    if (rows.length > 0 && rows[0].error_code === 131049) {
      pass("D1 failed status callback → message_delivery_failures row", `code=${rows[0].error_code}`);
    } else {
      fail("D1 delivery failure not recorded", `status=${r.status} rows=${rows.length}`);
    }
  }

  {
    // Non-failure statuses produce no failure rows and no interactions
    const okStatus = {
      id: `wamid.ok-${crypto.randomUUID()}`,
      status: "delivered",
      timestamp: Math.floor(Date.now() / 1000).toString(),
      recipient_id: TEST_PHONE,
    };
    const before = (await getInteractions(enrolment.id)).length;
    await postWebhook(JSON.stringify(metaStatusPayload(okStatus)), "valid");
    await sleep(1500);
    const res = await sb(
      `/message_delivery_failures?message_id=eq.${encodeURIComponent(okStatus.id)}&select=id`
    );
    const failRows = (await res.json()) ?? [];
    const after = (await getInteractions(enrolment.id)).length;
    if (failRows.length === 0 && after === before) {
      pass("D2 delivered status creates no failure row or interaction");
    } else {
      fail("D2 delivered status", `failRows=${failRows.length} interactions ${before}→${after}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // MODULE E — Edge cases + scheduler heartbeat
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Module E: Edge cases + heartbeat ──");

  // E1: payload with no messages
  {
    const r = await postWebhook(JSON.stringify({ object: "whatsapp_business_account", entry: [] }), "valid");
    if (r.status !== 500) pass("E1 empty entry payload handled", `status=${r.status}`);
    else fail("E1 empty payload", "500 error");
  }

  // E2: process endpoint stamps heartbeat (needs APP_SECRET)
  if (APP_SECRET_TOKEN) {
    const r = await fetch(`${BASE_URL}/api/campaigns/process`, {
      method: "POST",
      headers: { Authorization: `Bearer ${APP_SECRET_TOKEN}`, "Content-Type": "application/json" },
      body: "{}",
    });
    await sleep(1000);
    const hb = await sb(`/system_heartbeats?name=eq.campaign_process&select=last_run_at`);
    const rows = (await hb.json()) ?? [];
    const age = rows[0] ? Date.now() - new Date(rows[0].last_run_at).getTime() : Infinity;
    if (r.status === 200 && rows[0] && age < 60000) {
      pass("E2 process endpoint stamps campaign_process heartbeat", `age=${Math.round(age / 1000)}s`);
    } else if (r.status === 200) {
      fail("E2 heartbeat not stamped", `rows=${rows.length}`);
    } else {
      warn("E2 process endpoint", `status=${r.status}`);
    }
  } else {
    warn("E2 heartbeat test", "APP_SECRET not set — skipped");
  }

  // E3: enrolment state sanity — restore before finishing
  await resetEnrolmentActive(enrolment.id);

  // ────────────────────────────────────────────────────────────────────────
  // CLEANUP + REPORT
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Cleanup ──");
  await cleanTestData();
  console.log("  Test data cleaned");

  const passed = results.filter((r) => r.status === "PASS").length;
  const warned = results.filter((r) => r.status === "WARN").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${warned} warnings, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════════");

  fs.writeFileSync(
    path.join(process.cwd(), "tests", "webhook-security-results.json"),
    JSON.stringify(
      { timestamp: new Date().toISOString(), target: BASE_URL, enforced: ENFORCED, passed, warned, failed, results },
      null,
      2
    )
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
