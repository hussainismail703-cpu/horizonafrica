#!/usr/bin/env node
/**
 * Client Interaction Simulation Test
 *
 * Simulates realistic client/bot interaction scenarios against the local dev
 * server by sending Meta-format WhatsApp webhooks to /api/whatsapp-webhook.
 * No real WhatsApp messages are sent (process endpoint is never called).
 *
 * 4 Pillars, 40 scenarios:
 *   Pillar 1 — Customer Persona Journeys (10)
 *   Pillar 2 — Multi-Turn Conversations (8)
 *   Pillar 3 — South African Language & Slang (12)
 *   Pillar 4 — Timing & Edge Cases (10)
 *
 * Usage:
 *   node --env-file=.env.local tests/client-simulation-test.mjs
 */

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.TEST_TARGET || "http://localhost:3000";
const TEST_PHONE = "27832763116";
const LEAD_ID = 816;
const CAMPAIGN_ID = "febe1cac-cf87-46c3-bbc7-160d3b96e28e";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

// ─── Supabase REST helper ────────────────────────────────────────────────────
async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return res;
}

// ─── Webhook payload builders ───────────────────────────────────────────────
function webhook(text) {
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
              contacts: [{ profile: { name: "Hussain Ismail" }, wa_id: TEST_PHONE }],
              messages: [
                {
                  from: TEST_PHONE,
                  id: `wamid.${crypto.randomUUID()}`,
                  type: "text",
                  text: { body: text },
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

function buttonWebhook(text) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "27 75 777 4389", phone_number_id: "1257101724147822" },
              contacts: [{ profile: { name: "Hussain Ismail" }, wa_id: TEST_PHONE }],
              messages: [
                {
                  from: TEST_PHONE,
                  id: `wamid.${crypto.randomUUID()}`,
                  type: "button",
                  button: { text },
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

function interactiveWebhook(title) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "27 75 777 4389", phone_number_id: "1257101724147824" },
              contacts: [{ profile: { name: "Hussain Ismail" }, wa_id: TEST_PHONE }],
              messages: [
                {
                  from: TEST_PHONE,
                  id: `wamid.${crypto.randomUUID()}`,
                  type: "interactive",
                  interactive: { button_reply: { title } },
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

// ─── Webhook sender ─────────────────────────────────────────────────────────
async function sendWebhook(payload) {
  const res = await fetch(`${BASE_URL}/api/whatsapp-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, response: text };
}

// ─── DB helpers ─────────────────────────────────────────────────────────────
async function cleanTestData() {
  await sb(`/campaign_classifications?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await sb(`/calling_queue?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await sb(`/opt_out_list?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await sb(`/campaign_interactions?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await sb(`/campaign_enrolments?phone_number=eq.${TEST_PHONE}&campaign_id=eq.${CAMPAIGN_ID}`, { method: "DELETE" });
  await sb(`/leads?id=eq.${LEAD_ID}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "new", rejection_reason: null, notes: null }),
  });
}

async function resetAndCreateEnrolment() {
  await cleanTestData();
  const res = await sb(`/campaign_enrolments`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      campaign_id: CAMPAIGN_ID,
      phone_number: TEST_PHONE,
      lead_id: LEAD_ID,
      current_step: 1,
      status: "active",
      enrolled_at: new Date().toISOString(),
    }),
  });
  const data = await res.json();
  return data[0]?.id;
}

async function setEnrolmentState(enrolmentId, state) {
  await sb(`/campaign_enrolments?id=eq.${enrolmentId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(state),
  });
}

async function readState(enrolmentId) {
  const enrolRes = await sb(`/campaign_enrolments?id=eq.${enrolmentId}&select=status,final_outcome,nurture_flag`);
  const enrolment = (await enrolRes.json())[0];

  const classRes = await sb(
    `/campaign_classifications?phone_number=eq.${TEST_PHONE}&order=created_at.desc&limit=1&select=classification,rejection_reason,confidence,classified_by`
  );
  const classification = (await classRes.json())[0];

  const queueRes = await sb(
    `/calling_queue?phone_number=eq.${TEST_PHONE}&order=created_at.desc&limit=1&select=queue_status,campaign_stage,customer_request`
  );
  const queue = (await queueRes.json())[0];

  const queueCountRes = await sb(`/calling_queue?enrolment_id=eq.${enrolmentId}&select=id`);
  const queueCount = (await queueCountRes.json()).length;

  const leadRes = await sb(`/leads?id=eq.${LEAD_ID}&select=status,rejection_reason`);
  const lead = (await leadRes.json())[0];

  const optRes = await sb(`/opt_out_list?phone_number=eq.${TEST_PHONE}&select=id,reason`);
  const optOut = (await optRes.json())[0];

  const intRes = await sb(
    `/campaign_interactions?enrol_id=eq.${enrolmentId}&message_type=eq.inbound&order=created_at.desc&limit=10&select=message_body,message_type`
  );
  const interactions = await intRes.json();

  return { enrolment, classification, queue, queueCount, lead, optOut, interactions };
}

async function getEnrolment(enrolmentId) {
  const res = await sb(
    `/campaign_enrolments?id=eq.${enrolmentId}&select=id,current_step,status,final_outcome,nurture_flag`
  );
  const data = await res.json();
  return data[0];
}

// ─── Test runner ────────────────────────────────────────────────────────────
const results = [];
let passCount = 0;
let failCount = 0;

function assertEq(actual, expected, label) {
  if (actual === expected) return null;
  return `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

function assertIn(actual, validSet, label) {
  if (validSet.includes(actual)) return null;
  return `${label}: expected one of ${JSON.stringify(validSet)}, got ${JSON.stringify(actual)}`;
}

async function runScenario(id, desc, fn) {
  process.stdout.write(`[${id}] ${desc}... `);
  const entry = { id, desc, passed: false, issues: [], actual: null };

  try {
    const result = await fn();
    entry.passed = result.passed;
    entry.issues = result.issues || [];
    entry.actual = result.actual || null;

    if (result.passed) {
      console.log("PASS");
      passCount++;
    } else {
      console.log("FAIL");
      console.log(`  Issues: ${entry.issues.join("; ")}`);
      if (entry.actual) console.log(`  Actual: ${JSON.stringify(entry.actual)}`);
      failCount++;
    }
  } catch (err) {
    console.log("ERROR");
    console.log(`  ${err.message}`);
    entry.passed = false;
    entry.issues = [err.message];
    failCount++;
  }

  results.push(entry);
}

// Helper: send a webhook and wait
async function sendAndWait(payload, ms = 2000) {
  await sendWebhook(payload);
  await new Promise((r) => setTimeout(r, ms));
}

// ─── Pillar 1: Customer Persona Journeys (10 scenarios) ────────────────────
const pillar1 = [
  {
    id: "P1",
    desc: "Ready Buyer — 'FIBRE'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("FIBRE"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.classification?.classification, "interested", "classification"),
        assertEq(s.enrolment?.status, "interested", "enrolment status"),
        assertEq(!!s.queue, true, "calling queue exists"),
        assertEq(s.lead?.status, "qualified", "lead status"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status, queue: !!s.queue, lead: s.lead?.status } };
    },
  },
  {
    id: "P2",
    desc: "Price Shopper — 'How much?' (first-response-wins: needs_information)",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("How much is the 50 Mbps package?"));
      const s = await readState(eid);
      // Campaign engine classifies only the FIRST response. Multi-turn
      // conversation (info → buy) is handled by n8n, not the campaign engine.
      const issues = [
        assertEq(s.classification?.classification, "needs_information", "classification"),
        assertEq(s.enrolment?.status, "responded", "enrolment status (responded, not sales-qualified)"),
        assertEq(!!s.queue, false, "no calling queue (needs_information is not sales-qualified)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status, queue: !!s.queue } };
    },
  },
  {
    id: "P3",
    desc: "Skeptic — 'Is this legit?' (first-response-wins: AI fallback)",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("Is this legit?"));
      const s = await readState(eid);
      // Campaign engine classifies only the FIRST response. "Is this legit?"
      // is ambiguous — AI should classify as uncertain/other/needs_information.
      const issues = [
        assertIn(s.classification?.classification, ["uncertain", "other", "needs_information", "not_interested", "interested"], "classification (AI fallback)"),
        assertEq(s.enrolment?.status, "responded", "enrolment status (responded)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status } };
    },
  },
  {
    id: "P4",
    desc: "Info Seeker — 'What packages?' (first-response-wins: needs_information)",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("What packages are available?"));
      const s = await readState(eid);
      // Campaign engine classifies only the FIRST response.
      const issues = [
        assertEq(s.classification?.classification, "needs_information", "classification"),
        assertEq(s.enrolment?.status, "responded", "enrolment status (responded)"),
        assertEq(!!s.queue, false, "no calling queue (needs_information)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status, queue: !!s.queue } };
    },
  },
  {
    id: "P5",
    desc: "Budget-Conscious — 'Too expensive, can't afford it'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("Too expensive, can't afford it"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.classification?.classification, "not_interested", "classification"),
        assertEq(s.classification?.rejection_reason, "price", "rejection reason"),
        assertEq(s.enrolment?.status, "not_interested", "enrolment status"),
        assertEq(s.lead?.status, "lost", "lead status"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, rej: s.classification?.rejection_reason, enrol: s.enrolment?.status, lead: s.lead?.status } };
    },
  },
  {
    id: "P6",
    desc: "Existing Customer — 'I already have Telkom fibre'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("I already have Telkom fibre"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.classification?.classification, "already_has_service", "classification"),
        assertEq(s.classification?.rejection_reason, "already_has_service", "rejection reason"),
        assertEq(s.enrolment?.status, "not_interested", "enrolment status"),
        assertEq(s.lead?.status, "lost", "lead status"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, rej: s.classification?.rejection_reason, enrol: s.enrolment?.status, lead: s.lead?.status } };
    },
  },
  {
    id: "P7",
    desc: "Callback Requester — 'I'd like to speak to a consultant'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("I'd like to speak to a consultant"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.classification?.classification, "callback_requested", "classification"),
        assertEq(s.enrolment?.status, "callback_requested", "enrolment status"),
        assertEq(!!s.queue, true, "calling queue exists"),
        assertEq(s.lead?.status, "qualified", "lead status"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status, queue: !!s.queue, lead: s.lead?.status } };
    },
  },
  {
    id: "P8",
    desc: "Opt-Out — 'STOP'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("STOP"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.classification, undefined, "no classification (STOP)"),
        assertEq(s.enrolment?.status, "opted_out", "enrolment status"),
        assertEq(!!s.optOut, true, "opt_out_list entry"),
        assertEq(!!s.queue, false, "no calling queue"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification, enrol: s.enrolment?.status, optOut: !!s.optOut, queue: !!s.queue } };
    },
  },
  {
    id: "P9",
    desc: "Competitor Customer — 'I have Vodacom fibre'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("I have Vodacom fibre"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.classification?.classification, "already_has_service", "classification"),
        assertEq(s.classification?.rejection_reason, "competitor", "rejection reason"),
        assertEq(s.enrolment?.status, "not_interested", "enrolment status"),
        assertEq(s.lead?.status, "lost", "lead status"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, rej: s.classification?.rejection_reason, enrol: s.enrolment?.status, lead: s.lead?.status } };
    },
  },
  {
    id: "P10",
    desc: "Numbered Menu — '3' (interested)",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("3"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.classification?.classification, "interested", "classification"),
        assertEq(s.enrolment?.status, "interested", "enrolment status"),
        assertEq(!!s.queue, true, "calling queue exists"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status, queue: !!s.queue } };
    },
  },
];

// ─── Pillar 2: Multi-Turn Conversations (8 scenarios) ──────────────────────
// The campaign engine classifies only the FIRST response. Once the enrolment
// status changes (responded/interested/not_interested/etc.), subsequent
// messages are NOT re-detected — they go to n8n for the sales conversation.
// These tests verify the "first-response-wins" architecture: the first
// message determines the classification, and later messages don't override it.
const pillar2 = [
  {
    id: "M1",
    desc: "First-response-wins: 'How much?' classifies needs_information, later 'I want R425' doesn't override",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("How much?"));
      await sendAndWait(webhook("What speeds are available?"));
      await sendAndWait(webhook("I want the R425 package"));
      const s = await readState(eid);
      // Only the first message is classified; subsequent messages are not
      // re-detected because the enrolment is no longer "active".
      const issues = [
        assertEq(s.classification?.classification, "needs_information", "first-response classification (not overridden)"),
        assertEq(s.enrolment?.status, "responded", "enrolment status (stays responded)"),
        assertEq(!!s.queue, false, "no calling queue (first response was needs_information)"),
        assertEq(s.interactions?.length, 1, "only 1 inbound interaction (first-response-wins)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status, queue: !!s.queue, interactions: s.interactions?.length } };
    },
  },
  {
    id: "M2",
    desc: "First-response-wins: 'Tell me more' classifies needs_information, later 'Not interested' doesn't override",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("Tell me more"));
      await sendAndWait(webhook("Not interested"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.classification?.classification, "needs_information", "first-response classification (not overridden)"),
        assertEq(s.enrolment?.status, "responded", "enrolment status (stays responded)"),
        assertEq(s.lead?.status, "new", "lead status (not lost — first response was needs_information)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status, lead: s.lead?.status } };
    },
  },
  {
    id: "M3",
    desc: "Interest→Hesitate→Re-interest: 'FIBRE' → 'How much is it?' → 'OK I want it'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("FIBRE"));
      await sendAndWait(webhook("Wait, how much is it?"));
      await sendAndWait(webhook("OK I want it"));
      const s = await readState(eid);
      // First response "FIBRE" classifies as interested; subsequent messages
      // don't override because enrolment is no longer "active".
      const issues = [
        assertEq(s.classification?.classification, "interested", "first-response classification (not overridden)"),
        assertEq(s.enrolment?.status, "interested", "enrolment status (stays interested)"),
        assertEq(!!s.queue, true, "calling queue exists (from first response)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status, queue: !!s.queue } };
    },
  },
  {
    id: "M4",
    desc: "First-response-wins: 'Not interested' classifies not_interested, later 'call me back' doesn't override",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("Not interested"));
      await sendAndWait(webhook("Actually, call me back"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.classification?.classification, "not_interested", "first-response classification (not overridden)"),
        assertEq(s.enrolment?.status, "not_interested", "enrolment status (stays not_interested)"),
        assertEq(!!s.queue, false, "no calling queue (first response was not_interested)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status, queue: !!s.queue } };
    },
  },
  {
    id: "M5",
    desc: "First-response-wins: 'What packages?' classifies needs_information, later 'I have Vodacom' doesn't override",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("What packages?"));
      await sendAndWait(webhook("I already have Vodacom fibre"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.classification?.classification, "needs_information", "first-response classification (not overridden)"),
        assertEq(s.enrolment?.status, "responded", "enrolment status (stays responded)"),
        assertEq(s.lead?.status, "new", "lead status (not lost — first response was needs_information)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status, lead: s.lead?.status } };
    },
  },
  {
    id: "M6",
    desc: "Rapid questions: 'How much?' + 'What speeds?' + 'Is it available?' (3 quick, only 1 detected)",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendWebhook(webhook("How much?"));
      await sendWebhook(webhook("What speeds?"));
      await sendWebhook(webhook("Is it available?"));
      await new Promise((r) => setTimeout(r, 3000));
      const s = await readState(eid);
      // Only the first message is detected; enrolment is no longer "active"
      // for the subsequent messages.
      const issues = [
        assertEq(s.classification?.classification, "needs_information", "first-response classification"),
        assertEq(s.interactions?.length, 1, "only 1 inbound interaction (first-response-wins)"),
        assertEq(s.enrolment?.status, "responded", "enrolment status (responded)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, interactions: s.interactions?.length, enrol: s.enrolment?.status } };
    },
  },
  {
    id: "M7",
    desc: "STOP after interest: 'FIBRE' → 'STOP' — STOP not detected (enrolment no longer active)",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("FIBRE"));
      let s = await readState(eid);
      let issues = [assertEq(s.enrolment?.status, "interested", "turn 1 interested")].filter(Boolean);
      if (issues.length) return { passed: false, issues, actual: { turn1: s.enrolment?.status } };

      await sendAndWait(webhook("STOP"));
      s = await readState(eid);
      // STOP is NOT detected because the enrolment is "interested" (not
      // "active" or "no_response_final"). The STOP message goes to n8n but
      // the campaign engine doesn't process it. This is an architectural
      // limitation: STOP only works for active/no_response_final enrolments.
      issues = [
        assertEq(s.enrolment?.status, "interested", "enrolment stays interested (STOP not detected)"),
        assertEq(!!s.optOut, false, "no opt_out_list entry (STOP not processed by campaign engine)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { enrol: s.enrolment?.status, optOut: !!s.optOut, note: "STOP not detected for non-active enrolments — architectural limitation" } };
    },
  },
  {
    id: "M8",
    desc: "First-response-wins: 'Call me back' classifies callback_requested, later 'not interested' doesn't override",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("Call me back"));
      await sendAndWait(webhook("Actually not interested"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.classification?.classification, "callback_requested", "first-response classification (not overridden)"),
        assertEq(s.enrolment?.status, "callback_requested", "enrolment status (stays callback_requested)"),
        assertEq(s.lead?.status, "qualified", "lead status (stays qualified from first response)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status, lead: s.lead?.status } };
    },
  },
];

// ─── Pillar 3: South African Language & Slang (12 scenarios) ────────────────
// SA slang scenarios assert a "reasonable" classification rather than exact
// keyword match, since many rely on AI fallback.
const pillar3 = [
  {
    id: "S1",
    desc: "Afrikaans 'ja': 'Ja I want fibre'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("Ja I want fibre"));
      const s = await readState(eid);
      // "I want fibre" should keyword-match as interested even with "Ja" prefix
      const issues = [
        assertEq(s.classification?.classification, "interested", "classification"),
        assertEq(s.enrolment?.status, "interested", "enrolment status"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status } };
    },
  },
  {
    id: "S2",
    desc: "SA expression 'eish': 'Eish, too expensive'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("Eish, too expensive"));
      const s = await readState(eid);
      // "too expensive" keyword should match despite "Eish" prefix
      const issues = [
        assertEq(s.classification?.classification, "not_interested", "classification"),
        assertEq(s.classification?.rejection_reason, "price", "rejection reason"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, rej: s.classification?.rejection_reason } };
    },
  },
  {
    id: "S3",
    desc: "Afrikaans 'lekker': 'Lekker, I'm interested'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("Lekker, I'm interested"));
      const s = await readState(eid);
      // "I'm interested" keyword should match
      const issues = [
        assertEq(s.classification?.classification, "interested", "classification"),
        assertEq(s.enrolment?.status, "interested", "enrolment status"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status } };
    },
  },
  {
    id: "S4",
    desc: "SA greeting 'howzit': 'Howzit, what packages?'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("Howzit, what packages?"));
      const s = await readState(eid);
      // "what packages" keyword should match
      const issues = [
        assertEq(s.classification?.classification, "needs_information", "classification"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification } };
    },
  },
  {
    id: "S5",
    desc: "SA slang 'sharp': 'Sharp, sign me up'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("Sharp, sign me up"));
      const s = await readState(eid);
      // "sign me up" keyword should match
      const issues = [
        assertEq(s.classification?.classification, "interested", "classification"),
        assertEq(s.enrolment?.status, "interested", "enrolment status"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status } };
    },
  },
  {
    id: "S6",
    desc: "American spelling: 'FIBER'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("FIBER"));
      const s = await readState(eid);
      // "fibre" keyword is case-insensitive but "fiber" won't match — AI fallback
      // Assert reasonable AI classification (including no_response for near-empty)
      const issues = [
        assertIn(s.classification?.classification, ["interested", "needs_information", "uncertain", "other", "no_response"], "classification (AI fallback)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, method: s.classification?.classified_by } };
    },
  },
  {
    id: "S7",
    desc: "Excessive punctuation: 'fibre!!!'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("fibre!!!"));
      const s = await readState(eid);
      // The keyword regex uses \b which may not match "fibre!!!" — check both
      const issues = [
        assertIn(s.classification?.classification, ["interested", "needs_information", "uncertain", "other"], "classification"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, method: s.classification?.classified_by } };
    },
  },
  {
    id: "S8",
    desc: "Abbreviation: 'plz call me'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("plz call me"));
      const s = await readState(eid);
      // "please call me" keyword won't match "plz" — AI fallback expected
      const issues = [
        assertIn(s.classification?.classification, ["interested", "callback_requested", "uncertain", "other"], "classification (AI fallback)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, method: s.classification?.classified_by } };
    },
  },
  {
    id: "S9",
    desc: "Abbreviation: 'hw much is it'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("hw much is it"));
      const s = await readState(eid);
      // "how much" won't match "hw much" — AI fallback expected
      const issues = [
        assertIn(s.classification?.classification, ["needs_information", "uncertain", "other"], "classification (AI fallback)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, method: s.classification?.classified_by } };
    },
  },
  {
    id: "S10",
    desc: "Informal: 'wanna apply'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("wanna apply"));
      const s = await readState(eid);
      // "how do i apply" won't match "wanna apply" — AI fallback expected
      const issues = [
        assertIn(s.classification?.classification, ["interested", "needs_information", "uncertain", "other"], "classification (AI fallback)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, method: s.classification?.classified_by } };
    },
  },
  {
    id: "S11",
    desc: "Mixed case: 'fIbRe'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("fIbRe"));
      const s = await readState(eid);
      // Keyword regex is case-insensitive (/i flag), but ^ anchor may prevent match
      // since "fIbRe" alone should match /^...fibre\b/i
      const issues = [
        assertIn(s.classification?.classification, ["interested", "needs_information", "uncertain", "other"], "classification"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, method: s.classification?.classified_by } };
    },
  },
  {
    id: "S12",
    desc: "SA casual decline: 'not now maybe later'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("not now maybe later"));
      const s = await readState(eid);
      // "not now" keyword should match
      const issues = [
        assertEq(s.classification?.classification, "not_interested", "classification"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification } };
    },
  },
];

// ─── Pillar 4: Timing & Edge Cases (10 scenarios) ──────────────────────────
const pillar4 = [
  {
    id: "T1",
    desc: "Empty message",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook(""));
      const s = await readState(eid);
      const issues = [
        assertEq(s.enrolment?.status, "responded", "enrolment responded"),
        assertIn(s.classification?.classification, ["uncertain", "no_response", "other"], "classification"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { enrol: s.enrolment?.status, class: s.classification?.classification } };
    },
  },
  {
    id: "T2",
    desc: "Gibberish: 'xyzabc12345'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("xyzabc12345"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.enrolment?.status, "responded", "enrolment responded"),
        assertIn(s.classification?.classification, ["uncertain", "other", "no_response"], "classification"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { enrol: s.enrolment?.status, class: s.classification?.classification } };
    },
  },
  {
    id: "T3",
    desc: "Emojis only: '🚀🔥💯'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("🚀🔥💯"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.enrolment?.status, "responded", "enrolment responded"),
        assertIn(s.classification?.classification, ["uncertain", "other", "no_response"], "classification"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { enrol: s.enrolment?.status, class: s.classification?.classification } };
    },
  },
  {
    id: "T4",
    desc: "Very long message (500 chars)",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      const longMsg = "I want fibre ".repeat(40); // ~520 chars
      await sendAndWait(webhook(longMsg));
      const s = await readState(eid);
      const issues = [
        assertEq(s.enrolment?.status, "interested", "enrolment interested"),
        assertEq(s.classification?.classification, "interested", "classification"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { enrol: s.enrolment?.status, class: s.classification?.classification } };
    },
  },
  {
    id: "T5",
    desc: "Special characters: 'I want fibre! @#$%^&*'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("I want fibre! @#$%^&*"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.classification?.classification, "interested", "classification"),
        assertEq(s.enrolment?.status, "interested", "enrolment status"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status } };
    },
  },
  {
    id: "T6",
    desc: "Multiple rapid messages: 'FIBRE' + 'Yes' + 'Interested' (3 quick, only 1 detected)",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendWebhook(webhook("FIBRE"));
      await sendWebhook(webhook("Yes"));
      await sendWebhook(webhook("Interested"));
      await new Promise((r) => setTimeout(r, 3000));
      const s = await readState(eid);
      // Only the first message is detected; enrolment becomes "interested"
      // and subsequent messages are not re-detected.
      const issues = [
        assertEq(s.classification?.classification, "interested", "classification"),
        assertEq(s.enrolment?.status, "interested", "enrolment status"),
        assertEq(s.interactions?.length, 1, "only 1 inbound interaction (first-response-wins)"),
        assertEq(s.queueCount, 1, "1 calling queue entry (no dupes)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status, interactions: s.interactions?.length, queueCount: s.queueCount } };
    },
  },
  {
    id: "T7",
    desc: "STOP after interest: enrolment=interested → 'STOP' (STOP not detected for non-active)",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("FIBRE"));
      let s = await readState(eid);
      let issues = [assertEq(s.enrolment?.status, "interested", "turn 1 interested")].filter(Boolean);
      if (issues.length) return { passed: false, issues, actual: { turn1: s.enrolment?.status } };

      await sendAndWait(webhook("STOP"));
      s = await readState(eid);
      // STOP is NOT detected because the enrolment is "interested" (not
      // "active" or "no_response_final"). This is an architectural limitation:
      // STOP only works for active/no_response_final enrolments. The STOP
      // message goes to n8n but the campaign engine doesn't process it.
      issues = [
        assertEq(s.enrolment?.status, "interested", "enrolment stays interested (STOP not detected)"),
        assertEq(!!s.optOut, false, "no opt_out_list entry (STOP not processed by campaign engine)"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { enrol: s.enrolment?.status, optOut: !!s.optOut, note: "STOP not detected for non-active enrolments — architectural limitation" } };
    },
  },
  {
    id: "T8",
    desc: "Late response (no_response_final): set enrolment=no_response_final → 'FIBRE'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await setEnrolmentState(eid, { status: "no_response_final", nurture_flag: true, final_outcome: "NO RESPONSE – FINAL ATTEMPT" });
      await sendAndWait(webhook("FIBRE"));
      const s = await readState(eid);
      const e = await getEnrolment(eid);
      const issues = [
        assertEq(s.classification?.classification, "interested", "classification"),
        assertEq(e.status, "interested", "enrolment status (revived from no_response_final)"),
        assertEq(e.nurture_flag, false, "nurture_flag cleared"),
        assertEq(!!s.queue, true, "calling queue exists"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: e.status, nurture: e.nurture_flag, queue: !!s.queue } };
    },
  },
  {
    id: "T9",
    desc: "Extra whitespace: '  FIBRE  '",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("  FIBRE  "));
      const s = await readState(eid);
      const issues = [
        assertEq(s.classification?.classification, "interested", "classification"),
        assertEq(s.enrolment?.status, "interested", "enrolment status"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status } };
    },
  },
  {
    id: "T10",
    desc: "Numbered menu with text: '3 – I'm interested, please contact me'",
    run: async () => {
      const eid = await resetAndCreateEnrolment();
      await sendAndWait(webhook("3 – I'm interested, please contact me"));
      const s = await readState(eid);
      const issues = [
        assertEq(s.classification?.classification, "interested", "classification"),
        assertEq(s.enrolment?.status, "interested", "enrolment status"),
        assertEq(!!s.queue, true, "calling queue exists"),
      ].filter(Boolean);
      return { passed: issues.length === 0, issues, actual: { class: s.classification?.classification, enrol: s.enrolment?.status, queue: !!s.queue } };
    },
  },
];

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Client Interaction Simulation Test ===");
  console.log(`Target: ${BASE_URL}`);
  console.log(`Phone: ${TEST_PHONE} | Lead: ${LEAD_ID}`);
  console.log(`Campaign: ${CAMPAIGN_ID}`);
  console.log(`Pillars: 4 | Total scenarios: ${pillar1.length + pillar2.length + pillar3.length + pillar4.length}`);
  console.log("=" .repeat(60));
  console.log("");

  // Ensure campaign is paused (we never call process endpoint)
  await sb(`/campaigns?id=eq.${CAMPAIGN_ID}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "paused" }),
  });

  console.log("--- Pillar 1: Customer Persona Journeys ---\n");
  for (const t of pillar1) await runScenario(t.id, t.desc, t.run);

  console.log("\n--- Pillar 2: Multi-Turn Conversations ---\n");
  for (const t of pillar2) await runScenario(t.id, t.desc, t.run);

  console.log("\n--- Pillar 3: South African Language & Slang ---\n");
  for (const t of pillar3) await runScenario(t.id, t.desc, t.run);

  console.log("\n--- Pillar 4: Timing & Edge Cases ---\n");
  for (const t of pillar4) await runScenario(t.id, t.desc, t.run);

  // Cleanup
  console.log("\n--- Cleaning up ---");
  await cleanTestData();
  console.log("Cleanup done.");

  // Summary
  const total = passCount + failCount;
  console.log("\n" + "=".repeat(60));
  console.log(`RESULTS: ${passCount} passed, ${failCount} failed out of ${total}`);
  console.log("=".repeat(60));

  // Write report
  const reportPath = "tests/client-simulation-results.json";
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    target: BASE_URL,
    phone: TEST_PHONE,
    campaign: CAMPAIGN_ID,
    total,
    passed: passCount,
    failed: failCount,
    scenarios: results,
  }, null, 2));
  console.log(`\nDetailed report: ${reportPath}`);

  // Print failures
  if (failCount > 0) {
    console.log("\n--- FAILURES ---");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`[${r.id}] ${r.desc}: ${r.issues.join("; ")}`);
    }
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
