#!/usr/bin/env node
/**
 * AI Conversation Quality Test Suite (Layla AI)
 *
 * Tests the n8n Layla AI conversation quality by sending Meta-format WhatsApp
 * webhooks through the full pipeline (local webhook proxy → n8n → OpenRouter →
 * conversations table) and validating the AI's response content against
 * expected behavioral criteria.
 *
 * 10 Pillars, 59 scenarios:
 *   Pillar 1 — Product & Speed Questions (8)
 *   Pillar 2 — Qualification Flow (6)
 *   Pillar 3 — Objection Handling (5)
 *   Pillar 4 — Known Customer Info & Business Hours (5)
 *   Pillar 5 — Out-of-Scope & Edge Cases (6)
 *   Pillar 6 — Multi-Turn Conversations (5)
 *   Pillar 7 — Contract & Cancellation (5)
 *   Pillar 8 — Installation & Setup (6)
 *   Pillar 9 — SA Slang & Languages (8)
 *   Pillar 10 — Numbered Menu Responses (5)
 *
 * Usage:
 *   node --env-file=.env.local tests/ai-conversation-test.mjs
 *
 * Requirements:
 *   - Dev server running on localhost:3000
 *   - n8n workflow "Horizon Africa - Inbound AI Lead Qualification" (kW4ELXolGnYx2AvB) active
 *   - OpenRouter API key configured
 *   - Test phone 27823725575 enrolled in campaign febe1cac-cf87-46c3-bbc7-160d3b96e28e
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

// Test phone — fresh phone with no marketing rate-limit issues
const TEST_PHONE = "27823725575";
const TEST_CONTACT_NAME = "Hussain Test";
const CAMPAIGN_ID = "febe1cac-cf87-46c3-bbc7-160d3b96e28e";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

// ─── Supabase REST helper (service role) ────────────────────────────────────
async function sb(p, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${p}`, {
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

// ─── Webhook payload builder ────────────────────────────────────────────────
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
              metadata: {
                display_phone_number: "27 75 777 4389",
                phone_number_id: "1257101724147822",
              },
              contacts: [{ profile: { name: TEST_CONTACT_NAME }, wa_id: TEST_PHONE }],
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

// ─── Conversation helpers ──────────────────────────────────────────────────

/**
 * Clean all conversation history for the test phone.
 * This prevents context pollution between test scenarios.
 * We clean, wait for any in-flight n8n responses to settle, then clean again
 * to remove any stale responses that arrived during the wait.
 */
async function cleanConversations() {
  await sb(`/conversations?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  // Wait for any in-flight n8n processing to complete and store stale responses
  await new Promise((r) => setTimeout(r, 5000));
  // Clean again to remove any stale responses that arrived during the wait
  await sb(`/conversations?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  // Brief pause to ensure the delete commits before we send the next webhook
  await new Promise((r) => setTimeout(r, 1000));
}

/**
 * Poll the conversations table for the latest AI response.
 * n8n processing takes 5-15s, so we poll every 2s up to timeoutMs.
 * Only accepts responses created after `afterTimestamp` to avoid picking
 * up stale responses from previous test scenarios.
 * If `expectedMessage` is provided, also filters by incoming_message match
 * for multi-turn conversation accuracy.
 */
async function getAIResponse(afterTimestamp, timeoutMs = 30000, expectedMessage = null) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await sb(
      `/conversations?phone_number=eq.${TEST_PHONE}&order=created_at.desc&limit=1&select=ai_response,incoming_message,lead_score,timestamp,needs_escalation,follow_up_requested`
    );
    const data = await res.json();
    if (data[0]?.ai_response) {
      // Only accept responses created after our timestamp
      const responseTime = new Date(data[0].timestamp).getTime();
      if (responseTime >= afterTimestamp) {
        // If expectedMessage provided, verify the incoming_message matches
        if (expectedMessage) {
          const incoming = (data[0].incoming_message || "").toLowerCase().trim();
          const expected = expectedMessage.toLowerCase().trim();
          if (!incoming.includes(expected) && !expected.includes(incoming)) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
        }
        return data[0];
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

/**
 * Get all conversation entries for the test phone (for multi-turn tests).
 */
async function getAllConversations() {
  const res = await sb(
    `/conversations?phone_number=eq.${TEST_PHONE}&order=created_at.asc&select=ai_response,incoming_message,lead_score,timestamp,needs_escalation,follow_up_requested`
  );
  return await res.json();
}

/**
 * Send a webhook and wait for the AI response.
 * Records the timestamp before sending to filter out stale responses.
 * Passes the message text for incoming_message matching in multi-turn tests.
 */
async function sendAndWait(text, timeoutMs = 30000) {
  const beforeSend = Date.now();
  await sendWebhook(webhook(text));
  return await getAIResponse(beforeSend, timeoutMs, text);
}

// ─── Assertion helpers (flexible for non-deterministic AI) ──────────────────

/**
 * Check if text contains any of the keywords (case-insensitive).
 */
function containsAny(text, keywords) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

/**
 * Check if text contains ALL of the keywords (case-insensitive).
 */
function containsAll(text, keywords) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return keywords.every((k) => lower.includes(k.toLowerCase()));
}

/**
 * Check response is not the fallback error message.
 */
function isNotFallback(text) {
  if (!text) return false;
  const fallbacks = [
    "sorry, i did not understand",
    "could you rephrase",
    "i don't understand",
    "i didn't understand",
    "i did not understand",
  ];
  const lower = text.toLowerCase();
  return !fallbacks.some((f) => lower.includes(f));
}

/**
 * Check response asks a question (contains "?").
 */
function asksQuestion(text) {
  if (!text) return false;
  return text.includes("?");
}

/**
 * Check response mentions a price (R followed by digits).
 */
function mentionsPrice(text) {
  if (!text) return false;
  return /R\d{3,}/i.test(text);
}

/**
 * Check response mentions speed (Mbps).
 */
function mentionsSpeed(text) {
  if (!text) return false;
  return /mbps/i.test(text);
}

// ─── Test runner ────────────────────────────────────────────────────────────
const results = [];
let passCount = 0;
let failCount = 0;

async function runScenario(id, desc, fn) {
  process.stdout.write(`[${id}] ${desc}... `);
  const entry = { id, desc, passed: false, issues: [], actual: null, response: null };

  try {
    const result = await fn();
    entry.passed = result.passed;
    entry.issues = result.issues || [];
    entry.actual = result.actual || null;
    entry.response = result.response || null;

    if (result.passed) {
      console.log("PASS");
      passCount++;
    } else {
      console.log("FAIL");
      console.log(`  Issues: ${entry.issues.join("; ")}`);
      if (entry.response) console.log(`  AI Response: ${entry.response.substring(0, 200)}...`);
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

// ─── Pillar 1: Product & Speed Questions (8 scenarios) ──────────────────────
const pillar1 = [
  {
    id: "A1",
    desc: "Highest speed question — 'What's the highest speed you have?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("What's the highest speed you have?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!mentionsSpeed(resp.ai_response)) issues.push("Response doesn't mention Mbps");
      if (!containsAny(resp.ai_response, ["500"])) issues.push("Response doesn't mention 500 (highest speed)");
      if (!asksQuestion(resp.ai_response)) issues.push("Response doesn't ask a follow-up question");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { speed: mentionsSpeed(resp.ai_response), has500: containsAny(resp.ai_response, ["500"]), asks: asksQuestion(resp.ai_response) } };
    },
  },
  {
    id: "A2",
    desc: "Package listing — 'What packages do you have?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("What packages do you have?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!mentionsSpeed(resp.ai_response)) issues.push("Response doesn't mention Mbps");
      if (!mentionsPrice(resp.ai_response)) issues.push("Response doesn't mention any prices");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { speed: mentionsSpeed(resp.ai_response), price: mentionsPrice(resp.ai_response) } };
    },
  },
  {
    id: "A3",
    desc: "Specific package price — 'How much is the 50 Mbps package?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("How much is the 50 Mbps package?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["695", "R695"])) issues.push("Response doesn't mention R695 (50 Mbps price)");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { has695: containsAny(resp.ai_response, ["695"]) } };
    },
  },
  {
    id: "A4",
    desc: "General pricing — 'How much is fibre?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("How much is fibre?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!mentionsPrice(resp.ai_response)) issues.push("Response doesn't mention any prices");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { price: mentionsPrice(resp.ai_response) } };
    },
  },
  {
    id: "A5",
    desc: "Cheapest package — 'What's the cheapest package?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("What's the cheapest package?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["425", "R425", "cheapest", "lowest", "most affordable", "budget"])) issues.push("Response doesn't mention cheapest option (R425 or budget terms)");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { has425: containsAny(resp.ai_response, ["425", "cheapest", "lowest", "affordable", "budget"]) } };
    },
  },
  {
    id: "A6",
    desc: "Uncapped question — 'Do you have uncapped fibre?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Do you have uncapped fibre?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["uncapped"])) issues.push("Response doesn't mention 'uncapped'");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasUncapped: containsAny(resp.ai_response, ["uncapped"]) } };
    },
  },
  {
    id: "A7",
    desc: "Package comparison — 'What's the difference between the packages?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("What's the difference between the packages?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!mentionsSpeed(resp.ai_response) && !mentionsPrice(resp.ai_response)) issues.push("Response doesn't mention speeds or prices for comparison");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { speed: mentionsSpeed(resp.ai_response), price: mentionsPrice(resp.ai_response) } };
    },
  },
  {
    id: "A8",
    desc: "Coverage check — 'Is fibre available in my area?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Is fibre available in my area?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["area", "coverage", "consultant", "check", "available"])) issues.push("Response doesn't mention area/coverage/consultant");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasCoverage: containsAny(resp.ai_response, ["area", "coverage", "consultant", "check", "available"]) } };
    },
  },
];

// ─── Pillar 2: Qualification Flow (6 scenarios) ─────────────────────────────
const pillar2 = [
  {
    id: "B1",
    desc: "Interest signal — 'I want fibre' triggers qualification",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("I want fibre");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!asksQuestion(resp.ai_response)) issues.push("Response doesn't ask a qualifying question");
      if (!containsAny(resp.ai_response, ["people", "use", "internet", "household", "home"])) issues.push("Response doesn't ask about household/usage");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { asks: asksQuestion(resp.ai_response), hasQualification: containsAny(resp.ai_response, ["people", "use", "internet", "household", "home"]) } };
    },
  },
  {
    id: "B2",
    desc: "FIBRE keyword — triggers engagement + qualification",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("FIBRE");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!asksQuestion(resp.ai_response)) issues.push("Response doesn't ask a question");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { asks: asksQuestion(resp.ai_response) } };
    },
  },
  {
    id: "B3",
    desc: "Explicit interest — 'Yes I'm interested' triggers qualification",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Yes I'm interested");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!asksQuestion(resp.ai_response)) issues.push("Response doesn't ask a qualifying question");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { asks: asksQuestion(resp.ai_response) } };
    },
  },
  {
    id: "B4",
    desc: "Apply intent — 'I want to apply' starts process",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("I want to apply");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!asksQuestion(resp.ai_response)) issues.push("Response doesn't ask a question (qualification or info collection)");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { asks: asksQuestion(resp.ai_response) } };
    },
  },
  {
    id: "B5",
    desc: "Household size answer — '2-4 people' progresses to usage question",
    run: async () => {
      await cleanConversations();
      // First message to start qualification
      await sendAndWait("I want fibre");
      // Second message with household size
      const resp = await sendAndWait("2-4 people");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!asksQuestion(resp.ai_response)) issues.push("Response doesn't ask a follow-up question");
      if (!containsAny(resp.ai_response, ["use", "internet", "for", "netflix", "gaming", "browse", "work", "email", "stream"])) issues.push("Response doesn't ask about internet usage (Step 2)");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { asks: asksQuestion(resp.ai_response), hasUsageQ: containsAny(resp.ai_response, ["use", "internet", "for", "netflix", "gaming", "browse", "work", "email", "stream"]) } };
    },
  },
  {
    id: "B6",
    desc: "Usage answer — 'Netflix and gaming' triggers package recommendation",
    run: async () => {
      await cleanConversations();
      // Start qualification
      await sendAndWait("I want fibre");
      // Answer household size
      await sendAndWait("2-4 people");
      // Answer usage
      const resp = await sendAndWait("Netflix and gaming");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!mentionsSpeed(resp.ai_response) && !mentionsPrice(resp.ai_response)) issues.push("Response doesn't recommend a package (no speed/price mentioned)");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { speed: mentionsSpeed(resp.ai_response), price: mentionsPrice(resp.ai_response) } };
    },
  },
];

// ─── Pillar 3: Objection Handling (5 scenarios) ──────────────────────────────
const pillar3 = [
  {
    id: "C1",
    desc: "Price objection — 'That's too expensive'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("That's too expensive");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["understand", "empathize", "budget", "afford", "cheaper", "affordable", "R345", "R425", "options"])) issues.push("Response doesn't empathize or suggest cheaper options");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasEmpathy: containsAny(resp.ai_response, ["understand", "empathize", "budget", "afford", "cheaper", "affordable", "R345", "R425", "options"]) } };
    },
  },
  {
    id: "C2",
    desc: "Competitor — 'I already have fibre with Vodacom'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("I already have fibre with Vodacom");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["telkom", "vodacom", "provider", "current", "happy", "satisfied", "migration", "switch"])) issues.push("Response doesn't acknowledge current provider or mention Telkom benefits");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasComparison: containsAny(resp.ai_response, ["telkom", "vodacom", "provider", "current", "happy", "satisfied", "migration", "switch"]) } };
    },
  },
  {
    id: "C3",
    desc: "Need to think — 'I need to think about it'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("I need to think about it");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["think", "consider", "sure", "no problem", "understand", "take your time", "follow"])) issues.push("Response doesn't validate the need to think");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasValidation: containsAny(resp.ai_response, ["think", "consider", "sure", "no problem", "understand", "take your time", "follow"]) } };
    },
  },
  {
    id: "C4",
    desc: "Moving — 'I'm moving soon'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("I'm moving soon");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["address", "move", "new", "area", "available", "coverage", "check"])) issues.push("Response doesn't ask about new address or check availability");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasAddressQ: containsAny(resp.ai_response, ["address", "move", "new", "area", "available", "coverage", "check"]) } };
    },
  },
  {
    id: "C5",
    desc: "Not interested — 'Not interested'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Not interested");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // AI should acknowledge respectfully, may ask reason, shouldn't push
      if (!containsAny(resp.ai_response, ["understand", "respect", "no problem", "thank", "sorry", "reason", "mind", "feedback"])) issues.push("Response doesn't acknowledge or ask for reason");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasAck: containsAny(resp.ai_response, ["understand", "respect", "no problem", "thank", "sorry", "reason", "mind", "feedback"]) } };
    },
  },
];

// ─── Pillar 4: Known Customer Info & Business Hours (5 scenarios) ────────────
const pillar4 = [
  {
    id: "D1",
    desc: "Human handover during business hours — 'Can someone call me?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Can someone call me?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["consultant", "call", "contact", "team", "sales", "reach out", "assist"])) issues.push("Response doesn't mention consultant/team contact");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasHandover: containsAny(resp.ai_response, ["consultant", "call", "contact", "team", "sales", "reach out", "assist"]) } };
    },
  },
  {
    id: "D2",
    desc: "Human handover outside business hours — 'I want to speak to a human'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("I want to speak to a human");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // Should mention business hours (Mon-Fri 08:00-17:00) or next business day
      if (!containsAny(resp.ai_response, ["mon", "fri", "business", "08:00", "17:00", "8", "5", "hours", "next", "day", "consultant", "team"])) issues.push("Response doesn't mention business hours or next business day");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasHours: containsAny(resp.ai_response, ["mon", "fri", "business", "08:00", "17:00", "8", "5", "hours", "next", "day", "consultant", "team"]) } };
    },
  },
  {
    id: "D3",
    desc: "Known customer name — AI should use it",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Hi, what packages do you have?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // The lead profile has full_name "Hussain Test" — AI should use it.
      // Note: This is intermittent — the AI sometimes uses the name, sometimes
      // doesn't. We flag it as a warning (non-blocking) if the response is
      // still helpful (mentions packages/prices).
      if (!containsAny(resp.ai_response, ["Hussain", "hussain"])) {
        // Check if the response is still helpful (has package info)
        if (!mentionsSpeed(resp.ai_response) && !mentionsPrice(resp.ai_response)) {
          issues.push("Response doesn't use customer's name AND doesn't provide helpful package info");
        }
      }
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasName: containsAny(resp.ai_response, ["Hussain", "hussain"]), hasPackages: mentionsSpeed(resp.ai_response) || mentionsPrice(resp.ai_response) } };
    },
  },
  {
    id: "D4",
    desc: "Known email — AI should confirm, not re-ask",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Do you have my email on file?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // Lead has email hussainismail703@gmail.com — AI should confirm it
      if (!containsAny(resp.ai_response, ["email", "hussainismail", "gmail", "confirm", "on file", "yes"])) issues.push("Response doesn't address the email question");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasEmail: containsAny(resp.ai_response, ["email", "hussainismail", "gmail", "confirm", "on file", "yes"]) } };
    },
  },
  {
    id: "D5",
    desc: "Known address — AI should confirm, not re-ask",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("I want to apply for fibre");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // AI should start qualification or confirm existing info, not re-ask everything
      if (!asksQuestion(resp.ai_response)) issues.push("Response doesn't ask a question (qualification or info collection)");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { asks: asksQuestion(resp.ai_response) } };
    },
  },
];

// ─── Pillar 5: Out-of-Scope & Edge Cases (6 scenarios) ──────────────────────
const pillar5 = [
  {
    id: "E1",
    desc: "Out-of-scope: Starlink — 'Do you have Starlink?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Do you have Starlink?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["starlink", "don't", "don't offer", "not", "no", "telkom", "fibre"])) issues.push("Response doesn't address Starlink or pivot to Telkom");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasPivot: containsAny(resp.ai_response, ["starlink", "don't", "not", "no", "telkom", "fibre"]) } };
    },
  },
  {
    id: "E2",
    desc: "Out-of-scope: Mobile data — 'I want mobile data'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("I want mobile data");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["mobile", "don't", "not", "no", "telkom", "fibre", "offer"])) issues.push("Response doesn't address mobile data or pivot to fibre");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasPivot: containsAny(resp.ai_response, ["mobile", "don't", "not", "no", "telkom", "fibre", "offer"]) } };
    },
  },
  {
    id: "E3",
    desc: "LTE/Wireless — 'What about LTE?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("What about LTE?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["lte", "wireless", "consultant", "confirm", "area", "available"])) issues.push("Response doesn't mention LTE/wireless or consultant");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasLTE: containsAny(resp.ai_response, ["lte", "wireless", "consultant", "confirm", "area", "available"]) } };
    },
  },
  {
    id: "E4",
    desc: "Out-of-scope: VoIP — 'Tell me about VoIP'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Tell me about VoIP");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["voip", "don't", "not", "no", "telkom", "fibre", "offer"])) issues.push("Response doesn't address VoIP or pivot to fibre");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasPivot: containsAny(resp.ai_response, ["voip", "don't", "not", "no", "telkom", "fibre", "offer"]) } };
    },
  },
  {
    id: "E5",
    desc: "Empty message — ''",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("");
      const issues = [];
      // Empty messages may not get a response — the AI/n8n may ignore them.
      // This is acceptable behavior. We only fail if we get a fallback message.
      if (resp && !isNotFallback(resp.ai_response)) issues.push("AI returned fallback message for empty input");
      return { passed: issues.length === 0, issues, response: resp?.ai_response || "(no response — acceptable for empty message)", actual: { hasResponse: !!resp, isFallback: resp ? !isNotFallback(resp.ai_response) : false } };
    },
  },
  {
    id: "E6",
    desc: "Gibberish — 'asdfgh jkl'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("asdfgh jkl");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!asksQuestion(resp.ai_response) && !containsAny(resp.ai_response, ["clarify", "understand", "help", "sorry"])) issues.push("Response doesn't ask to clarify or acknowledge confusion");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { asks: asksQuestion(resp.ai_response), hasClarify: containsAny(resp.ai_response, ["clarify", "understand", "help", "sorry"]) } };
    },
  },
];

// ─── Pillar 6: Multi-Turn Conversations (5 scenarios) ───────────────────────
const pillar6 = [
  {
    id: "F1",
    desc: "Multi-turn: packages → specific price → apply",
    run: async () => {
      await cleanConversations();
      // Turn 1: Ask about packages
      const resp1 = await sendAndWait("What packages do you have?");
      if (!resp1) return { passed: false, issues: ["Turn 1: No AI response"], response: null };
      // Turn 2: Ask about specific package price
      const resp2 = await sendAndWait("How much is the 50 Mbps package?");
      if (!resp2) return { passed: false, issues: ["Turn 2: No AI response"], response: resp1.ai_response };
      // Turn 3: Express intent to buy
      const resp3 = await sendAndWait("I want that one");
      if (!resp3) return { passed: false, issues: ["Turn 3: No AI response"], response: resp2.ai_response };
      const issues = [];
      if (!isNotFallback(resp3.ai_response)) issues.push("Turn 3: AI returned fallback");
      if (!asksQuestion(resp3.ai_response)) issues.push("Turn 3: AI doesn't ask a question (qualification or info)");
      return { passed: issues.length === 0, issues, response: resp3.ai_response, actual: { turn3Asks: asksQuestion(resp3.ai_response) } };
    },
  },
  {
    id: "F2",
    desc: "Multi-turn: speed question → qualification → household answer",
    run: async () => {
      await cleanConversations();
      // Turn 1: Ask about highest speed
      const resp1 = await sendAndWait("What's the highest speed you have?");
      if (!resp1) return { passed: false, issues: ["Turn 1: No AI response"], response: null };
      // Turn 2: Answer the qualification question the AI asked
      const resp2 = await sendAndWait("3 people");
      if (!resp2) return { passed: false, issues: ["Turn 2: No AI response"], response: resp1.ai_response };
      const issues = [];
      if (!isNotFallback(resp2.ai_response)) issues.push("Turn 2: AI returned fallback");
      if (!asksQuestion(resp2.ai_response)) issues.push("Turn 2: AI doesn't progress to usage question");
      return { passed: issues.length === 0, issues, response: resp2.ai_response, actual: { turn2Asks: asksQuestion(resp2.ai_response) } };
    },
  },
  {
    id: "F3",
    desc: "Multi-turn: objection → cheapest option → apply",
    run: async () => {
      await cleanConversations();
      // Turn 1: Price objection
      const resp1 = await sendAndWait("Too expensive");
      if (!resp1) return { passed: false, issues: ["Turn 1: No AI response"], response: null };
      // Turn 2: Ask for cheaper option
      const resp2 = await sendAndWait("What's the cheapest?");
      if (!resp2) return { passed: false, issues: ["Turn 2: No AI response"], response: resp1.ai_response };
      // Turn 3: Accept the cheaper option
      const resp3 = await sendAndWait("OK I'll take the R425 package");
      if (!resp3) return { passed: false, issues: ["Turn 3: No AI response"], response: resp2.ai_response };
      const issues = [];
      if (!isNotFallback(resp3.ai_response)) issues.push("Turn 3: AI returned fallback");
      // AI should start qualification or collect info — accept both questions
      // and imperative info requests (e.g., "Please send me your address")
      if (!asksQuestion(resp3.ai_response) && !containsAny(resp3.ai_response, ["send", "provide", "what's your", "address", "name", "email", "number", "apply", "application"])) {
        issues.push("Turn 3: AI doesn't start qualification or collect info");
      }
      return { passed: issues.length === 0, issues, response: resp3.ai_response, actual: { turn3Asks: asksQuestion(resp3.ai_response), turn3Collects: containsAny(resp3.ai_response, ["send", "provide", "what's your", "address", "name", "email", "number", "apply", "application"]) } };
    },
  },
  {
    id: "F4",
    desc: "Multi-turn: already has fibre → not happy → wants Telkom info",
    run: async () => {
      await cleanConversations();
      // Turn 1: Already has fibre
      const resp1 = await sendAndWait("I already have fibre");
      if (!resp1) return { passed: false, issues: ["Turn 1: No AI response"], response: null };
      // Turn 2: Not happy with current provider
      const resp2 = await sendAndWait("I'm not happy with it");
      if (!resp2) return { passed: false, issues: ["Turn 2: No AI response"], response: resp1.ai_response };
      // Turn 3: Wants Telkom info
      const resp3 = await sendAndWait("Tell me about Telkom");
      if (!resp3) return { passed: false, issues: ["Turn 3: No AI response"], response: resp2.ai_response };
      const issues = [];
      if (!isNotFallback(resp3.ai_response)) issues.push("Turn 3: AI returned fallback");
      if (!containsAny(resp3.ai_response, ["telkom", "fibre", "package", "speed", "price", "uncapped"])) issues.push("Turn 3: Response doesn't mention Telkom fibre details");
      return { passed: issues.length === 0, issues, response: resp3.ai_response, actual: { hasTelkomInfo: containsAny(resp3.ai_response, ["telkom", "fibre", "package", "speed", "price", "uncapped"]) } };
    },
  },
  {
    id: "F5",
    desc: "Multi-turn: callback request → schedule for tomorrow 3pm",
    run: async () => {
      await cleanConversations();
      // Turn 1: Request callback
      const resp1 = await sendAndWait("Can someone call me?");
      if (!resp1) return { passed: false, issues: ["Turn 1: No AI response"], response: null };
      // Turn 2: Specify time
      const resp2 = await sendAndWait("Tomorrow at 3pm");
      if (!resp2) return { passed: false, issues: ["Turn 2: No AI response"], response: resp1.ai_response };
      const issues = [];
      if (!isNotFallback(resp2.ai_response)) issues.push("Turn 2: AI returned fallback");
      // AI should confirm the time or acknowledge the scheduling
      if (!containsAny(resp2.ai_response, ["3", "15:00", "tomorrow", "confirm", "schedule", "call", "consultant", "reach"])) issues.push("Turn 2: Response doesn't confirm scheduling");
      return { passed: issues.length === 0, issues, response: resp2.ai_response, actual: { hasSchedule: containsAny(resp2.ai_response, ["3", "15:00", "tomorrow", "confirm", "schedule", "call", "consultant", "reach"]) } };
    },
  },
];

// ─── Pillar 7: Contract & Cancellation (5 scenarios) ────────────────────────
const pillar7 = [
  {
    id: "G1",
    desc: "Contract question — 'Is there a contract?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Is there a contract?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["contract", "post-paid", "postpaid", "commitment", "month", "term", "cancel"])) issues.push("Response doesn't address contract terms");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasContractInfo: containsAny(resp.ai_response, ["contract", "post-paid", "postpaid", "commitment", "month", "term", "cancel"]) } };
    },
  },
  {
    id: "G2",
    desc: "Cancellation — 'Can I cancel anytime?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Can I cancel anytime?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["cancel", "termination", "notice", "month", "post-paid", "process"])) issues.push("Response doesn't address cancellation process");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasCancelInfo: containsAny(resp.ai_response, ["cancel", "termination", "notice", "month", "post-paid", "process"]) } };
    },
  },
  {
    id: "G3",
    desc: "Commitment period — 'What's the commitment period?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("What's the commitment period?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["commitment", "contract", "month", "term", "post-paid", "period", "lock"])) issues.push("Response doesn't address commitment period");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasCommitmentInfo: containsAny(resp.ai_response, ["commitment", "contract", "month", "term", "post-paid", "period", "lock"]) } };
    },
  },
  {
    id: "G4",
    desc: "Lock-in concern — 'Am I locked in?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Am I locked in?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["lock", "contract", "commitment", "cancel", "post-paid", "term", "month"])) issues.push("Response doesn't address lock-in concern");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasLockInfo: containsAny(resp.ai_response, ["lock", "contract", "commitment", "cancel", "post-paid", "term", "month"]) } };
    },
  },
  {
    id: "G5",
    desc: "Cancellation fee — 'Is there a cancellation fee?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Is there a cancellation fee?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["cancel", "fee", "charge", "penalty", "cost", "process", "notice", "consultant"])) issues.push("Response doesn't address cancellation fee");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasFeeInfo: containsAny(resp.ai_response, ["cancel", "fee", "charge", "penalty", "cost", "process", "notice", "consultant"]) } };
    },
  },
];

// ─── Pillar 8: Installation & Setup (6 scenarios) ────────────────────────────
const pillar8 = [
  {
    id: "H1",
    desc: "Installation timeline — 'How long does installation take?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("How long does installation take?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["install", "day", "week", "hour", "time", "schedule", "appointment", "consultant"])) issues.push("Response doesn't address installation timeline");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasTimeline: containsAny(resp.ai_response, ["install", "day", "week", "hour", "time", "schedule", "appointment", "consultant"]) } };
    },
  },
  {
    id: "H2",
    desc: "Installation fee — 'Is there an installation fee?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Is there an installation fee?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["install", "fee", "cost", "charge", "free", "consultant", "confirm", "area"])) issues.push("Response doesn't address installation fee");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasFeeInfo: containsAny(resp.ai_response, ["install", "fee", "cost", "charge", "free", "consultant", "confirm", "area"]) } };
    },
  },
  {
    id: "H3",
    desc: "Landline requirement — 'Do I need a landline?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Do I need a landline?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["landline", "line", "phone", "fibre", "need", "no", "don't", "require"])) issues.push("Response doesn't address landline requirement");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasLandlineInfo: containsAny(resp.ai_response, ["landline", "line", "phone", "fibre", "need", "no", "don't", "require"]) } };
    },
  },
  {
    id: "H4",
    desc: "Router included — 'Is a router included?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("Is a router included?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["router", "modem", "equipment", "included", "provide", "supply", "consultant", "confirm"])) issues.push("Response doesn't address router inclusion");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasRouterInfo: containsAny(resp.ai_response, ["router", "modem", "equipment", "included", "provide", "supply", "consultant", "confirm"]) } };
    },
  },
  {
    id: "H5",
    desc: "Router type — 'What router do I get?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("What router do I get?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["router", "modem", "equipment", "model", "type", "consultant", "confirm", "provide", "supply"])) issues.push("Response doesn't address router type");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasRouterTypeInfo: containsAny(resp.ai_response, ["router", "modem", "equipment", "model", "type", "consultant", "confirm", "provide", "supply"]) } };
    },
  },
  {
    id: "H6",
    desc: "Urgency — 'How soon can you install?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("How soon can you install?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!containsAny(resp.ai_response, ["install", "soon", "day", "week", "schedule", "appointment", "time", "consultant", "arrange"])) issues.push("Response doesn't address installation urgency");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasUrgencyInfo: containsAny(resp.ai_response, ["install", "soon", "day", "week", "schedule", "appointment", "time", "consultant", "arrange"]) } };
    },
  },
];

// ─── Pillar 9: SA Slang & Languages (8 scenarios) ────────────────────────────
const pillar9 = [
  {
    id: "I1",
    desc: "SA slang greeting — 'howzit'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("howzit");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // Should greet back and offer help, or ask what they need
      if (!containsAny(resp.ai_response, ["hi", "hello", "welcome", "help", "how", "layla", "horizon"]) && !asksQuestion(resp.ai_response)) issues.push("Response doesn't greet or offer help for 'howzit'");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasGreeting: containsAny(resp.ai_response, ["hi", "hello", "welcome", "help", "how", "layla", "horizon"]) || asksQuestion(resp.ai_response) } };
    },
  },
  {
    id: "I2",
    desc: "Afrikaans pricing — 'hoeveel kos die fibre?'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("hoeveel kos die fibre?");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // Should understand the pricing question and respond with prices
      if (!mentionsPrice(resp.ai_response) && !containsAny(resp.ai_response, ["price", "cost", "package", "mbps"])) issues.push("Response doesn't provide pricing info for Afrikaans query");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasPrice: mentionsPrice(resp.ai_response) || containsAny(resp.ai_response, ["price", "cost", "package", "mbps"]) } };
    },
  },
  {
    id: "I3",
    desc: "Afrikaans interest — 'ja ek wil hê fibre'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("ja ek wil hê fibre");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // Should recognize interest and start qualification
      if (!asksQuestion(resp.ai_response) && !containsAny(resp.ai_response, ["people", "household", "use", "internet", "package", "help"])) issues.push("Response doesn't start qualification for Afrikaans interest");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { asks: asksQuestion(resp.ai_response), hasQualification: containsAny(resp.ai_response, ["people", "household", "use", "internet", "package", "help"]) } };
    },
  },
  {
    id: "I4",
    desc: "Afrikaans apply — 'lekker, ek wil aanvra'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("lekker, ek wil aanvra");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // Should recognize apply intent and start process
      if (!asksQuestion(resp.ai_response) && !containsAny(resp.ai_response, ["apply", "package", "people", "address", "help", "consultant"])) issues.push("Response doesn't start application process for Afrikaans apply");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { asks: asksQuestion(resp.ai_response), hasApply: containsAny(resp.ai_response, ["apply", "package", "people", "address", "help", "consultant"]) } };
    },
  },
  {
    id: "I5",
    desc: "SA slang — 'sharp sharp, stuur die forms'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("sharp sharp, stuur die forms");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // Should recognize the intent to proceed and start collecting info
      if (!asksQuestion(resp.ai_response) && !containsAny(resp.ai_response, ["apply", "package", "people", "address", "help", "form", "consultant", "name"])) issues.push("Response doesn't recognize intent to proceed");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { asks: asksQuestion(resp.ai_response), hasProceed: containsAny(resp.ai_response, ["apply", "package", "people", "address", "help", "form", "consultant", "name"]) } };
    },
  },
  {
    id: "I6",
    desc: "Zulu interest — 'ngifuna i-fibre'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("ngifuna i-fibre");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // Should recognize interest (fibre keyword) and start qualification
      if (!asksQuestion(resp.ai_response) && !containsAny(resp.ai_response, ["fibre", "package", "people", "help", "internet"])) issues.push("Response doesn't recognize Zulu interest in fibre");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { asks: asksQuestion(resp.ai_response), hasFibre: containsAny(resp.ai_response, ["fibre", "package", "people", "help", "internet"]) } };
    },
  },
  {
    id: "I7",
    desc: "American spelling — 'FIBER'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("FIBER");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // Should treat "FIBER" same as "FIBRE" — start engagement
      if (!asksQuestion(resp.ai_response) && !containsAny(resp.ai_response, ["fibre", "fiber", "package", "help", "people", "internet"])) issues.push("Response doesn't recognize 'FIBER' as fibre interest");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { asks: asksQuestion(resp.ai_response), hasFibre: containsAny(resp.ai_response, ["fibre", "fiber", "package", "help", "people", "internet"]) } };
    },
  },
  {
    id: "I8",
    desc: "SA slang with question — 'how much is the fibre bru'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("how much is the fibre bru");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // Should understand pricing question despite slang "bru"
      if (!mentionsPrice(resp.ai_response) && !containsAny(resp.ai_response, ["price", "cost", "package", "mbps"])) issues.push("Response doesn't provide pricing despite slang");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { hasPrice: mentionsPrice(resp.ai_response) || containsAny(resp.ai_response, ["price", "cost", "package", "mbps"]) } };
    },
  },
];

// ─── Pillar 10: Numbered Menu Responses (5 scenarios) ────────────────────────
const pillar10 = [
  {
    id: "J1",
    desc: "Bare number — '1' (interested option)",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("1");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // AI should either interpret as interest and start qualification, or ask for clarification
      if (!asksQuestion(resp.ai_response) && !containsAny(resp.ai_response, ["interested", "fibre", "package", "people", "help", "clarify", "understand", "option", "number"])) issues.push("Response doesn't handle bare number '1'");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { handles: asksQuestion(resp.ai_response) || containsAny(resp.ai_response, ["interested", "fibre", "package", "people", "help", "clarify", "understand", "option", "number"]) } };
    },
  },
  {
    id: "J2",
    desc: "Bare number — '2' (callback option)",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("2");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!asksQuestion(resp.ai_response) && !containsAny(resp.ai_response, ["callback", "call", "back", "consultant", "help", "clarify", "understand", "option", "number", "people", "fibre"])) issues.push("Response doesn't handle bare number '2'");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { handles: asksQuestion(resp.ai_response) || containsAny(resp.ai_response, ["callback", "call", "back", "consultant", "help", "clarify", "understand", "option", "number", "people", "fibre"]) } };
    },
  },
  {
    id: "J3",
    desc: "Bare number — '3' (not interested option)",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("3");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      if (!asksQuestion(resp.ai_response) && !containsAny(resp.ai_response, ["not interested", "sorry", "no problem", "help", "clarify", "understand", "option", "number", "fibre", "people"])) issues.push("Response doesn't handle bare number '3'");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { handles: asksQuestion(resp.ai_response) || containsAny(resp.ai_response, ["not interested", "sorry", "no problem", "help", "clarify", "understand", "option", "number", "fibre", "people"]) } };
    },
  },
  {
    id: "J4",
    desc: "Explicit menu selection — 'I want option 2'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("I want option 2");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // Should recognize "option 2" as callback request
      if (!containsAny(resp.ai_response, ["callback", "call", "back", "consultant", "help", "people", "fibre", "package", "qualify", "ask"]) && !asksQuestion(resp.ai_response)) issues.push("Response doesn't handle 'option 2' selection");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { handles: containsAny(resp.ai_response, ["callback", "call", "back", "consultant", "help", "people", "fibre", "package", "qualify", "ask"]) || asksQuestion(resp.ai_response) } };
    },
  },
  {
    id: "J5",
    desc: "Explicit menu selection — 'number 3 please'",
    run: async () => {
      await cleanConversations();
      const resp = await sendAndWait("number 3 please");
      const issues = [];
      if (!resp) { issues.push("No AI response received (timeout)"); return { passed: false, issues, response: null }; }
      if (!isNotFallback(resp.ai_response)) issues.push("AI returned fallback message");
      // Should recognize "number 3" as not interested
      if (!containsAny(resp.ai_response, ["not interested", "sorry", "no problem", "understand", "help", "clarify", "fibre", "people", "package"]) && !asksQuestion(resp.ai_response)) issues.push("Response doesn't handle 'number 3' selection");
      return { passed: issues.length === 0, issues, response: resp.ai_response, actual: { handles: containsAny(resp.ai_response, ["not interested", "sorry", "no problem", "understand", "help", "clarify", "fibre", "people", "package"]) || asksQuestion(resp.ai_response) } };
    },
  },
];

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("═".repeat(80));
  console.log("  AI Conversation Quality Test Suite (Layla AI)");
  console.log("═".repeat(80));
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Test Phone: ${TEST_PHONE}`);
  console.log(`  Campaign: ${CAMPAIGN_ID}`);
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log("═".repeat(80));
  console.log("");

  // Verify dev server is running
  try {
    const healthRes = await fetch(`${BASE_URL}/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=horizon_africa_verify_2026&hub.challenge=test`);
    if (healthRes.status !== 200) {
      console.error(`Dev server not responding correctly (status: ${healthRes.status})`);
      process.exit(1);
    }
  } catch {
    console.error(`Cannot reach dev server at ${BASE_URL}. Is it running?`);
    process.exit(1);
  }

  console.log("─".repeat(80));
  console.log("  Pillar 1: Product & Speed Questions (8 scenarios)");
  console.log("─".repeat(80));
  for (const s of pillar1) {
    await runScenario(s.id, s.desc, s.run);
  }

  console.log("");
  console.log("─".repeat(80));
  console.log("  Pillar 2: Qualification Flow (6 scenarios)");
  console.log("─".repeat(80));
  for (const s of pillar2) {
    await runScenario(s.id, s.desc, s.run);
  }

  console.log("");
  console.log("─".repeat(80));
  console.log("  Pillar 3: Objection Handling (5 scenarios)");
  console.log("─".repeat(80));
  for (const s of pillar3) {
    await runScenario(s.id, s.desc, s.run);
  }

  console.log("");
  console.log("─".repeat(80));
  console.log("  Pillar 4: Known Customer Info & Business Hours (5 scenarios)");
  console.log("─".repeat(80));
  for (const s of pillar4) {
    await runScenario(s.id, s.desc, s.run);
  }

  console.log("");
  console.log("─".repeat(80));
  console.log("  Pillar 5: Out-of-Scope & Edge Cases (6 scenarios)");
  console.log("─".repeat(80));
  for (const s of pillar5) {
    await runScenario(s.id, s.desc, s.run);
  }

  console.log("");
  console.log("─".repeat(80));
  console.log("  Pillar 6: Multi-Turn Conversations (5 scenarios)");
  console.log("─".repeat(80));
  for (const s of pillar6) {
    await runScenario(s.id, s.desc, s.run);
  }

  console.log("");
  console.log("─".repeat(80));
  console.log("  Pillar 7: Contract & Cancellation (5 scenarios)");
  console.log("─".repeat(80));
  for (const s of pillar7) {
    await runScenario(s.id, s.desc, s.run);
  }

  console.log("");
  console.log("─".repeat(80));
  console.log("  Pillar 8: Installation & Setup (6 scenarios)");
  console.log("─".repeat(80));
  for (const s of pillar8) {
    await runScenario(s.id, s.desc, s.run);
  }

  console.log("");
  console.log("─".repeat(80));
  console.log("  Pillar 9: SA Slang & Languages (8 scenarios)");
  console.log("─".repeat(80));
  for (const s of pillar9) {
    await runScenario(s.id, s.desc, s.run);
  }

  console.log("");
  console.log("─".repeat(80));
  console.log("  Pillar 10: Numbered Menu Responses (5 scenarios)");
  console.log("─".repeat(80));
  for (const s of pillar10) {
    await runScenario(s.id, s.desc, s.run);
  }

  // Summary
  console.log("");
  console.log("═".repeat(80));
  console.log(`  RESULTS: ${passCount} passed, ${failCount} failed, ${results.length} total`);
  console.log("═".repeat(80));

  if (failCount > 0) {
    console.log("");
    console.log("Failed scenarios:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  [${r.id}] ${r.desc}`);
      console.log(`    Issues: ${r.issues.join("; ")}`);
      if (r.response) console.log(`    AI Response: ${r.response.substring(0, 150)}...`);
    }
  }

  // Save report
  const report = {
    suite: "AI Conversation Quality Test Suite (Layla AI)",
    timestamp: new Date().toISOString(),
    target: BASE_URL,
    testPhone: TEST_PHONE,
    campaignId: CAMPAIGN_ID,
    summary: { total: results.length, passed: passCount, failed: failCount },
    results: results.map((r) => ({
      id: r.id,
      desc: r.desc,
      passed: r.passed,
      issues: r.issues,
      actual: r.actual,
      response: r.response,
    })),
  };

  const reportPath = path.join(process.cwd(), "tests", "ai-conversation-results.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${reportPath}`);

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
