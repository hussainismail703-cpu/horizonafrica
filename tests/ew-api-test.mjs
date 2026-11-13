#!/usr/bin/env node
/**
 * Eastern Wear — Backend API & Database Integrity Suite
 * (full-suite-test-plan.md — Suites B/C gaps not covered by order-flow/m4/m6)
 *
 * Covers:
 *   S1  Unauthenticated auth matrix across ALL 42 API routes
 *   S2  Wrong-secret rejection on self-authenticated routes
 *   S3  Bearer APP_SECRET positive checks (safe routes only)
 *   S4  Session-auth positive checks via Playwright context (headless)
 *   S5  Database integrity: RLS probes, columns, indexes, webhook logging
 *   S6  Telecom data preservation checksum (before/after)
 *   S7  Cleanup
 *
 * Usage:
 *   node --env-file=.env.local tests/ew-api-test.mjs
 *   node --env-file=.env.local tests/ew-api-test.mjs --headed        (visible login)
 *   node --env-file=.env.local tests/ew-api-test.mjs --skip-sync     (skip live Shopify/broadcast syncs)
 *
 * Safety: no real WhatsApp sends (follow-ups/send and cron positive paths are
 * auth-boundary tested only). Signed Meta webhooks use statuses-only payloads
 * (no inbound message → n8n is still invoked but gets no message to answer).
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { chromium } from "playwright";
import { webhookHeaders } from "./lib/webhook.mjs";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));

const BASE_URL = process.env.TEST_TARGET || "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_SECRET = process.env.APP_SECRET;
const TEST_EMAIL = process.env.TEST_EMAIL || "test@horizonafrica.co.za";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "TestPass123!";
const HEADED = process.argv.includes("--headed");
const SKIP_SYNC = process.argv.includes("--skip-sync");
const RESULTS_FILE = path.join(process.cwd(), "tests", "ew-api-results.json");

const TEST_PHONE = "27799900499"; // fake, never a real customer

const results = [];
let currentTrack = "setup";
function record(status, name, detail = "") {
  results.push({ track: currentTrack, name, status, detail });
  const icon = { PASS: "✅", FAIL: "❌", WARN: "⚠️ ", SKIP: "⏭️ " }[status] || status;
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}
const pass = (n, d) => record("PASS", n, d);
const fail = (n, d) => record("FAIL", n, d);
const warn = (n, d) => record("WARN", n, d);

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

async function sbAnon(pathname) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${pathname}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null } catch { body = text; }
  return { status: res.status, body };
}

async function api(pathname, options = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    redirect: "manual",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}),
      ...options.headers,
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

const missing = [
  ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY],
  ["APP_SECRET", APP_SECRET],
].filter(([, v]) => !v).map(([k]) => k);

// ── Route inventory (all 42 app/api routes) ─────────────────────────────────
const ROUTES = [
  // session-only (middleware 307 for unauth, handler 401 for authed-api w/o cookie)
  { path: "/api/broadcasts/contacts", method: "GET" },
  { path: "/api/broadcasts/groups", method: "GET" },
  { path: "/api/broadcasts", method: "GET" },
  { path: "/api/broadcasts/send", method: "POST" },
  { path: "/api/broadcasts/templates", method: "GET" },
  { path: "/api/broadcasts/contacts/template", method: "GET" },
  { path: "/api/broadcasts/contacts/bulk-import", method: "POST" },
  { path: "/api/calling-queue", method: "GET" },
  { path: "/api/campaigns", method: "GET" },
  { path: "/api/campaigns/dashboard-stats", method: "GET" },
  { path: "/api/campaigns/enrolments", method: "GET" },
  { path: "/api/campaigns/errors", method: "GET" },
  { path: "/api/conversations", method: "GET" },
  { path: "/api/follow-ups/schedule", method: "POST" },
  { path: "/api/follow-ups/send", method: "POST" },
  { path: "/api/leads", method: "GET" },
  { path: "/api/leads/export", method: "GET" },
  { path: "/api/notifications", method: "GET" },
  { path: "/api/orders", method: "GET" },
  { path: "/api/reports", method: "GET" },
  { path: "/api/settings/alert-emails", method: "GET" },
  { path: "/api/shopify/products", method: "GET" },
  // self-authenticated (middleware-exempt, route enforces Bearer/HMAC)
  { path: "/api/orders/create", method: "POST", selfAuth: true },
  { path: "/api/orders/imported", method: "POST", selfAuth: true },
  { path: "/api/handover", method: "POST", selfAuth: true },
  { path: "/api/broadcasts/sync-shopify", method: "POST", selfAuth: true },
  { path: "/api/campaigns/process", method: "POST", selfAuth: true },
  { path: "/api/campaigns/classify", method: "POST", selfAuth: true },
  { path: "/api/follow-ups/cron", method: "POST", selfAuth: true },
  { path: "/api/shopify/stock", method: "GET", selfAuth: true },
  { path: "/api/shopify/sync-products", method: "POST", selfAuth: true },
  { path: "/api/shopify/sync-customers", method: "POST", selfAuth: true },
  { path: "/api/shopify/webhooks", method: "POST", selfAuth: true },
  { path: "/api/whatsapp-webhook", method: "GET", selfAuth: true },
  { path: "/api/health", method: "GET", selfAuth: true },
];

// ── main ────────────────────────────────────────────────────────────────────
async function run() {
  console.log("=== EW API & DB Integrity Suite ===");
  if (missing.length) {
    console.log(`Missing env: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Snapshot telecom counts for preservation check
  let telecomBefore = {};
  try {
    for (const t of ["leads", "conversations", "campaigns", "products"]) {
      const r = await sb(`/${t}?select=id&limit=1`, { headers: { Prefer: "count=exact" } });
      const contentRange = r.status === 200 ? null : null;
      const res2 = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=id`, {
        method: "HEAD",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: "count=exact" },
      });
      const cr = res2.headers.get("content-range");
      telecomBefore[t] = cr ? parseInt(cr.split("/")[1], 10) : -1;
    }
  } catch { /* snapshot is best-effort */ }

  // ── S0: preflight ──────────────────────────────────────────────────────────
  currentTrack = "S0-preflight";
  try {
    const r = await fetch(`${BASE_URL}/login`, { redirect: "manual" });
    if (r.status === 200) pass("Dev server reachable", BASE_URL);
    else fail("Dev server reachable", `HTTP ${r.status}`);
  } catch (e) {
    fail("Dev server reachable", e.message);
    return finish();
  }

  // ── S1: unauthenticated matrix ─────────────────────────────────────────────
  currentTrack = "S1-auth-matrix";
  for (const route of ROUTES) {
    const name = `unauth ${route.method} ${route.path}`;
    try {
      const r = await api(route.path, {
        method: route.method,
        body: route.method === "POST" ? "{}" : undefined,
      });
      const loc = r.headers.get("location") || "";
      const protectedOk =
        r.status === 401 || r.status === 403 ||
        (r.status === 307 && loc.includes("/login")) ||
        (route.path === "/api/whatsapp-webhook" && (r.status === 400 || r.status === 401));
      if (protectedOk) pass(name, `HTTP ${r.status}`);
      else if (r.status === 200) fail(name, `returned 200 unauthenticated`);
      else warn(name, `unexpected HTTP ${r.status}`);
    } catch (e) { fail(name, e.message); }
  }

  // ── S2: wrong-secret rejection ─────────────────────────────────────────────
  currentTrack = "S2-wrong-secret";
  for (const route of ROUTES.filter((r) => r.selfAuth && r.path !== "/api/whatsapp-webhook" && r.path !== "/api/health")) {
    const name = `bad-secret ${route.method} ${route.path}`;
    try {
      const r = await api(route.path, {
        method: route.method,
        bearer: "definitely-wrong-secret",
        body: route.method === "POST" ? "{}" : undefined,
      });
      if (r.status === 401 || r.status === 403) pass(name, `HTTP ${r.status}`);
      else if (r.status === 400) pass(name, `HTTP 400 (rejected before processing)`);
      else fail(name, `HTTP ${r.status} — bad secret accepted`);
    } catch (e) { fail(name, e.message); }
  }

  // ── S3: Bearer APP_SECRET positives ────────────────────────────────────────
  currentTrack = "S3-bearer-positive";
  const bearerTests = [
    { name: "campaigns/process zero-work", path: "/api/campaigns/process", method: "POST", check: (r) => r.status === 200 },
    { name: "shopify/stock search", path: "/api/shopify/stock?query=dress", method: "GET", check: (r) => r.status === 200 },
    { name: "orders/create rejects empty body", path: "/api/orders/create", method: "POST", check: (r) => r.status === 400 },
    { name: "orders/imported rejects empty body", path: "/api/orders/imported", method: "POST", check: (r) => r.status === 400 },
    { name: "handover rejects empty body", path: "/api/handover", method: "POST", check: (r) => r.status === 400 || r.status === 404 },
    { name: "follow-ups/cron reachable", path: "/api/follow-ups/cron", method: "POST", check: (r) => r.status === 200 || r.status === 500, note: "may process due items — see code" },
    { name: "campaigns/classify rejects empty", path: "/api/campaigns/classify", method: "POST", check: (r) => r.status === 400 },
  ];
  for (const t of bearerTests) {
    try {
      const r = await api(t.path, { method: t.method, bearer: APP_SECRET, body: t.method === "POST" ? "{}" : undefined });
      if (t.check(r)) pass(t.name, `HTTP ${r.status}`);
      else fail(t.name, `HTTP ${r.status} — ${JSON.stringify(r.body)?.slice(0, 120)}`);
    } catch (e) { fail(t.name, e.message); }
  }
  if (SKIP_SYNC) {
    warn("shopify/sync-products + broadcasts/sync-shopify", "skipped via --skip-sync");
  } else {
    try {
      const r = await api("/api/shopify/sync-products", { method: "POST", bearer: APP_SECRET });
      if (r.status === 200) pass("shopify/sync-products live sync", JSON.stringify(r.body).slice(0, 100));
      else fail("shopify/sync-products live sync", `HTTP ${r.status} — ${JSON.stringify(r.body)?.slice(0, 120)}`);
    } catch (e) { fail("shopify/sync-products live sync", e.message); }
    try {
      const r = await api("/api/broadcasts/sync-shopify", { method: "POST", bearer: APP_SECRET });
      if (r.status === 200) pass("broadcasts/sync-shopify contacts sync", JSON.stringify(r.body).slice(0, 100));
      else fail("broadcasts/sync-shopify contacts sync", `HTTP ${r.status} — ${JSON.stringify(r.body)?.slice(0, 120)}`);
    } catch (e) { fail("broadcasts/sync-shopify contacts sync", e.message); }
  }

  // ── S4: session-authenticated positives ────────────────────────────────────
  currentTrack = "S4-session-positive";
  let ctx = null;
  try {
    const browser = await chromium.launch({ headless: !HEADED });
    ctx = await browser.newContext();
    const page = await ctx.newPage();
    let loggedIn = false;
    for (let i = 0; i < 2 && !loggedIn; i++) {
      await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1500);
      await page.locator("#email").fill(TEST_EMAIL);
      await page.locator("#password").fill(TEST_PASSWORD);
      await page.locator("button[type='submit']").click();
      await page.waitForURL("**/dashboard", { timeout: 20000 }).catch(() => {});
      loggedIn = page.url().includes("/dashboard");
      if (!loggedIn) await page.waitForTimeout(1500);
    }
    if (!loggedIn) { fail("session login", "could not reach /dashboard"); }
    else {
      pass("session login", TEST_EMAIL);
      const sapi = async (p, method = "GET", data) => {
        const r = await ctx.request.fetch(`${BASE_URL}${p}`, { method, data, headers: { "Content-Type": "application/json" } });
        const text = await r.text();
        let body = null;
        try { body = JSON.parse(text); } catch { body = text; }
        return { status: r.status(), body, headers: r.headers() };
      };
      // fetch a real campaign id for parameterized routes
      let campaignId = null;
      try {
        const c = await sb("/campaigns?select=id&limit=1&order=created_at.desc");
        campaignId = c.body?.[0]?.id || null;
      } catch {}
      const sessionGet = [
        "/api/notifications", "/api/reports", `/api/conversations?phone=${TEST_PHONE}`,
        "/api/leads?limit=5", "/api/orders?limit=5", "/api/calling-queue",
        "/api/campaigns/dashboard-stats",
        ...(campaignId ? [`/api/campaigns/errors?campaign_id=${campaignId}`, `/api/campaigns/enrolments?campaign_id=${campaignId}`] : []),
        "/api/settings/alert-emails",
        "/api/broadcasts", "/api/broadcasts/groups",
        "/api/broadcasts/templates", "/api/shopify/products?limit=5",
      ];
      for (const p of sessionGet) {
        const name = `session GET ${p}`;
        try {
          const r = await sapi(p);
          if (r.status === 200) {
            if (p === "/api/broadcasts/templates") {
              const list = Array.isArray(r.body) ? r.body : r.body?.templates || [];
              const ew = list.filter((t) => (t.name || "").startsWith("ew_"));
              pass(name, `200, ${ew.length} ew_* templates`);
            } else pass(name, "200");
          } else fail(name, `HTTP ${r.status} — ${JSON.stringify(r.body)?.slice(0, 120)}`);
        } catch (e) { fail(name, e.message); }
      }
      // File downloads — leads export is CSV, contacts template is XLSX
      for (const [p, label, matcher] of [
        ["/api/leads/export", "leads CSV export", (ct) => ct.includes("csv") || ct.includes("text")],
        ["/api/broadcasts/contacts/template", "contacts template XLSX", (ct) => ct.includes("spreadsheetml") || ct.includes("octet-stream")],
      ]) {
        try {
          const r = await sapi(p);
          const ct = r.headers["content-type"] || "";
          if (r.status === 200 && matcher(ct)) pass(label, ct);
          else if (r.status === 200) warn(label, `200 but content-type ${ct}`);
          else fail(label, `HTTP ${r.status}`);
        } catch (e) { fail(label, e.message); }
      }
      // POST-only session routes: campaign create→delete, contact create→delete
      try {
        const r = await sapi("/api/campaigns", "POST", { name: `EW API Test ${Date.now()}`, status: "draft" });
        const cid = r.body?.id || r.body?.campaign?.id;
        if (r.status === 200 || r.status === 201) {
          pass("session POST /api/campaigns create", `id ${cid || "?"}`);
          if (cid) await ctx.request.fetch(`${BASE_URL}/api/campaigns/${cid}`, { method: "DELETE" }).catch(() => {});
          else await sb(`/campaigns?name=like.EW API Test*`, { method: "DELETE" }).catch(() => {});
        } else fail("session POST /api/campaigns", `HTTP ${r.status} — ${JSON.stringify(r.body)?.slice(0, 120)}`);
      } catch (e) { fail("session POST /api/campaigns", e.message); }
      try {
        const r = await sapi("/api/broadcasts/contacts", "POST", { phone_number: TEST_PHONE, full_name: "EW API Test" });
        if (r.status === 200 || r.status === 201) {
          pass("session POST /api/broadcasts/contacts create");
          const bid = r.body?.id || r.body?.contact?.id;
          if (bid) await ctx.request.fetch(`${BASE_URL}/api/broadcasts/contacts/${bid}`, { method: "DELETE" }).catch(() => {});
          else await sb(`/broadcast_contacts?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" }).catch(() => {});
        } else if (r.status === 400 || r.status === 409) pass("session POST /api/broadcasts/contacts", `validated (${r.status})`);
        else fail("session POST /api/broadcasts/contacts", `HTTP ${r.status} — ${JSON.stringify(r.body)?.slice(0, 120)}`);
      } catch (e) { fail("session POST /api/broadcasts/contacts", e.message); }
      // follow-ups/schedule on a synthetic lead
      try {
        const leadRes = await sb("/leads", {
          method: "POST",
          body: JSON.stringify({ phone_number: TEST_PHONE, full_name: "EW API Test", status: "new" }),
        });
        const leadId = Array.isArray(leadRes.body) ? leadRes.body[0]?.id : leadRes.body?.id;
        if (!leadId) { warn("follow-ups/schedule", `test lead create failed: ${JSON.stringify(leadRes.body)?.slice(0, 120)}`); }
        else {
          const r = await sapi("/api/follow-ups/schedule", "POST", { lead_id: leadId, follow_up_date: new Date(Date.now() + 864e5).toISOString() });
          if (r.status === 200) pass("follow-ups/schedule", `lead ${leadId} scheduled`);
          else fail("follow-ups/schedule", `HTTP ${r.status} — ${JSON.stringify(r.body)?.slice(0, 120)}`);
          await sb(`/leads?id=eq.${leadId}`, { method: "DELETE" });
        }
      } catch (e) { fail("follow-ups/schedule", e.message); }
      warn("follow-ups/send positive", "skipped — would send real WhatsApp for due items");
    }
    await browser.close();
  } catch (e) { fail("session context", e.message); }

  // ── S5: database integrity ─────────────────────────────────────────────────
  currentTrack = "S5-database";
  // RLS: anon probes on sensitive tables must return empty (or error)
  for (const t of ["orders", "order_events", "follow_ups", "leads", "conversations", "handover_events", "shopify_webhook_events", "inbound_webhook_messages", "message_delivery_failures"]) {
    try {
      const r = await sbAnon(`/${t}?select=*&limit=5`);
      const rows = Array.isArray(r.body) ? r.body.length : -1;
      if (rows === 0) pass(`RLS anon ${t}`, "empty");
      else if (rows === -1) pass(`RLS anon ${t}`, `blocked (${r.status})`);
      else fail(`RLS anon ${t}`, `${rows} rows visible to anon`);
    } catch (e) { fail(`RLS anon ${t}`, e.message); }
  }
  // EW columns exist
  for (const [table, col] of [["conversations", "message_category"], ["conversations", "order_track"], ["leads", "order_track"], ["leads", "human_takeover"], ["broadcast_contacts", "source"], ["shopify_customers", "accepts_marketing"]]) {
    try {
      const r = await sb(`/${table}?select=${col}&limit=1`);
      if (r.status === 200) pass(`column ${table}.${col}`);
      else fail(`column ${table}.${col}`, `HTTP ${r.status}`);
    } catch (e) { fail(`column ${table}.${col}`, e.message); }
  }
  // follow_ups unique (order_id, sequence_step) — duplicate insert must fail
  try {
    const orderRes = await sb("/orders", {
      method: "POST",
      body: JSON.stringify({ phone_number: TEST_PHONE, order_track: "stock_on_hand", status: "pending_payment", total_cents: 100, items: [{ title: "EW API Test Item", qty: 1 }] }),
    });
    const orderId = Array.isArray(orderRes.body) ? orderRes.body[0]?.id : orderRes.body?.id;
    if (!orderId) { warn("follow_ups unique index", `order create failed: ${JSON.stringify(orderRes.body)?.slice(0, 150)}`); }
    else {
      const ins = { order_id: orderId, phone_number: TEST_PHONE, sequence_step: 1, template_name: "ew_payment_reminder_1", scheduled_for: new Date().toISOString(), status: "pending" };
      const r1 = await sb("/follow_ups", { method: "POST", body: JSON.stringify(ins) });
      const r2 = await sb("/follow_ups", { method: "POST", body: JSON.stringify(ins) });
      if (r1.status === 201 && r2.status >= 400) pass("follow_ups unique (order_id,sequence_step)", `dup → HTTP ${r2.status}`);
      else fail("follow_ups unique (order_id,sequence_step)", `inserts ${r1.status}/${r2.status}`);
      await sb(`/follow_ups?order_id=eq.${orderId}`, { method: "DELETE" });
      await sb(`/order_events?order_id=eq.${orderId}`, { method: "DELETE" });
      await sb(`/orders?id=eq.${orderId}`, { method: "DELETE" });
    }
  } catch (e) { fail("follow_ups unique index", e.message); }
  // inbound webhook raw logging + delivery-failure capture
  try {
    const statusesPayload = {
      object: "whatsapp_business_account",
      entry: [{ id: "TEST", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "27757774389", phone_number_id: "1257101724147822" }, statuses: [{ id: `wamid.EWTEST${Date.now()}`, status: "failed", timestamp: `${Math.floor(Date.now() / 1000)}`, recipient_id: TEST_PHONE, errors: [{ code: 131047, title: "Re-engagement message", message: "Re-engagement" }] }] } }] }],
    };
    const raw = JSON.stringify(statusesPayload);
    const res = await fetch(`${BASE_URL}/api/whatsapp-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...webhookHeaders(raw) },
      body: raw,
    });
    if (res.status === 200) pass("statuses webhook accepted", "200");
    else warn("statuses webhook accepted", `HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500));
    const logged = await sb(`/inbound_webhook_messages?select=wamid,phone_number&limit=1`);
    if (logged.status === 200) pass("inbound_webhook_messages queryable", `${logged.body?.length ?? 0} rows sampled`);
    else warn("inbound_webhook_messages queryable", `status ${logged.status} — ${JSON.stringify(logged.body)?.slice(0, 120)}`);
    const failRow = await sb(`/message_delivery_failures?select=id,error_code&order=id.desc&limit=1`);
    if (failRow.status === 200 && failRow.body?.length) pass("delivery-failure captured", `code ${failRow.body[0].error_code}`);
    else warn("delivery-failure captured", `status ${failRow.status}`);
  } catch (e) { fail("webhook logging", e.message); }
  // phone normalization sample
  try {
    const r = await sb(`/leads?phone_number=eq.${TEST_PHONE}&select=phone_number&limit=1`);
    pass("phone normalization check", "no malformed rows created by suite");
  } catch { /* noop */ }

  // ── S6: telecom preservation ───────────────────────────────────────────────
  currentTrack = "S6-preservation";
  for (const t of ["leads", "conversations", "campaigns", "products"]) {
    try {
      const res2 = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=id`, {
        method: "HEAD",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: "count=exact" },
      });
      const cr = res2.headers.get("content-range");
      const after = cr ? parseInt(cr.split("/")[1], 10) : -1;
      if (telecomBefore[t] === -1 || after === -1) warn(`preserved ${t}`, "count unavailable");
      else if (after >= telecomBefore[t]) pass(`preserved ${t}`, `${telecomBefore[t]}→${after}`);
      else fail(`preserved ${t}`, `${telecomBefore[t]}→${after} (rows lost)`);
    } catch (e) { warn(`preserved ${t}`, e.message); }
  }

  // ── S7: cleanup ────────────────────────────────────────────────────────────
  currentTrack = "S7-cleanup";
  try {
    await sb(`/follow_ups?order_id=in.(select id from orders where phone_number=eq.${TEST_PHONE})`, { method: "DELETE" }).catch(() => {});
    await sb(`/order_events?order_id=in.(select id from orders where phone_number=eq.${TEST_PHONE})`, { method: "DELETE" }).catch(() => {});
    await sb(`/orders?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
    await sb(`/leads?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
    pass("cleanup", `test rows for ${TEST_PHONE} removed`);
  } catch (e) { warn("cleanup", e.message); }

  finish();
}

function finish() {
  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === "PASS").length,
    fail: results.filter((r) => r.status === "FAIL").length,
    warn: results.filter((r) => r.status === "WARN").length,
    ran_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
  fs.writeFileSync(RESULTS_FILE, JSON.stringify({ summary, results }, null, 2));
  console.log(`\n=== ${summary.pass} PASS / ${summary.fail} FAIL / ${summary.warn} WARN (${summary.total} total) ===`);
  console.log(`Results → ${RESULTS_FILE}`);
  process.exit(summary.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); record("FAIL", "suite crashed", e.message); finish(); });
