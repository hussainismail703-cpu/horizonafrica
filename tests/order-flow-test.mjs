#!/usr/bin/env node
/**
 * Eastern Wear M3 — Stock-on-Hand Order Flow test.
 *
 * Verifies the real path required by the implementation plan:
 *   API auth/validation → live Shopify stock check → GraphQL draft order +
 *   inventory reservation + invoice URL → Supabase order/events → signed
 *   orders/paid webhook → paid state → dashboard order view → cleanup.
 *
 * Usage:
 *   node --env-file=.env.local tests/order-flow-test.mjs
 *   node --env-file=.env.local tests/order-flow-test.mjs --headed
 *   node --env-file=.env.local tests/order-flow-test.mjs --skip-ui
 *
 * Safety: creates a real Shopify draft order, then deletes it in cleanup. No
 * customer payment, WhatsApp message, or real Shopify order is created.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
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
const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET;
const TEST_EMAIL = process.env.TEST_EMAIL || "test@horizonafrica.co.za";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "TestPass123!";
const HEADED = process.argv.includes("--headed");
const SKIP_UI = process.argv.includes("--skip-ui");

const TEST_PHONE_LOCAL = "0799900301";
const TEST_PHONE = "27799900301";
const TEST_NAME = "Order Flow Test";
const RESULTS_FILE = path.join(process.cwd(), "tests", "order-flow-results.json");
const SCREENSHOT_DIR = path.join(process.cwd(), "tests", "screenshots", "order-flow");

const missing = [
  ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
  ["APP_SECRET", APP_SECRET],
  ["SHOPIFY_STORE_DOMAIN", STORE_DOMAIN],
  ["SHOPIFY_CLIENT_ID", process.env.SHOPIFY_CLIENT_ID],
  ["SHOPIFY_CLIENT_SECRET", process.env.SHOPIFY_CLIENT_SECRET],
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

async function api(pathname, options = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
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

async function shopifyToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const res = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Shopify token request failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

async function deleteShopifyDraft(draftOrderId) {
  if (!draftOrderId) return;
  const token = await shopifyToken();
  const res = await fetch(
    `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/draft_orders/${draftOrderId}.json`,
    { method: "DELETE", headers: { "X-Shopify-Access-Token": token } }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Shopify draft cleanup failed: HTTP ${res.status}`);
  }
}

function shopifySignature(rawBody) {
  return crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody, "utf8").digest("base64");
}

async function findTestVariant() {
  const res = await sb(
    "/shopify_variants?select=shopify_variant_id,inventory_item_id,title,sku,price_cents,inventory_qty,available,shopify_products!inner(title,is_active)&available=eq.true&inventory_item_id=not.is.null&shopify_products.is_active=eq.true&limit=100"
  );
  if (!res.ok) throw new Error(`variant query failed: ${JSON.stringify(res.body)}`);
  for (const row of res.body ?? []) {
    const stock = await api(`/api/shopify/stock?variant_id=${row.shopify_variant_id}`, { auth: true });
    const live = stock.body?.results?.[0];
    if (stock.ok && live?.available && live.inventory_qty >= 1 && live.inventory_qty < 50) {
      return { ...row, live_inventory_qty: live.inventory_qty };
    }
  }
  throw new Error("No active in-stock Shopify variant found for testing");
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  if (missing.length) {
    fail("Required environment configured", missing.join(", "));
    throw new Error("Missing required environment");
  }
  pass("Required environment configured", "Supabase, APP_SECRET and Shopify client credentials present");

  const health = await api("/api/orders/create", {
    method: "POST",
    auth: true,
    body: JSON.stringify({}),
  });
  if (health.status === 400) pass("Local order API reachable", "authenticated validation returned HTTP 400");
  else throw new Error(`Order API unexpected health response: ${health.status}`);

  const leadExisting = await sb(`/leads?phone_number=eq.${TEST_PHONE}&select=id,full_name&limit=1`);
  let leadId = leadExisting.body?.[0]?.id ?? null;
  let createdLead = false;
  if (!leadId) {
    const inserted = await sb("/leads", {
      method: "POST",
      body: JSON.stringify({ phone_number: TEST_PHONE, full_name: TEST_NAME }),
    });
    if (!inserted.ok || !inserted.body?.[0]?.id) {
      throw new Error(`Could not create test lead: ${JSON.stringify(inserted.body)}`);
    }
    leadId = inserted.body[0].id;
    createdLead = true;
  }
  pass("Test lead prepared", `lead_id=${leadId}${createdLead ? " (created)" : ""}`);

  const variant = await findTestVariant();
  pass(
    "Live in-stock Shopify variant selected",
    `${variant.shopify_products?.title ?? "Product"} / ${variant.title ?? "default"}, live qty ${variant.live_inventory_qty}`
  );

  let orderId = null;
  let draftOrderId = null;
  const webhookIds = [];
  let browser = null;

  try {
    currentTrack = "api-validation";

    const unauth = await api("/api/orders/create", {
      method: "POST",
      body: JSON.stringify({ phone: TEST_PHONE_LOCAL, items: [{ variant_id: variant.shopify_variant_id, qty: 1 }], delivery_method: "collection" }),
    });
    unauth.status === 401
      ? pass("Unauthenticated order creation rejected")
      : fail("Unauthenticated order creation rejected", `expected 401, got ${unauth.status}`);

    const invalid = await api("/api/orders/create", {
      method: "POST",
      auth: true,
      body: JSON.stringify({ phone: TEST_PHONE_LOCAL, items: [{ variant_id: "abc", qty: 0 }], delivery_method: "collection" }),
    });
    invalid.status === 400
      ? pass("Malformed item rejected")
      : fail("Malformed item rejected", `expected 400, got ${invalid.status}`);

    const badPhone = await api("/api/orders/create", {
      method: "POST",
      auth: true,
      body: JSON.stringify({ phone: "07999000301", items: [{ variant_id: variant.shopify_variant_id, qty: 1 }], delivery_method: "collection" }),
    });
    badPhone.status === 400 && badPhone.body?.error === "invalid_phone"
      ? pass("Malformed phone number rejected")
      : fail("Malformed phone number rejected", `got ${badPhone.status}: ${JSON.stringify(badPhone.body)}`);

    const missingAddress = await api("/api/orders/create", {
      method: "POST",
      auth: true,
      body: JSON.stringify({ phone: TEST_PHONE_LOCAL, items: [{ variant_id: variant.shopify_variant_id, qty: 1 }], delivery_method: "delivery" }),
    });
    missingAddress.status === 400 && missingAddress.body?.error === "invalid_delivery_address"
      ? pass("Delivery order requires a street address")
      : fail("Delivery order requires a street address", `got ${missingAddress.status}: ${JSON.stringify(missingAddress.body)}`);

    const outOfStock = await api("/api/orders/create", {
      method: "POST",
      auth: true,
      body: JSON.stringify({
        phone: TEST_PHONE_LOCAL,
        items: [{ variant_id: variant.shopify_variant_id, qty: variant.live_inventory_qty + 1 }],
        delivery_method: "collection",
      }),
    });
    outOfStock.status === 409 && outOfStock.body?.error === "out_of_stock"
      ? pass("Live out-of-stock revalidation rejected", `requested ${variant.live_inventory_qty + 1}, live ${variant.live_inventory_qty}`)
      : fail("Live out-of-stock revalidation rejected", `expected 409/out_of_stock, got ${outOfStock.status}: ${JSON.stringify(outOfStock.body)}`);

    const created = await api("/api/orders/create", {
      method: "POST",
      auth: true,
      body: JSON.stringify({
        phone: TEST_PHONE_LOCAL,
        items: [{ variant_id: variant.shopify_variant_id, qty: 1 }],
        delivery_method: "delivery",
        delivery_fee_cents: 5000,
        delivery_address: {
          address1: "1 Order Flow Avenue",
          suburb: "Test suburb",
          city: "Johannesburg",
          province: "Gauteng",
          postal_code: "2000",
          country: "South Africa",
        },
        customer: { name: TEST_NAME, email: "order-flow-test@example.com" },
      }),
    });
    if (created.status !== 201 || !created.body?.order_id || !created.body?.payment_link) {
      throw new Error(`Order creation failed: ${created.status} ${JSON.stringify(created.body)}`);
    }
    orderId = created.body.order_id;
    pass(
      "Delivery draft order created with payment link",
      `order #${created.body.order_number}, total ${created.body.total_cents} cents`
    );

    const orderRow = await waitFor("order persistence", async () => {
      const res = await sb(`/orders?id=eq.${orderId}&select=*&limit=1`);
      return res.body?.[0];
    });
    draftOrderId = orderRow.shopify_draft_order_id;

    const orderAssertions = [
      [orderRow.phone_number === TEST_PHONE, "phone normalized"],
      [orderRow.lead_id === leadId, "lead linked"],
      [orderRow.status === "pending_payment", "pending payment status"],
      [orderRow.order_track === "stock_on_hand", "stock-on-hand track"],
      [orderRow.delivery_method === "delivery", "delivery method"],
      [orderRow.delivery_fee_cents === 5000, "delivery fee"],
      [orderRow.total_cents === (variant.price_cents ?? 0) + 5000, "total includes delivery fee"],
      [typeof orderRow.payment_link === "string" && orderRow.payment_link.includes("/invoices/"), "secure invoice URL"],
      [Array.isArray(orderRow.items) && orderRow.items.length === 1, "item snapshot"],
    ];
    if (orderAssertions.every(([ok]) => ok)) pass("Order row persisted correctly");
    else fail("Order row persisted correctly", orderAssertions.filter(([ok]) => !ok).map(([, label]) => label).join(", "));

    const events = await sb(`/order_events?order_id=eq.${orderId}&select=event&order=created_at.asc`);
    const eventNames = new Set((events.body ?? []).map((row) => row.event));
    eventNames.has("stock_revalidated") && eventNames.has("created")
      ? pass("Order creation audit events recorded")
      : fail("Order creation audit events recorded", `events: ${[...eventNames].join(", ")}`);

    currentTrack = "paid-webhook";

    const badWebhook = await fetch(`${BASE_URL}/api/shopify/webhooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Topic": "orders/paid",
        "X-Shopify-Hmac-Sha256": "invalid",
      },
      body: JSON.stringify({ id: 1 }),
    });
    badWebhook.status === 401
      ? pass("Invalid Shopify webhook signature rejected")
      : fail("Invalid Shopify webhook signature rejected", `expected 401, got ${badWebhook.status}`);

    const paidPayload = {
      id: Number(`90${Date.now().toString().slice(-11)}`),
      draft_order_id: draftOrderId,
      name: `#ORDER-FLOW-${Date.now().toString().slice(-6)}`,
      processed_at: new Date().toISOString(),
      note_attributes: [{ name: "layla_order_id", value: orderId }],
    };
    const rawPaid = JSON.stringify(paidPayload);
    const webhookId = `order-flow-${Date.now()}`;
    webhookIds.push(webhookId);
    const paidWebhook = await fetch(`${BASE_URL}/api/shopify/webhooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Topic": "orders/paid",
        "X-Shopify-Webhook-Id": webhookId,
        "X-Shopify-Hmac-Sha256": shopifySignature(rawPaid),
      },
      body: rawPaid,
    });
    paidWebhook.status === 200
      ? pass("Signed orders/paid webhook accepted")
      : fail("Signed orders/paid webhook accepted", `expected 200, got ${paidWebhook.status}`);

    const paidOrder = await waitFor("order paid update", async () => {
      const res = await sb(`/orders?id=eq.${orderId}&select=*&limit=1`);
      return res.body?.[0]?.status === "paid" ? res.body[0] : null;
    }, 20_000);
    paidOrder.shopify_order_id === paidPayload.id && paidOrder.shopify_order_number === paidPayload.name && paidOrder.paid_at
      ? pass("Paid webhook matched and updated the order")
      : fail("Paid webhook matched and updated the order", JSON.stringify(paidOrder));

    const paidEvents = await waitFor("paid audit events", async () => {
      const res = await sb(`/order_events?order_id=eq.${orderId}&select=event&order=created_at.asc`);
      const names = (res.body ?? []).map((row) => row.event);
      return names.includes("paid") && names.includes("paid_notification_skipped") ? names : null;
    }, 20_000);
    pass("Paid audit/notification events recorded", paidEvents.join(", "));

    const webhookEvent = await waitFor("Shopify webhook event processed", async () => {
      const res = await sb(`/shopify_webhook_events?shopify_id=eq.${webhookId}&select=processed,error&limit=1`);
      return res.body?.[0]?.processed ? res.body[0] : null;
    }, 20_000);
    pass("Shopify webhook event marked processed", `error=${webhookEvent.error ?? "none"}`);

    // A genuine Shopify retry reuses the SAME X-Shopify-Webhook-Id — it must be
    // acked as a duplicate without inserting a second event row or reprocessing.
    const sameIdReplay = await fetch(`${BASE_URL}/api/shopify/webhooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Topic": "orders/paid",
        "X-Shopify-Webhook-Id": webhookId,
        "X-Shopify-Hmac-Sha256": shopifySignature(rawPaid),
      },
      body: rawPaid,
    });
    const sameIdBody = await sameIdReplay.json().catch(() => ({}));
    const eventRows = await sb(`/shopify_webhook_events?shopify_id=eq.${webhookId}&select=id`);
    sameIdReplay.status === 200 && sameIdBody?.duplicate === true && eventRows.body?.length === 1
      ? pass("Same delivery-id retry deduplicated")
      : fail("Same delivery-id retry deduplicated", `status=${sameIdReplay.status} body=${JSON.stringify(sameIdBody)} rows=${eventRows.body?.length}`);

    const replayId = `order-flow-replay-${Date.now()}`;
    webhookIds.push(replayId);
    const replay = await fetch(`${BASE_URL}/api/shopify/webhooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Topic": "orders/paid",
        "X-Shopify-Webhook-Id": replayId,
        "X-Shopify-Hmac-Sha256": shopifySignature(rawPaid),
      },
      body: rawPaid,
    });
    replay.status === 200
      ? pass("Paid webhook replay accepted")
      : fail("Paid webhook replay accepted", `expected 200, got ${replay.status}`);
    await waitFor("replayed webhook processed", async () => {
      const res = await sb(`/shopify_webhook_events?shopify_id=eq.${replayId}&select=processed&limit=1`);
      return res.body?.[0]?.processed ? true : null;
    }, 20_000);
    const paidEventCount = await sb(`/order_events?order_id=eq.${orderId}&event=eq.paid&select=id`);
    paidEventCount.body?.length === 1
      ? pass("Webhook replay did not duplicate paid event")
      : fail("Webhook replay did not duplicate paid event", `count=${paidEventCount.body?.length}`);

    currentTrack = "orders-ui";
    if (!SKIP_UI) {
      browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 150 : 0 });
      const page = await browser.newPage();
      try {
        await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
        // Retry loop absorbs React hydration/cold-compile races — a submit
        // clicked before hydration completes does nothing.
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

        await page.goto(`${BASE_URL}/orders`, { waitUntil: "domcontentloaded" });
        await page.locator("h1", { hasText: "Orders" }).waitFor({ timeout: 15_000 });
        await page.getByText(`#${paidOrder.order_number}`).first().waitFor({ timeout: 15_000 });
        await page.getByText(TEST_NAME).first().waitFor({ timeout: 15_000 });
        pass("Orders list renders the paid order");

        await page.locator(`a[href="/orders/${orderId}"]`).click();
        await page.getByRole("heading", { name: `Order #${paidOrder.order_number}` }).waitFor({ timeout: 15_000 });
        await page.getByText("Paid", { exact: true }).first().waitFor({ timeout: 10_000 });
        await page.getByText("stock on hand", { exact: false }).first().waitFor({ timeout: 10_000 });
        await page.getByText("paid", { exact: true }).first().waitFor({ timeout: 10_000 });
        pass("Order detail page renders items, customer, fulfilment and timeline");
      } catch (err) {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, "orders-ui-failure.png"), fullPage: true });
        throw err;
      }
    } else {
      warn("Orders dashboard UI", "skipped by --skip-ui");
    }
  } finally {
    currentTrack = "cleanup";
    try {
      if (draftOrderId) await deleteShopifyDraft(draftOrderId);
      pass("Shopify draft order deleted", draftOrderId ? `draft=${draftOrderId}` : "none created");
    } catch (err) {
      fail("Shopify draft order deleted", err.message);
    }

    if (orderId) {
      const deleted = await sb(`/orders?id=eq.${orderId}`, { method: "DELETE" });
      deleted.ok
        ? pass("Test order and events deleted")
        : fail("Test order and events deleted", `HTTP ${deleted.status}: ${JSON.stringify(deleted.body)}`);
    }
    if (webhookIds.length) {
      const deleted = await sb(`/shopify_webhook_events?shopify_id=like.order-flow*`, { method: "DELETE" });
      deleted.ok
        ? pass("Test Shopify webhook events deleted")
        : fail("Test Shopify webhook events deleted", `HTTP ${deleted.status}`);
    }
    if (createdLead) {
      const deleted = await sb(`/leads?id=eq.${leadId}`, { method: "DELETE" });
      deleted.ok
        ? pass("Temporary test lead deleted")
        : fail("Temporary test lead deleted", `HTTP ${deleted.status}`);
    }
    if (browser) await browser.close();
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
    const failed = results.filter((r) => r.status === "FAIL");
    console.error(`\n${failed.length} failure(s) — ${RESULTS_FILE}`);
    console.error(err);
    process.exit(1);
  });
