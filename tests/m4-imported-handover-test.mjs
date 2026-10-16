#!/usr/bin/env node
/**
 * Eastern Wear M4 — Imported Orders Track + Human-Handover Pause test.
 *
 * Covers:
 *   - POST /api/handover auth, set/clear of leads.human_takeover
 *   - POST /api/orders/imported creating an imported-track order with
 *     status handed_to_orders + order_events audit row
 *   - WhatsApp webhook forwarding carrying _layla_context.human_takeover
 *     (verified against a captured n8n endpoint on a second dev server)
 *   - Conversations UI "Human in control" badge + Release button
 *   - Orders UI track badge / status label for imported orders
 *   - Reports API orders-by-track aggregates
 *
 * Usage:
 *   node --env-file=.env.local tests/m4-imported-handover-test.mjs
 *   node --env-file=.env.local tests/m4-imported-handover-test.mjs --headed
 *   node --env-file=.env.local tests/m4-imported-handover-test.mjs --skip-ui
 *   node --env-file=.env.local tests/m4-imported-handover-test.mjs --skip-webhook
 *
 * Safety: all test rows are cleaned up. A second dev server is spawned on
 * port 3100 with N8N_WEBHOOK_URL pointed at a local capture listener so no
 * real n8n/WhatsApp traffic is produced.
 */

import fs from "fs";
import path from "path";
import http from "http";
import crypto from "crypto";
import { spawn } from "child_process";
import { chromium } from "playwright";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));

const BASE_URL = process.env.TEST_TARGET || "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_SECRET = process.env.APP_SECRET;
const META_APP_SECRET = process.env.META_APP_SECRET;
const TEST_EMAIL = process.env.TEST_EMAIL || "test@horizonafrica.co.za";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "TestPass123!";
const HEADED = process.argv.includes("--headed");
const SKIP_UI = process.argv.includes("--skip-ui");
const SKIP_WEBHOOK = process.argv.includes("--skip-webhook");
const PROXY_PORT = 3100;
const CAPTURE_PORT = 4114;

const TEST_PHONE_LOCAL = "0799900311";
const TEST_PHONE = "27799900311";
const TEST_NAME = "M4 Handover Test";
const RESULTS_FILE = path.join(process.cwd(), "tests", "m4-imported-handover-results.json");
const SCREENSHOT_DIR = path.join(process.cwd(), "tests", "screenshots", "m4");

const missing = [
  ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
  ["APP_SECRET", APP_SECRET],
].filter(([, value]) => !value).map(([key]) => key);

const results = [];
let currentTrack = "setup";

function record(status, name, detail = "") {
  results.push({ track: currentTrack, name, status, detail });
  console.log(`  ${status}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const pass = (name, detail) => record("PASS", name, detail);
const fail = (name, detail) => record("FAIL", name, detail);
const warn = (name, detail) => record("WARN", name, detail);

async function sb(pathname, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${pathname}`, {
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
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, ok: res.ok };
}

async function api(base, pathname, options = {}) {
  const res = await fetch(`${base}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.auth ? { Authorization: `Bearer ${APP_SECRET}` } : {}),
      ...options.headers,
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, ok: res.ok };
}

async function waitFor(label, fn, timeoutMs = 15_000, intervalMs = 750) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function metaSignature(rawBody) {
  return "sha256=" + crypto.createHmac("sha256", META_APP_SECRET).update(rawBody, "utf8").digest("hex");
}

function metaWebhookBody(phone, text, wamid) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: "test",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "27757774389", phone_number_id: "1257101724147822" },
          contacts: [{ profile: { name: TEST_NAME }, wa_id: phone }],
          messages: [{
            from: phone,
            id: wamid,
            timestamp: Math.floor(Date.now() / 1000).toString(),
            type: "text",
            text: { body: text },
          }],
        },
      }],
    }],
  });
}

/** Minimal HTTP listener that records POSTed JSON bodies. */
function startCaptureServer() {
  const captured = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      captured.push({ url: req.url, body: data });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"message":"captured"}');
    });
  });
  return new Promise((resolve) => {
    server.listen(CAPTURE_PORT, "127.0.0.1", () => resolve({ server, captured }));
  });
}

/** Boot a second dev server whose webhook forwards to the capture listener. */
function startProxyServer() {
  const proc = spawn("npm", ["run", "dev", "--", "-p", String(PROXY_PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      N8N_WEBHOOK_URL: `http://127.0.0.1:${CAPTURE_PORT}/capture`,
      N8N_ERROR_WEBHOOK_URL: `http://127.0.0.1:${CAPTURE_PORT}/error`,
      PORT: String(PROXY_PORT),
      // Two `next dev` processes in one directory must not share .next — they
      // overwrite each other's manifests and routes start 404ing.
      NEXT_DIST_DIR: ".next-proxy",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return proc;
}

async function waitForServer(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET", redirect: "manual" });
      if (res.status < 600) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

async function seedConversation() {
  return sb("/conversations", {
    method: "POST",
    body: JSON.stringify({
      phone_number: TEST_PHONE,
      contact_name: TEST_NAME,
      incoming_message: "I want to order the imported abaya",
      ai_response: "Let me hand you to our orders team.",
      lead_score: "WARM",
      timestamp: new Date().toISOString(),
    }),
  });
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  if (missing.length) {
    fail("Required environment configured", missing.join(", "));
    throw new Error("Missing required environment");
  }
  pass("Required environment configured", "Supabase + APP_SECRET present");

  // --- Test lead -------------------------------------------------------------
  await sb(`/leads?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  const inserted = await sb("/leads", {
    method: "POST",
    body: JSON.stringify({ phone_number: TEST_PHONE, full_name: TEST_NAME }),
  });
  if (!inserted.ok || !inserted.body?.[0]?.id) {
    throw new Error(`Could not create test lead: ${JSON.stringify(inserted.body)}`);
  }
  const leadId = inserted.body[0].id;
  pass("Test lead prepared", `lead_id=${leadId}, phone=${TEST_PHONE}`);

  let importedOrderId = null;
  let proxyProc = null;
  let captureServer = null;
  let browser = null;
  const seededConversations = [];

  try {
    // ==================================================================
    currentTrack = "handover-api";
    // ==================================================================

    const unauth = await api(BASE_URL, "/api/handover", {
      method: "POST",
      body: JSON.stringify({ phone: TEST_PHONE, take_over: true, by: "test" }),
    });
    unauth.status === 401
      ? pass("Unauthenticated handover rejected")
      : fail("Unauthenticated handover rejected", `expected 401, got ${unauth.status}`);

    const missingFields = await api(BASE_URL, "/api/handover", {
      method: "POST",
      auth: true,
      body: JSON.stringify({ phone: TEST_PHONE }),
    });
    missingFields.status === 400
      ? pass("Handover without take_over rejected")
      : fail("Handover without take_over rejected", `got ${missingFields.status}`);

    const takeover = await api(BASE_URL, "/api/handover", {
      method: "POST",
      auth: true,
      body: JSON.stringify({ phone: TEST_PHONE_LOCAL, take_over: true, by: "m4-test" }),
    });
    takeover.status === 200 && takeover.body?.human_takeover === true && takeover.body?.matched === 1
      ? pass("Takeover flag set via APP_SECRET", `matched=${takeover.body?.matched}`)
      : fail("Takeover flag set via APP_SECRET", `got ${takeover.status}: ${JSON.stringify(takeover.body)}`);

    const flagged = await sb(`/leads?id=eq.${leadId}&select=human_takeover,human_takeover_at,human_takeover_by`);
    flagged.body?.[0]?.human_takeover === true && flagged.body?.[0]?.human_takeover_by === "m4-test" && flagged.body?.[0]?.human_takeover_at
      ? pass("Lead row carries takeover flag + actor + timestamp")
      : fail("Lead row carries takeover flag + actor + timestamp", JSON.stringify(flagged.body?.[0]));

    // Idempotent second set — still fine
    const takeover2 = await api(BASE_URL, "/api/handover", {
      method: "POST",
      auth: true,
      body: JSON.stringify({ phone: TEST_PHONE, take_over: true, by: "chatwoot" }),
    });
    takeover2.status === 200
      ? pass("Repeated takeover is idempotent")
      : fail("Repeated takeover is idempotent", `got ${takeover2.status}`);

    const release = await api(BASE_URL, "/api/handover", {
      method: "POST",
      auth: true,
      body: JSON.stringify({ phone: TEST_PHONE, take_over: false, by: "m4-test" }),
    });
    const cleared = await sb(`/leads?id=eq.${leadId}&select=human_takeover,human_takeover_at,human_takeover_by`);
    release.status === 200 && cleared.body?.[0]?.human_takeover === false && cleared.body?.[0]?.human_takeover_at === null
      ? pass("Release clears takeover flag and actor")
      : fail("Release clears takeover flag and actor", `release=${release.status} row=${JSON.stringify(cleared.body?.[0])}`);

    // ==================================================================
    currentTrack = "imported-orders-api";
    // ==================================================================

    const impUnauth = await api(BASE_URL, "/api/orders/imported", {
      method: "POST",
      body: JSON.stringify({ phone: TEST_PHONE, item_description: "Imported abaya" }),
    });
    impUnauth.status === 401
      ? pass("Unauthenticated imported order rejected")
      : fail("Unauthenticated imported order rejected", `expected 401, got ${impUnauth.status}`);

    const impMissing = await api(BASE_URL, "/api/orders/imported", {
      method: "POST",
      auth: true,
      body: JSON.stringify({ phone: TEST_PHONE }),
    });
    impMissing.status === 400
      ? pass("Imported order without item_description rejected")
      : fail("Imported order without item_description rejected", `got ${impMissing.status}`);

    const impBadPhone = await api(BASE_URL, "/api/orders/imported", {
      method: "POST",
      auth: true,
      body: JSON.stringify({ phone: "07999000311", item_description: "Imported abaya" }),
    });
    impBadPhone.status === 400 && impBadPhone.body?.error === "invalid_phone"
      ? pass("Malformed phone rejected on imported track")
      : fail("Malformed phone rejected on imported track", `got ${impBadPhone.status}: ${JSON.stringify(impBadPhone.body)}`);

    const imp = await api(BASE_URL, "/api/orders/imported", {
      method: "POST",
      auth: true,
      body: JSON.stringify({
        phone: TEST_PHONE_LOCAL,
        item_description: "Black embellished abaya — online/imported",
        notes: "Customer confirmed 6-week lead + 50% deposit terms",
        customer: { name: TEST_NAME },
      }),
    });
    if (imp.status !== 201 || !imp.body?.order_id) {
      throw new Error(`Imported order creation failed: ${imp.status} ${JSON.stringify(imp.body)}`);
    }
    importedOrderId = imp.body.order_id;
    pass("Imported order created", `order #${imp.body.order_number}, status=${imp.body.status}`);

    const impOrder = await waitFor("imported order persistence", async () => {
      const res = await sb(`/orders?id=eq.${importedOrderId}&select=*&limit=1`);
      return res.body?.[0];
    });
    const impAssertions = [
      [impOrder.order_track === "imported", "imported track"],
      [impOrder.status === "handed_to_orders", "handed_to_orders status"],
      [impOrder.lead_id === leadId, "lead linked"],
      [impOrder.phone_number === TEST_PHONE, "phone normalized"],
      [impOrder.payment_link === null, "no payment link (team handles it)"],
      [impOrder.items?.[0]?.product_title?.includes("abaya"), "item description stored"],
    ];
    impAssertions.every(([ok]) => ok)
      ? pass("Imported order row persisted correctly")
      : fail("Imported order row persisted correctly", impAssertions.filter(([ok]) => !ok).map(([, l]) => l).join(", "));

    const impEvents = await sb(`/order_events?order_id=eq.${importedOrderId}&select=event,detail`);
    (impEvents.body ?? []).some((e) => e.event === "handed_to_orders")
      ? pass("handed_to_orders audit event recorded")
      : fail("handed_to_orders audit event recorded", JSON.stringify(impEvents.body));

    const leadTrack = await sb(`/leads?id=eq.${leadId}&select=order_track`);
    leadTrack.body?.[0]?.order_track === "imported"
      ? pass("Lead order_track set to imported")
      : fail("Lead order_track set to imported", JSON.stringify(leadTrack.body));

    // ==================================================================
    currentTrack = "webhook-takeover-context";
    // ==================================================================
    if (!SKIP_WEBHOOK && META_APP_SECRET) {
      const capture = await startCaptureServer();
      captureServer = capture.server;
      proxyProc = startProxyServer();

      const proxyUp = await waitForServer(`http://127.0.0.1:${PROXY_PORT}/login`);
      if (!proxyUp) throw new Error("Proxy dev server did not start on :3100");
      pass("Webhook proxy server started with capture endpoint", `:${PROXY_PORT}`);

      // Flag the lead, then send a signed webhook — the forwarded body must
      // carry human_takeover=true so n8n skips Layla's reply.
      const flagOn = await api(BASE_URL, "/api/handover", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ phone: TEST_PHONE, take_over: true, by: "m4-test" }),
      });
      if (flagOn.status !== 200) {
        throw new Error(`Takeover flag set failed: HTTP ${flagOn.status} ${JSON.stringify(flagOn.body)}`);
      }

      const wamid1 = `wamid.m4-on-${Date.now()}`;
      const raw1 = metaWebhookBody(TEST_PHONE, "Hi, checking on my order", wamid1);
      const before = capture.captured.length;
      const wh1 = await fetch(`http://127.0.0.1:${PROXY_PORT}/api/whatsapp-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": metaSignature(raw1) },
        body: raw1,
      });
      wh1.status === 200
        ? pass("Signed webhook accepted by proxy")
        : fail("Signed webhook accepted by proxy", `got ${wh1.status}`);

      const forwardedOn = await waitFor("forwarded payload", async () => {
        const newBodies = capture.captured.slice(before).filter((c) => c.url === "/capture");
        return newBodies.length ? newBodies[newBodies.length - 1].body : null;
      }, 20_000);
      const parsedOn = JSON.parse(forwardedOn);
      parsedOn._layla_context?.human_takeover === true
        ? pass("Forwarded payload flags human_takeover=true", JSON.stringify(parsedOn._layla_context))
        : fail("Forwarded payload flags human_takeover=true", JSON.stringify(parsedOn._layla_context));

      // Release and verify the flag flips to false in the forwarded payload.
      const flagOff = await api(BASE_URL, "/api/handover", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ phone: TEST_PHONE, take_over: false, by: "m4-test" }),
      });
      if (flagOff.status !== 200) {
        throw new Error(`Takeover release failed: HTTP ${flagOff.status} ${JSON.stringify(flagOff.body)}`);
      }
      const wamid2 = `wamid.m4-off-${Date.now()}`;
      const raw2 = metaWebhookBody(TEST_PHONE, "Are you still there?", wamid2);
      const before2 = capture.captured.length;
      const wh2 = await fetch(`http://127.0.0.1:${PROXY_PORT}/api/whatsapp-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": metaSignature(raw2) },
        body: raw2,
      });
      if (wh2.status !== 200) {
        throw new Error(`Second webhook rejected: HTTP ${wh2.status} ${await wh2.text()}`);
      }
      const forwardedOff = await waitFor("released payload", async () => {
        const newBodies = capture.captured.slice(before2).filter((c) => c.url === "/capture");
        return newBodies.length ? newBodies[newBodies.length - 1].body : null;
      }, 20_000);
      const parsedOff = JSON.parse(forwardedOff);
      parsedOff._layla_context?.human_takeover === false
        ? pass("Forwarded payload clears flag after release", JSON.stringify(parsedOff._layla_context))
        : fail("Forwarded payload clears flag after release", JSON.stringify(parsedOff._layla_context));
    } else {
      warn("Webhook takeover-context check", !META_APP_SECRET ? "META_APP_SECRET missing" : "skipped via --skip-webhook");
    }

    // ==================================================================
    currentTrack = "ui";
    // ==================================================================
    if (!SKIP_UI) {
      // Seed a conversation + flag the lead so the UI renders the badge.
      const conv = await seedConversation();
      if (conv.body?.[0]?.id) seededConversations.push(conv.body[0].id);
      await api(BASE_URL, "/api/handover", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ phone: TEST_PHONE, take_over: true, by: "ui-test" }),
      });

      browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 150 : 0 });
      const page = await browser.newPage();
      try {
        await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
        let loggedIn = false;
        for (let attempt = 0; attempt < 3 && !loggedIn; attempt++) {
          await page.waitForSelector("#email", { timeout: 15_000 });
          await page.waitForTimeout(1500);
          await page.fill("#email", TEST_EMAIL);
          await page.fill("#password", TEST_PASSWORD);
          await page.locator("form:has(#email) button[type='submit']").click();
          try {
            await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 15_000 });
            loggedIn = true;
          } catch {
            await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
          }
        }
        if (!loggedIn) throw new Error("Login did not redirect after 3 attempts");

        await page.goto(`${BASE_URL}/conversations`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3000);
        const threadButton = page.locator(".overflow-y-auto button", { hasText: TEST_NAME }).first();
        await threadButton.waitFor({ timeout: 15_000 });
        await threadButton.locator("text=Human").waitFor({ timeout: 10_000 });
        pass("Conversation list shows Human badge on flagged thread");

        await threadButton.click();
        await page.getByText("Human in control", { exact: false }).waitFor({ timeout: 10_000 });
        pass("Chat header shows 'Human in control' banner");

        const releaseBtn = page.getByRole("button", { name: /Release to Layla/ });
        await releaseBtn.click();
        await page.getByRole("button", { name: /Take over/ }).waitFor({ timeout: 10_000 });
        const released = await sb(`/leads?id=eq.${leadId}&select=human_takeover`);
        released.body?.[0]?.human_takeover === false
          ? pass("Release button clears takeover flag")
          : fail("Release button clears takeover flag", JSON.stringify(released.body));

        // Orders page: imported order renders with track + status labels.
        await page.goto(`${BASE_URL}/orders`, { waitUntil: "domcontentloaded" });
        await page.locator("h1", { hasText: "Orders" }).waitFor({ timeout: 15_000 });
        const impRow = page.locator("tr", { hasText: TEST_NAME }).first();
        await impRow.waitFor({ timeout: 15_000 });
        await impRow.getByText("Imported", { exact: true }).waitFor({ timeout: 10_000 });
        await impRow.getByText("With orders team", { exact: true }).waitFor({ timeout: 10_000 });
        pass("Orders page renders imported order with track + status");

        // Reports API exposes per-track aggregates.
        const reportJson = await page.evaluate(async () => {
          const res = await fetch("/api/reports?range=all");
          return res.ok ? res.json() : null;
        });
        const tracks = reportJson?.ordersByTrack ?? [];
        const imported = tracks.find((t) => t.track === "imported");
        const stock = tracks.find((t) => t.track === "stock_on_hand");
        imported && stock && imported.handedToOrders >= 1
          ? pass("Reports API splits orders by track", JSON.stringify(tracks.map((t) => `${t.track}:${t.total}`)))
          : fail("Reports API splits orders by track", JSON.stringify(tracks));
      } catch (err) {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, "ui-failure.png"), fullPage: true });
        fail("UI checks", err instanceof Error ? err.message : String(err));
      }
    } else {
      warn("UI checks", "skipped via --skip-ui");
    }
  } finally {
    currentTrack = "cleanup";
    if (browser) await browser.close();
    if (proxyProc) { proxyProc.kill("SIGTERM"); }
    if (captureServer) { captureServer.close(); }

    // Clear the flag so nothing lingers, then remove test rows.
    await api(BASE_URL, "/api/handover", {
      method: "POST",
      auth: true,
      body: JSON.stringify({ phone: TEST_PHONE, take_over: false, by: "cleanup" }),
    }).catch(() => {});
    if (importedOrderId) {
      const deleted = await sb(`/orders?id=eq.${importedOrderId}`, { method: "DELETE" });
      deleted.ok ? pass("Imported test order deleted") : fail("Imported test order deleted", `HTTP ${deleted.status}`);
    }
    for (const convId of seededConversations) {
      await sb(`/conversations?id=eq.${convId}`, { method: "DELETE" }).catch(() => {});
    }
    const convCleanup = await sb(`/conversations?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
    convCleanup.ok
      ? pass("Test conversations cleaned")
      : warn("Test conversations cleaned", `HTTP ${convCleanup.status}`);
    const whCleanup = await sb(`/inbound_webhook_messages?wamid=like.wamid.m4-*`, { method: "DELETE" });
    whCleanup.ok ? pass("Webhook idempotency markers cleaned") : warn("Webhook markers cleanup", `HTTP ${whCleanup.status}`);
    const leadCleanup = await sb(`/leads?id=eq.${leadId}`, { method: "DELETE" });
    leadCleanup.ok
      ? pass("Test lead deleted")
      : fail("Test lead deleted", `HTTP ${leadCleanup.status}`);
  }
}

main()
  .then(() => {
    const failed = results.filter((r) => r.status === "FAIL");
    fs.writeFileSync(RESULTS_FILE, JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
    console.log(`\n${results.length - failed.length} passed, ${failed.length} failed — ${RESULTS_FILE}`);
    process.exit(failed.length ? 1 : 0);
  })
  .catch((err) => {
    record("FAIL", "Suite completed", err instanceof Error ? err.message : String(err));
    fs.writeFileSync(RESULTS_FILE, JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
    console.error(err);
    process.exit(1);
  });
