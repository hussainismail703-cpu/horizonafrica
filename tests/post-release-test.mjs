#!/usr/bin/env node
/**
 * Post-Release Regression Test Suite
 *
 * Covers functionality shipped after the last full test pass
 * (see ~/.devin/plans/plan-post-release-test.md):
 *
 *   Track A — Mobile conversation pane (Playwright, 10 tests)
 *     conversation-view.tsx mobile chat pane (PR #11, commit 0f0a9c5):
 *     full-width chat on mobile/tablet, Back button, desktop side-by-side.
 *
 *   Track B — Location pin → address extraction (webhook → n8n, 5 tests)
 *     Meta "location" messages populate leads.physical_address via the
 *     inbound AI workflow (kW4ELXolGnYx2AvB).
 *
 *   Track C — Lead-score downgrade protection (webhook → n8n, 6 tests)
 *     Neutral messages must not downgrade HOT leads; explicit negative
 *     intent may; score_locked must never be overwritten.
 *
 *   Track D — Verification-chain regression (webhook → n8n, 4 tests)
 *     Catalog answers still sent, out-of-catalog questions defer honestly,
 *     escalation stays sticky, address context flows through multi-turn.
 *
 * Usage:
 *   node --env-file=.env.local tests/post-release-test.mjs
 *   node --env-file=.env.local tests/post-release-test.mjs --headed   # visible browser
 *   node --env-file=.env.local tests/post-release-test.mjs --skip-ui  # B/C/D only
 *
 * Requirements:
 *   - Dev server running on localhost:3000
 *   - n8n workflow "Inbound AI Lead Qualification" (kW4ELXolGnYx2AvB) active
 *   - Lead 2292 ("Hussain Test") exists for TEST_PHONE
 *
 * No real WhatsApp messages are sent — all inbound traffic is simulated via
 * signed Meta-format webhook payloads.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { chromium } from "playwright";
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
const TEST_EMAIL = process.env.TEST_EMAIL || "test@horizonafrica.co.za";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "TestPass123!";

const SKIP_UI = process.argv.includes("--skip-ui");
const HEADED = process.argv.includes("--headed");

// Dedicated test lead — phone 0823725575 normalized
const TEST_PHONE = "27823725575";
const TEST_CONTACT_NAME = "Hussain Test";
// Fake phones seeded for Track A switching tests — always cleaned up
const SEED_PHONE = "27999000001";
const SEED_NAME = "Post Release Test";
const SEED_PHONE2 = "27999000002";
const SEED_NAME2 = "Pane Switch Test";

const AI_TIMEOUT_MS = 90000;
const LEAD_TIMEOUT_MS = 45000;
const SCREENSHOT_DIR = path.join(process.cwd(), "tests", "screenshots", "post-release");
const RESULTS_FILE = path.join(process.cwd(), "tests", "post-release-results.json");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

// ─── Result recording ───────────────────────────────────────────────────────
const results = [];
const trackSummary = {};
let currentTrack = "setup";

function record(status, name, detail = "") {
  results.push({ track: currentTrack, name, status, detail });
  const icon = status === "PASS" ? "PASS" : status === "WARN" ? "WARN" : "FAIL";
  console.log(`  ${icon}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!trackSummary[currentTrack]) trackSummary[currentTrack] = { pass: 0, fail: 0, warn: 0 };
  trackSummary[currentTrack][status === "PASS" ? "pass" : status === "WARN" ? "warn" : "fail"]++;
}
const pass = (n, d) => record("PASS", n, d);
const fail = (n, d) => record("FAIL", n, d);
const warn = (n, d) => record("WARN", n, d);

// ─── Supabase REST helper (service role) ────────────────────────────────────
async function sb(p, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${p}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

async function getLead() {
  const res = await sb(
    `/leads?phone_number=eq.${TEST_PHONE}&select=id,full_name,lead_score,score_locked,status,status_locked,physical_address,needs_escalation,preferred_contact_number,follow_up_requested,follow_up_date,notes,rejection_reason&limit=1`
  );
  return (await res.json())[0] ?? null;
}

async function setLead(fields) {
  await sb(`/leads?phone_number=eq.${TEST_PHONE}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

/** Poll the lead row until pred(lead) is true or timeout. Returns the lead. */
async function pollLead(pred, timeoutMs = LEAD_TIMEOUT_MS) {
  const start = Date.now();
  let lead = await getLead();
  while (Date.now() - start < timeoutMs) {
    if (lead && pred(lead)) return lead;
    await new Promise((r) => setTimeout(r, 2500));
    lead = await getLead();
  }
  return lead;
}

// ─── Webhook helpers ────────────────────────────────────────────────────────
const sentWamids = [];

function baseEnvelope(messages) {
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
              messages,
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

function textWebhook(text) {
  const id = `wamid.${crypto.randomUUID()}`;
  sentWamids.push(id);
  return baseEnvelope([
    {
      from: TEST_PHONE,
      id,
      type: "text",
      text: { body: text },
      timestamp: Math.floor(Date.now() / 1000).toString(),
    },
  ]);
}

function locationWebhook(location) {
  const id = `wamid.${crypto.randomUUID()}`;
  sentWamids.push(id);
  return baseEnvelope([
    {
      from: TEST_PHONE,
      id,
      type: "location",
      location,
      timestamp: Math.floor(Date.now() / 1000).toString(),
    },
  ]);
}

async function sendWebhook(payload) {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${BASE_URL}/api/whatsapp-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...webhookHeaders(raw) },
    body: raw,
  });
  const text = await res.text();
  return { status: res.status, response: text };
}

// ─── Conversation helpers ───────────────────────────────────────────────────

/** Delete all test-phone conversations twice with a settle gap (stale async rows). */
async function cleanConversations() {
  await sb(`/conversations?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await new Promise((r) => setTimeout(r, 5000));
  await sb(`/conversations?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await new Promise((r) => setTimeout(r, 1000));
}

/** Latest conversation row for TEST_PHONE created after afterTs (15s skew tolerance). */
async function getLatestConvo(afterTs, timeoutMs = AI_TIMEOUT_MS, expectedMessage = null, requireAi = true) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await sb(
      `/conversations?phone_number=eq.${TEST_PHONE}&order=created_at.desc&limit=1&select=id,ai_response,incoming_message,lead_score,timestamp,needs_escalation,created_at`
    );
    const row = (await res.json())[0];
    if (row && (!requireAi || row.ai_response)) {
      const t = new Date(row.created_at || row.timestamp).getTime();
      if (t >= afterTs - 15000) {
        if (expectedMessage) {
          const incoming = (row.incoming_message || "").toLowerCase().trim();
          if (incoming === expectedMessage.toLowerCase().trim()) return row;
        } else {
          return row;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

/** Send a text webhook and wait for the AI response row. */
async function sendAndWait(text, timeoutMs = AI_TIMEOUT_MS) {
  const beforeSend = Date.now();
  const sent = await sendWebhook(textWebhook(text));
  const convo = await getLatestConvo(beforeSend, timeoutMs, text);
  return { sent, convo };
}

// ─── Assertion helpers ──────────────────────────────────────────────────────
const containsAny = (text, keywords) =>
  !!text && keywords.some((k) => text.toLowerCase().includes(k.toLowerCase()));

/** The n8n safe-fallback signature — response deferred to a consultant. */
const isFallback = (text) =>
  !!text && containsAny(text, ["consultants will confirm", "get back to you shortly"]);

// ─── State snapshot / restore ───────────────────────────────────────────────
let leadSnapshot = null;

async function snapshotLead() {
  leadSnapshot = await getLead();
  console.log(`  Snapshot lead ${leadSnapshot?.id}: score=${leadSnapshot?.lead_score} ` +
    `locked=${leadSnapshot?.score_locked} addr=${JSON.stringify(leadSnapshot?.physical_address)} ` +
    `escalation=${leadSnapshot?.needs_escalation}`);
}

async function restoreLead() {
  if (!leadSnapshot) return;
  await setLead({
    lead_score: leadSnapshot.lead_score,
    score_locked: leadSnapshot.score_locked,
    status: leadSnapshot.status,
    status_locked: leadSnapshot.status_locked,
    physical_address: leadSnapshot.physical_address,
    needs_escalation: leadSnapshot.needs_escalation,
    preferred_contact_number: leadSnapshot.preferred_contact_number,
    follow_up_requested: leadSnapshot.follow_up_requested,
    follow_up_date: leadSnapshot.follow_up_date,
    notes: leadSnapshot.notes,
    rejection_reason: leadSnapshot.rejection_reason,
  });
  console.log("  Lead restored to snapshot state");
}

// ─── Playwright helpers ─────────────────────────────────────────────────────
async function screenshot(page, name) {
  try {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
  } catch { /* best effort */ }
}

async function login(page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500); // React hydration
    await page.locator("#email").fill(TEST_EMAIL);
    await page.locator("#password").fill(TEST_PASSWORD);
    await page.locator('form:has(#email) button[type="submit"]').click();
    try {
      await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20000 });
      return;
    } catch {
      if (attempt === 1) throw new Error("Login failed after retry");
      await page.waitForTimeout(2000);
    }
  }
}

/** Conversation-item buttons inside the scrollable list (space-y-1 container). */
const convoButtons = (page) => page.locator("div.space-y-1.overflow-y-auto button");
/** Chat pane root — flex-1+flex-col+rounded-xl uniquely identifies it (the
 *  dashboard shell wrapper is also flex-1 flex-col but has no rounded-xl). */
const chatPane = (page) => page.locator("div.flex-1.flex-col.rounded-xl");
const listSearch = (page) => page.locator('input[placeholder="Search conversations..."]');
const backButton = (page) => page.locator('button[aria-label="Back to conversations"]');
const emptyState = (page) => page.locator("text=Select a conversation to view message history");

// ═══════════════════════════════════════════════════════════════════════════
// TRACK A — Mobile conversation pane
// ═══════════════════════════════════════════════════════════════════════════
async function trackA(browser) {
  currentTrack = "A-mobile-pane";
  console.log("\n═══ Track A: Mobile conversation pane ═══");

  // Ensure at least two distinct conversation groups exist for A7 switching.
  for (const [phone, name, body] of [
    [SEED_PHONE, SEED_NAME, "Post-release pane test message"],
    [SEED_PHONE2, SEED_NAME2, "Second pane test message"],
  ]) {
    await sb(`/conversations?phone_number=eq.${phone}`, { method: "DELETE" });
    await sb("/conversations", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        phone_number: phone,
        contact_name: name,
        incoming_message: body,
        ai_response: "Seeded test response",
        lead_score: "COLD",
        timestamp: new Date(Date.now() - 60000).toISOString(),
      }),
    });
  }

  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  try {
    await login(page);
    await page.goto(`${BASE_URL}/conversations`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    // A1: list renders, chat pane hidden initially
    try {
      const listVisible = await listSearch(page).isVisible();
      const emptyVisible = await emptyState(page).isVisible().catch(() => false);
      const backVisible = await backButton(page).isVisible().catch(() => false);
      const items = await convoButtons(page).count();
      if (listVisible && !emptyVisible && !backVisible && items >= 1)
        pass("A1 Mobile: conversation list renders, chat pane hidden", `${items} conversation(s)`);
      else
        fail("A1 Mobile initial render", `list:${listVisible} empty:${emptyVisible} back:${backVisible} items:${items}`);
    } catch (e) { fail("A1 Mobile initial render", e.message); }

    // A2: tap a conversation → chat opens full-width
    try {
      await convoButtons(page).first().click();
      await page.waitForTimeout(1200);
      const backVisible = await backButton(page).isVisible().catch(() => false);
      const msgArea = await page.locator("div.space-y-4.overflow-y-auto").isVisible().catch(() => false);
      if (backVisible && msgArea) pass("A2 Tap conversation opens chat pane");
      else fail("A2 Tap conversation opens chat pane", `back:${backVisible} msgs:${msgArea}`);
    } catch (e) { fail("A2 Tap conversation opens chat pane", e.message); await screenshot(page, "a2"); }

    // A3: list pane hidden while chat open
    try {
      const listVisible = await listSearch(page).isVisible().catch(() => false);
      if (!listVisible) pass("A3 List pane hidden while chat open");
      else fail("A3 List pane hidden while chat open", "search input still visible");
    } catch (e) { fail("A3 List pane hidden while chat open", e.message); }

    // A4: Back button visible with label + text
    try {
      const back = backButton(page);
      const visible = await back.isVisible();
      const backText = await back.locator("span").isVisible().catch(() => false);
      if (visible && backText) pass("A4 Back button visible with 'Back' text");
      else fail("A4 Back button visible", `btn:${visible} text:${backText}`);
    } catch (e) { fail("A4 Back button visible", e.message); }

    // A5: Back returns to list, chat hidden
    try {
      await backButton(page).click();
      await page.waitForTimeout(1000);
      const listVisible = await listSearch(page).isVisible();
      const msgAreaVisible = await page.locator("div.space-y-4.overflow-y-auto").isVisible().catch(() => false);
      const emptyVisible = await emptyState(page).isVisible().catch(() => false);
      if (listVisible && !msgAreaVisible && !emptyVisible)
        pass("A5 Back returns to list, chat hidden");
      else
        fail("A5 Back returns to list", `list:${listVisible} msgs:${msgAreaVisible} empty:${emptyVisible}`);
    } catch (e) { fail("A5 Back returns to list", e.message); }

    // A6: messages render on mobile; input read-only
    try {
      await convoButtons(page).filter({ hasText: SEED_NAME }).first().click();
      await page.waitForTimeout(1200);
      const bubbles = await page.locator("div.space-y-4.overflow-y-auto > div").count();
      const input = page.locator('input[placeholder^="Type a message"]');
      const inputDisabled = await input.isDisabled();
      if (bubbles >= 1 && inputDisabled)
        pass("A6 Chat messages render on mobile, input read-only", `${bubbles} message row(s)`);
      else
        fail("A6 Messages render / input read-only", `bubbles:${bubbles} disabled:${inputDisabled}`);
    } catch (e) { fail("A6 Messages render / input read-only", e.message); }

    // A7: switch conversations — Back, open the other seeded conversation
    try {
      await backButton(page).click();
      await page.waitForTimeout(800);
      await convoButtons(page).filter({ hasText: SEED_NAME2 }).first().click();
      await page.waitForTimeout(1200);
      // Scope to the chat pane — unscoped .first() hits the hidden list button.
      const newHeader = await chatPane(page).locator(`text=${SEED_NAME2}`).first().isVisible().catch(() => false);
      const newBody = await chatPane(page).locator("text=Second pane test message").isVisible().catch(() => false);
      const oldBody = await chatPane(page).locator("text=Post-release pane test message").isVisible().catch(() => false);
      if (newHeader && newBody && !oldBody) pass("A7 Switching conversations loads new chat");
      else fail("A7 Switching conversations", `header:${newHeader} new:${newBody} old:${oldBody}`);
    } catch (e) { fail("A7 Switching conversations", e.message); await screenshot(page, "a7"); }

    // A8: tablet 768px — same mobile behavior (below lg=1024)
    try {
      await backButton(page).click().catch(() => {});
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.waitForTimeout(1000);
      const listVisible = await listSearch(page).isVisible();
      await convoButtons(page).first().click();
      await page.waitForTimeout(1000);
      const listHidden = !(await listSearch(page).isVisible().catch(() => false));
      const backVisible = await backButton(page).isVisible();
      const backText = await backButton(page).locator("span").isVisible().catch(() => false);
      if (listVisible && listHidden && backVisible && backText)
        pass("A8 Tablet 768px: same mobile behavior");
      else
        fail("A8 Tablet 768px", `listBefore:${listVisible} listHidden:${listHidden} back:${backVisible} backText:${backText}`);
    } catch (e) { fail("A8 Tablet 768px", e.message); }

    // A9: desktop 1440px — side-by-side, X has no "Back" text, close keeps list
    try {
      await backButton(page).click().catch(() => {});
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(1000);
      await convoButtons(page).first().click();
      await page.waitForTimeout(1000);
      const listVisible = await listSearch(page).isVisible();
      const backText = await backButton(page).locator("span").isVisible().catch(() => false);
      await backButton(page).click();
      await page.waitForTimeout(800);
      const listStillVisible = await listSearch(page).isVisible();
      const emptyVisible = await emptyState(page).isVisible();
      if (listVisible && !backText && listStillVisible && emptyVisible)
        pass("A9 Desktop 1440px: side-by-side, X closes chat, list stays");
      else
        fail("A9 Desktop 1440px", `list:${listVisible} backText:${backText} listAfter:${listStillVisible} empty:${emptyVisible}`);
    } catch (e) { fail("A9 Desktop 1440px", e.message); await screenshot(page, "a9"); }

    // A10: no horizontal overflow at 375px
    try {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${BASE_URL}/conversations`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      if (overflow <= 1) pass("A10 No horizontal overflow at 375px");
      else fail("A10 No horizontal overflow at 375px", `overflow=${overflow}px`);
    } catch (e) { fail("A10 No horizontal overflow", e.message); }
  } catch (e) {
    fail("Track A setup", e.message);
    await screenshot(page, "track-a-fatal");
  } finally {
    await ctx.close();
    await sb(`/conversations?phone_number=eq.${SEED_PHONE}`, { method: "DELETE" });
    await sb(`/conversations?phone_number=eq.${SEED_PHONE2}`, { method: "DELETE" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TRACK B — Location pin → physical_address extraction
// ═══════════════════════════════════════════════════════════════════════════
const TEST_LOCATION = {
  latitude: -26.185,
  longitude: 28.004,
  name: "Sultan Bahu Centre",
  address: "96 3rd Ave, Johannesburg",
};

async function trackB() {
  currentTrack = "B-location";
  console.log("\n═══ Track B: Location pin → address extraction ═══");

  // Reset address so B2 asserts a fresh extraction
  await setLead({ physical_address: null });
  await cleanConversations();

  // B1: location webhook accepted, conversation logged
  let locationConvo = null;
  try {
    const beforeSend = Date.now();
    const sent = await sendWebhook(locationWebhook(TEST_LOCATION));
    locationConvo = await getLatestConvo(beforeSend, AI_TIMEOUT_MS, null, false);
    if (sent.status === 200 && locationConvo) pass("B1 Location webhook accepted, conversation logged");
    else fail("B1 Location webhook accepted", `status:${sent.status} convo:${!!locationConvo}`);
  } catch (e) { fail("B1 Location webhook accepted", e.message); }

  // B2: physical_address updated on the lead
  try {
    const lead = await pollLead(
      (l) => !!l.physical_address && l.physical_address.length > 3,
      AI_TIMEOUT_MS
    );
    if (lead?.physical_address) {
      const a = lead.physical_address.toLowerCase();
      if (containsAny(a, ["3rd", "ave", "johannesburg", "sultan"]))
        pass("B2 physical_address populated from location pin", lead.physical_address);
      else
        warn("B2 physical_address populated but unexpected content", lead.physical_address);
    } else {
      fail("B2 physical_address populated", `still null — got ${JSON.stringify(lead?.physical_address)}`);
    }
  } catch (e) { fail("B2 physical_address populated", e.message); }

  // B3: street abbreviation normalized ("3rd Ave" → "Avenue")
  try {
    const lead = await getLead();
    const addr = (lead?.physical_address || "").toLowerCase();
    if (addr.includes("avenue")) pass("B3 Street abbreviation normalized to 'Avenue'", lead.physical_address);
    else if (addr.includes("ave")) warn("B3 Abbreviation stored unexpanded", lead.physical_address);
    else fail("B3 Street abbreviation normalized", `address=${JSON.stringify(lead?.physical_address)}`);
  } catch (e) { fail("B3 Street abbreviation normalized", e.message); }

  // B4: AI references the stored address in a follow-up message
  try {
    const { convo } = await sendAndWait("Can you confirm what address you have on file for me?");
    const r = convo?.ai_response || "";
    if (convo && containsAny(r, ["avenue", "johannesburg", "sultan", "3rd"]))
      pass("B4 AI references stored address (known_customer context)");
    else if (convo && containsAny(r, ["address", "on file"]))
      warn("B4 AI acknowledged address request without quoting it", r.slice(0, 120));
    else
      fail("B4 AI references stored address", `response=${(r || "none").slice(0, 120)}`);
  } catch (e) { fail("B4 AI references stored address", e.message); }

  // B5: location-only message body not corrupted
  try {
    const body = (locationConvo?.incoming_message || "").toLowerCase();
    if (body && containsAny(body, ["location", "ave", "3rd", "sultan", "johannesburg", "-26"]))
      pass("B5 Location message body readable in conversation log", (locationConvo.incoming_message || "").slice(0, 90));
    else if (body && body.length > 3)
      warn("B5 Location body stored but format unexpected", locationConvo.incoming_message.slice(0, 90));
    else
      fail("B5 Location message body readable", `body=${JSON.stringify(locationConvo?.incoming_message)}`);
  } catch (e) { fail("B5 Location message body readable", e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════
// TRACK C — Lead-score downgrade protection
// ═══════════════════════════════════════════════════════════════════════════
const SCORE_RANK = { COLD: 1, WARM: 2, HOT: 3 };
const VALID_SCORES = ["HOT", "WARM", "COLD"];

async function trackC() {
  currentTrack = "C-score-protection";
  console.log("\n═══ Track C: Lead-score downgrade protection ═══");

  async function scoreScenario(name, { initial, locked = false, message, expect }) {
    await setLead({ lead_score: initial, score_locked: locked });
    await cleanConversations();
    const { convo } = await sendAndWait(message);
    if (!convo) {
      fail(name, "no AI response received");
      return null;
    }
    // Log Conversation can complete slightly before Upsert Lead — wait until
    // the score leaves `initial` (a write was applied) or the grace expires.
    const start = Date.now();
    let lead = await getLead();
    while (Date.now() - start < 20000) {
      if (lead && lead.lead_score !== initial) break; // score write observed
      if (Date.now() - start > 12000) break;          // grace — no write intended
      await new Promise((r) => setTimeout(r, 2500));
      lead = await getLead();
    }
    return lead;
  }

  // C1: HOT + neutral "ok thanks" → stays HOT
  try {
    const lead = await scoreScenario("C1", {
      initial: "HOT",
      message: "ok thanks",
    });
    if (lead?.lead_score === "HOT") pass("C1 HOT + 'ok thanks' stays HOT");
    else fail("C1 HOT + 'ok thanks' stays HOT", `score=${lead?.lead_score}`);
  } catch (e) { fail("C1 HOT + neutral stays HOT", e.message); }

  // C2: HOT + "thanks, bye" → stays HOT
  try {
    const lead = await scoreScenario("C2", {
      initial: "HOT",
      message: "thanks, bye for now",
    });
    if (lead?.lead_score === "HOT") pass("C2 HOT + 'thanks, bye' stays HOT");
    else fail("C2 HOT + 'thanks, bye' stays HOT", `score=${lead?.lead_score}`);
  } catch (e) { fail("C2 HOT + 'thanks, bye' stays HOT", e.message); }

  // C3: HOT + explicit negative → may downgrade (allowed), must stay valid
  try {
    const lead = await scoreScenario("C3", {
      initial: "HOT",
      message: "I am not interested anymore, please leave me alone",
    });
    if (lead && VALID_SCORES.includes(lead.lead_score))
      pass("C3 HOT + explicit negative handled", `score=${lead.lead_score} (downgrade allowed)`);
    else
      fail("C3 HOT + explicit negative handled", `score=${lead?.lead_score}`);
  } catch (e) { fail("C3 Explicit negative", e.message); }

  // C4: COLD + strong positive → upgrades
  try {
    const lead = await scoreScenario("C4", {
      initial: "COLD",
      message: "I want to apply for the fibre package now",
    });
    if (lead && SCORE_RANK[lead.lead_score] > SCORE_RANK.COLD)
      pass("C4 COLD + 'I want to apply' upgrades", `score=${lead.lead_score}`);
    else
      fail("C4 COLD + positive upgrades", `score=${lead?.lead_score}`);
  } catch (e) { fail("C4 COLD + positive upgrades", e.message); }

  // C5: locked WARM + strong positive → stays WARM (manual lock wins)
  try {
    const lead = await scoreScenario("C5", {
      initial: "WARM",
      locked: true,
      message: "I definitely want to sign up today",
    });
    if (lead?.lead_score === "WARM" && lead?.score_locked === true)
      pass("C5 score_locked=true survives strong positive", "score stayed WARM");
    else
      fail("C5 score_locked respected", `score=${lead?.lead_score} locked=${lead?.score_locked}`);
    await setLead({ score_locked: false });
  } catch (e) { fail("C5 score_locked respected", e.message); await setLead({ score_locked: false }); }

  // C6: WARM + mildly positive → never downgrades to COLD
  try {
    const lead = await scoreScenario("C6", {
      initial: "WARM",
      message: "tell me more about the packages",
    });
    if (lead && SCORE_RANK[lead.lead_score] >= SCORE_RANK.WARM)
      pass("C6 WARM + mildly positive never downgrades", `score=${lead.lead_score}`);
    else
      fail("C6 WARM + mildly positive", `score=${lead?.lead_score}`);
  } catch (e) { fail("C6 WARM + mildly positive", e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════
// TRACK D — Verification-chain regression
// ═══════════════════════════════════════════════════════════════════════════
async function trackD() {
  currentTrack = "D-verification";
  console.log("\n═══ Track D: Verification-chain regression ═══");

  await cleanConversations();

  // D1: catalog question answered directly, not safe-fallback
  try {
    const { convo } = await sendAndWait("Do you have uncapped fibre?");
    const r = convo?.ai_response || "";
    if (convo && !isFallback(r) && containsAny(r, ["uncapped", "fibre", "mbps"]))
      pass("D1 Catalog question answered directly", r.slice(0, 90));
    else if (convo && isFallback(r))
      fail("D1 Catalog question answered directly", "JEV rejected valid catalog answer (safe fallback)");
    else
      fail("D1 Catalog question answered directly", `response=${(r || "none").slice(0, 90)}`);
  } catch (e) { fail("D1 Catalog question", e.message); }

  // D2: out-of-catalog question → honest consultant deferral
  try {
    const { convo } = await sendAndWait("What is the contract length?");
    const r = convo?.ai_response || "";
    if (convo && (isFallback(r) || containsAny(r, ["consultant", "contract", "month", "confirm"])))
      pass("D2 Out-of-catalog question gets honest deferral", r.slice(0, 90));
    else
      fail("D2 Out-of-catalog question", `response=${(r || "none").slice(0, 90)}`);
  } catch (e) { fail("D2 Out-of-catalog question", e.message); }

  // D3: escalation persists and stays sticky
  try {
    await setLead({ needs_escalation: false });
    const { convo } = await sendAndWait("Please have a consultant call me back");
    if (!convo) {
      fail("D3 Escalation persisted", "no AI response to callback request");
    } else {
      const escalated = await pollLead((l) => l?.needs_escalation === true, LEAD_TIMEOUT_MS);
      if (!escalated?.needs_escalation) {
        fail("D3 Escalation persisted", `needs_escalation=${escalated?.needs_escalation}`);
      } else {
        await sendAndWait("ok");
        const after = await pollLead((l) => l?.needs_escalation !== undefined, 15000);
        if (after?.needs_escalation === true)
          pass("D3 needs_escalation set and stays sticky across messages");
        else
          fail("D3 needs_escalation sticky", `after neutral msg=${after?.needs_escalation}`);
      }
    }
  } catch (e) { fail("D3 Escalation persisted", e.message); }

  // D4: address context flows through multi-turn conversation
  try {
    const lead = await getLead();
    if (!lead?.physical_address) {
      warn("D4 Address context multi-turn", "no physical_address — Track B may have failed");
    } else {
      const { convo } = await sendAndWait("Will the installation be at the address I sent you?");
      const r = convo?.ai_response || "";
      if (convo && containsAny(r, ["address", "avenue", "johannesburg", "install", "sultan", "3rd"]))
        pass("D4 Address context flows through multi-turn", r.slice(0, 90));
      else
        fail("D4 Address context multi-turn", `response=${(r || "none").slice(0, 90)}`);
    }
  } catch (e) { fail("D4 Address context multi-turn", e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("Post-Release Regression Test Suite");
  console.log(`Target: ${BASE_URL} | Test phone: ${TEST_PHONE}`);
  console.log(`UI tests: ${SKIP_UI ? "skipped" : HEADED ? "headed" : "headless"}\n`);

  // Preflight
  try {
    const ping = await fetch(`${BASE_URL}/login`, { method: "HEAD" }).catch(() => null);
    if (!ping || (ping.status !== 200 && ping.status !== 307)) {
      console.error(`Dev server not reachable at ${BASE_URL} (got ${ping?.status})`);
      process.exit(1);
    }
    const lead = await getLead();
    if (!lead) {
      console.error(`Test lead for ${TEST_PHONE} not found — cannot run Tracks B–D`);
      process.exit(1);
    }
  } catch (e) {
    console.error("Preflight failed:", e.message);
    process.exit(1);
  }

  await snapshotLead();

  if (!SKIP_UI) {
    const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 150 : 0 });
    try {
      await trackA(browser);
    } finally {
      await browser.close();
    }
  }

  await trackB();
  await trackC();
  await trackD();

  // ─── Cleanup ────────────────────────────────────────────────────────────
  console.log("\n═══ Cleanup ═══");
  try {
    await restoreLead();
    await sb(`/conversations?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
    await sb(`/conversations?phone_number=eq.${SEED_PHONE}`, { method: "DELETE" });
    await sb(`/conversations?phone_number=eq.${SEED_PHONE2}`, { method: "DELETE" });
    for (const wamid of sentWamids) {
      await sb(`/inbound_webhook_messages?wamid=eq.${encodeURIComponent(wamid)}`, { method: "DELETE" });
    }
    console.log(`  Removed ${sentWamids.length} webhook dedup markers`);
  } catch (e) {
    console.log("  Cleanup warning:", e.message);
  }

  // ─── Summary ────────────────────────────────────────────────────────────
  const p = results.filter((r) => r.status === "PASS").length;
  const f = results.filter((r) => r.status === "FAIL").length;
  const w = results.filter((r) => r.status === "WARN").length;
  console.log("\n════════════════ SUMMARY ════════════════");
  for (const [track, s] of Object.entries(trackSummary)) {
    console.log(`  ${track}: ${s.pass} pass, ${s.fail} fail, ${s.warn} warn`);
  }
  console.log(`\nTOTAL: ${p}/${results.length} passed, ${f} failed, ${w} warnings`);

  fs.writeFileSync(
    RESULTS_FILE,
    JSON.stringify({ ranAt: new Date().toISOString(), total: results.length, passed: p, failed: f, warnings: w, results }, null, 2)
  );
  console.log(`Results: ${RESULTS_FILE}`);
  process.exit(f > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
