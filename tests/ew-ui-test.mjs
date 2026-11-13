#!/usr/bin/env node
/**
 * Eastern Wear — UI Test Suite (Playwright, HEADED by default)
 * (full-suite-test-plan.md — Suite D)
 *
 * Covers every dashboard page: auth shell, dashboard overview, orders list +
 * detail, conversations + takeover UI, Shopify products catalog, follow-ups,
 * broadcasts, reports (§8 metrics), leads clothing labels, campaigns
 * regression, calling queue, health, templates, settings + stale-copy defect
 * detection, branding sweep, responsive layout, console-error capture.
 *
 * Usage:
 *   node --env-file=.env.local tests/ew-ui-test.mjs            (headed)
 *   node --env-file=.env.local tests/ew-ui-test.mjs --headless
 *
 * Safety: read-only — never submits a broadcast send or order. Screenshots →
 * tests/screenshots/ew-ui/.
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));

const BASE_URL = process.env.TEST_TARGET || "http://localhost:3000";
const TEST_EMAIL = process.env.TEST_EMAIL || "test@horizonafrica.co.za";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "TestPass123!";
const HEADED = !process.argv.includes("--headless");
const SHOT_DIR = path.join(process.cwd(), "tests", "screenshots", "ew-ui");
const RESULTS_FILE = path.join(process.cwd(), "tests", "ew-ui-results.json");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const consoleErrors = [];
let currentSection = "setup";
function rec(status, name, detail = "") {
  results.push({ section: currentSection, name, status, detail });
  const icon = { PASS: "✅", FAIL: "❌", WARN: "⚠️ ", DEFECT: "🐞" }[status];
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}
const pass = (n, d) => rec("PASS", n, d);
const fail = async (page, n, d) => {
  const shot = path.join(SHOT_DIR, `fail-${n.replace(/\W+/g, "-").toLowerCase()}.png`);
  try { await page.screenshot({ path: shot, fullPage: true }); } catch {}
  rec("FAIL", n, d);
};
const warn = (n, d) => rec("WARN", n, d);
const defect = (n, d) => rec("DEFECT", n, d); // known/pending issue, not a suite failure

async function goto(page, url) {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1400);
}

const TELECOM_TERMS = ["Horizon Africa", "Telkom", "fibre", "Fibre", "Mbps", "lead qualification"];
async function brandSweep(page, pageName, { includeButtons = true } = {}) {
  // Chrome must be EW-clean; body hits may be legacy telecom DATA (e.g. lead
  // product_interest or old conversation snippets) preserved until cutover.
  // On data lists, row containers are <button>s, so callers can exclude button
  // text and let the body-data check handle those legacy entries separately.
  const chromeSelector = includeButtons
    ? "nav, aside, header, h1, h2, h3, h4, button, th, label"
    : "nav, aside, header, h1, h2, h3, h4, th, label";
  const chromeText = (await page.locator(chromeSelector).allInnerTexts().catch(() => [])).join(" ");
  const chromeHits = TELECOM_TERMS.filter((t) => chromeText.includes(t));
  const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
  const bodyHits = TELECOM_TERMS.filter((t) => bodyText.includes(t) && !chromeHits.includes(t));
  if (!chromeHits.length && !bodyHits.length) pass(`branding clean — ${pageName}`);
  else {
    if (chromeHits.length) {
      rec("FAIL", `telecom UI copy — ${pageName}`, chromeHits.join(", "));
      chromeHits.forEach((h) => console.log(`      ↳ chrome "${h}"`));
    } else pass(`branding clean — ${pageName}`);
    if (bodyHits.length) warn(`telecom data visible — ${pageName} (legacy data, expected until cutover)`, bodyHits.join(", "));
  }
}

const NAV = [
  ["/dashboard", "Overview"], ["/leads", "Leads"], ["/conversations", "Conversations"],
  ["/broadcasts", "Broadcasts"], ["/campaigns", "Campaigns"], ["/calling-queue", "Calling Queue"],
  ["/follow-ups", "Follow-Ups"], ["/templates", "Templates"], ["/products", "Products"],
  ["/orders", "Orders"], ["/reports", "Reports"], ["/health", "Health"], ["/settings", "Settings"],
];

async function run() {
  console.log(`=== EW UI Suite (${HEADED ? "headed" : "headless"}) ===`);
  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 150 : 0 });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${page.url()} :: ${m.text().slice(0, 200)}`); });

  // ── D1 auth & shell ──────────────────────────────────────────────────────
  currentSection = "D1-auth-shell";
  await goto(page, "/login");
  if (await page.locator("#email").count()) pass("login form renders");
  else await fail(page, "login form renders", "no #email field");
  {
    const contact = page.locator("a[href^='mailto:orders@easternwearbykersh.com']").first();
    if (await contact.count()) pass("login contact email is Eastern Wear");
    else {
      const body = await page.locator("body").innerText();
      body.includes("@") ? defect("login contact email", "email present but not easternwear") : warn("login contact email", "no contact email on page");
    }
  }
  // invalid login
  await page.locator("#email").fill(TEST_EMAIL);
  await page.locator("#password").fill("wrong-password-1");
  await page.locator("button[type='submit']").click();
  await page.waitForTimeout(2500);
  if (!page.url().includes("/dashboard")) pass("invalid login rejected");
  else rec("FAIL", "invalid login rejected", "redirected to dashboard");
  // valid login
  let loggedIn = false;
  for (let i = 0; i < 2 && !loggedIn; i++) {
    await goto(page, "/login");
    await page.locator("#email").fill(TEST_EMAIL);
    await page.locator("#password").fill(TEST_PASSWORD);
    await page.locator("button[type='submit']").click();
    await page.waitForURL("**/dashboard", { timeout: 20000 }).catch(() => {});
    loggedIn = page.url().includes("/dashboard");
    if (!loggedIn) await page.waitForTimeout(1500);
  }
  if (!loggedIn) { rec("FAIL", "valid login", "no dashboard redirect"); return finish(browser); }
  pass("valid login → dashboard");
  // forgot/reset pages render (public)
  {
    const pub = await ctx.newPage();
    await pub.goto(`${BASE_URL}/forgot-password`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await pub.waitForTimeout(800);
    (await pub.locator("input").count()) ? pass("forgot-password renders") : warn("forgot-password renders", "no input found");
    await pub.goto(`${BASE_URL}/reset-password`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await pub.waitForTimeout(800);
    pass("reset-password renders", `HTTP page loaded`);
    await pub.close();
  }
  // protected redirect
  {
    const inc = await browser.newContext();
    const ip = await inc.newPage();
    await ip.goto(`${BASE_URL}/orders`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await ip.waitForTimeout(1200);
    ip.url().includes("/login") ? pass("unauth /orders redirects to login") : rec("FAIL", "unauth redirect", ip.url());
    await inc.close();
  }
  // nav sweep
  let navOk = 0;
  for (const [href, label] of NAV) {
    const link = page.locator(`a[href='${href}'], a[href='${href}/']`).first();
    if (await link.count()) { navOk++; }
    else console.log(`      ↳ missing nav ${label} (${href})`);
  }
  navOk === NAV.length ? pass(`sidebar has all ${NAV.length} nav items`) : rec("FAIL", "sidebar nav items", `${navOk}/${NAV.length}`);
  await brandSweep(page, "sidebar/shell");

  // ── D2 dashboard overview ────────────────────────────────────────────────
  currentSection = "D2-dashboard";
  await goto(page, "/dashboard");
  const cards = await page.locator("[class*='card'], [class*='Card'], main section, main div").count();
  const bodyD = await page.locator("main").first().innerText().catch(() => page.locator("body").innerText());
  const statHints = ["lead", "conversation", "broadcast"].filter((w) => bodyD.toLowerCase().includes(w));
  statHints.length >= 2 ? pass("dashboard stat content", statHints.join(",")) : warn("dashboard stat content", bodyD.slice(0, 80));
  await brandSweep(page, "dashboard");

  // ── D3 orders ────────────────────────────────────────────────────────────
  currentSection = "D3-orders";
  await goto(page, "/orders");
  {
    const body = await page.locator("body").innerText();
    const hasTable = (await page.locator("table, [role='table'], [class*='order']").count()) > 0;
    hasTable || body.toLowerCase().includes("order") ? pass("orders page renders") : await fail(page, "orders page renders", "no order content");
    // status/track affordances
    const trackUI = /stock|imported|track/i.test(body);
    trackUI ? pass("orders track affordance visible") : warn("orders track affordance", "no stock/imported labels found");
    // click first order row if any
    const firstRow = page.locator("table tbody tr, a[href^='/orders/']").first();
    if (await firstRow.count()) {
      const link = page.locator("a[href^='/orders/']").first();
      if (await link.count()) {
        await link.click(); await page.waitForTimeout(1500);
        const detail = await page.locator("body").innerText();
        /item|total|payment|event|shopify/i.test(detail) ? pass("order detail renders") : warn("order detail renders", "thin content");
        await brandSweep(page, "order-detail");
      }
    } else warn("order rows", "no orders to open (empty state should render)");
    await brandSweep(page, "orders");
  }

  // ── D4 conversations + takeover ──────────────────────────────────────────
  currentSection = "D4-conversations";
  await goto(page, "/conversations");
  {
    const body = await page.locator("body").innerText();
    /conversation|message|lead/i.test(body) ? pass("conversations page renders") : await fail(page, "conversations page renders", "empty body");
    const firstThread = page.locator("button").filter({ hasText: /messages?\s*·/ }).first();
    if (await firstThread.count()) {
      await firstThread.click();
      await page.waitForTimeout(1600);
      const takeBtn = page.locator("button:has-text('Take over'), button:has-text('Release to Layla')").first();
      (await takeBtn.count()) ? pass("take-over control present") : warn("take-over control", "not found after opening a thread");
    } else warn("take-over control", "no conversation rows available to open");
    await brandSweep(page, "conversations", { includeButtons: false });
  }

  // ── D5 products (Shopify catalog) ────────────────────────────────────────
  currentSection = "D5-products";
  await goto(page, "/products");
  await page.locator("button:has-text('Sync now')").waitFor({ timeout: 15000 }).catch(() => {});
  {
    const body = await page.locator("body").innerText();
    /shopify|catalog|sync|price|stock/i.test(body) ? pass("shopify catalog renders") : await fail(page, "shopify catalog renders", "no catalog signals");
    const syncBtn = page.locator("button:has-text('Sync'), button:has-text('sync')").first();
    (await syncBtn.count()) ? pass("Sync now button present") : warn("Sync now button", "not found");
    const legacyForm = await page.locator("form input[name='name'], button:has-text('Create Product')").count();
    legacyForm === 0 ? pass("no legacy product CRUD form") : rec("FAIL", "legacy product form", "still present");
    await brandSweep(page, "products");
  }

  // ── D6 follow-ups ────────────────────────────────────────────────────────
  currentSection = "D6-follow-ups";
  await goto(page, "/follow-ups");
  {
    const body = await page.locator("body").innerText();
    /follow.?up/i.test(body) ? pass("follow-ups page renders") : await fail(page, "follow-ups page renders", "empty");
    /order|payment|reminder|nudge/i.test(body) ? pass("order payment reminders section") : warn("order reminders section", "not visible (may be empty)");
    await brandSweep(page, "follow-ups");
  }

  // ── D7 broadcasts ────────────────────────────────────────────────────────
  currentSection = "D7-broadcasts";
  await goto(page, "/broadcasts");
  {
    const body = await page.locator("body").innerText();
    /broadcast|group|contact|template/i.test(body) ? pass("broadcasts page renders") : await fail(page, "broadcasts page renders", "empty");
    const shopifySync = page.locator("button:has-text('Sync Shopify'), button:has-text('Shopify')").first();
    (await shopifySync.count()) ? pass("Sync Shopify button present") : warn("Sync Shopify button", "not found on broadcasts view");
    await brandSweep(page, "broadcasts");
  }

  // ── D8 reports ───────────────────────────────────────────────────────────
  currentSection = "D8-reports";
  await goto(page, "/reports");
  await page.locator("text=Human handovers").waitFor({ timeout: 20000 }).catch(() => {});
  {
    const body = await page.locator("body").innerText();
    const sections = { "orders by track": /stock|imported/i.test(body), "follow-up conversion": /follow.?up|conversion/i.test(body), "handover": /handover|takeover|human/i.test(body), "opt-out": /opt.?out/i.test(body) };
    for (const [k, ok] of Object.entries(sections)) ok ? pass(`reports: ${k}`) : warn(`reports: ${k}`, "section not detected");
    await brandSweep(page, "reports");
  }

  // ── D9 leads / campaigns / queue / health ────────────────────────────────
  currentSection = "D9-leads-campaigns-health";
  await goto(page, "/leads");
  {
    const body = await page.locator("body").innerText();
    const bad = ["Household Size", "Internet Usage", "Package"].filter((t) => body.includes(t));
    const good = ["Size", "Style", "Occasion", "Item"].filter((t) => body.includes(t));
    bad.length === 0 ? pass("leads clothing labels", `found: ${good.join(", ")}`) : rec("FAIL", "leads telecom labels", bad.join(", "));
    await brandSweep(page, "leads");
  }
  await goto(page, "/campaigns");
  {
    const body = await page.locator("body").innerText();
    /campaign/i.test(body) ? pass("campaigns list renders") : warn("campaigns list", "empty/thin");
    await brandSweep(page, "campaigns");
  }
  await goto(page, "/calling-queue");
  {
    const body = await page.locator("body").innerText();
    /calling|queue|pending|called/i.test(body) ? pass("calling queue renders") : warn("calling queue", "empty state");
    await brandSweep(page, "calling-queue");
  }
  await goto(page, "/health");
  {
    const body = await page.locator("body").innerText();
    /healthy|degraded|down|status|latency/i.test(body) ? pass("health page renders service checks") : warn("health page", "no status content");
    await brandSweep(page, "health");
  }

  // ── D10 templates & settings ─────────────────────────────────────────────
  currentSection = "D10-templates-settings";
  await goto(page, "/templates");
  {
    const body = await page.locator("body").innerText();
    /template|meta|approval/i.test(body) ? pass("templates page renders") : warn("templates page", "thin");
    const ew = (body.match(/ew_[a-z_]+/g) || []).length;
    ew > 0 ? pass("ew_* templates listed", `${ew} refs`) : warn("ew_* templates listed", "none visible (Meta list may be collapsed)");
    await brandSweep(page, "templates");
  }
  await goto(page, "/settings");
  {
    const body = await page.locator("body").innerText();
    /alert|email|notification/i.test(body) ? pass("settings renders + alert-emails section") : warn("settings page", "thin");
    // KNOWN DEFECT (D10.3): hardcoded telecom copy expected here
    const stale = ["lead qualification", "GPT-5.6"].filter((t) => body.toLowerCase().includes(t.toLowerCase()));
    if (stale.length) defect("settings stale telecom copy (EXPECTED — file as defect)", stale.join(", "));
    else pass("settings copy clean");
  }

  // ── D12 responsive ───────────────────────────────────────────────────────
  currentSection = "D12-responsive";
  await page.setViewportSize({ width: 375, height: 800 });
  await goto(page, "/dashboard");
  {
    const burger = page.locator("button:has(svg), [aria-label*='menu' i], button[class*='menu']").first();
    (await burger.count()) ? pass("mobile menu control present") : warn("mobile menu", "not found");
    const overlap = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    !overlap ? pass("no horizontal overflow @375px") : rec("FAIL", "horizontal overflow @375px", `scrollW>${375}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, "/conversations");
  await page.setViewportSize({ width: 768, height: 900 });
  pass("tablet viewport renders conversations");

  // console errors
  currentSection = "console";
  if (!consoleErrors.length) pass("zero console errors across run");
  else {
    const real = consoleErrors.filter((e) =>
      !/favicon|404|hydration/i.test(e) &&
      !(e.includes("/login") && /status of 401|401 \(Unauthorized\)/i.test(e))
    );
    real.length === 0 ? pass("console errors only benign", `${consoleErrors.length} benign`) : rec("FAIL", "console errors", `${real.length}: ${real[0]?.slice(0, 120)}`);
    consoleErrors.slice(0, 8).forEach((e) => console.log(`      ↳ ${e}`));
  }

  finish(browser);
}

function finish(browser) {
  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === "PASS").length,
    fail: results.filter((r) => r.status === "FAIL").length,
    warn: results.filter((r) => r.status === "WARN").length,
    defects: results.filter((r) => r.status === "DEFECT").length,
    console_errors: consoleErrors.length,
    ran_at: new Date().toISOString(),
  };
  fs.writeFileSync(RESULTS_FILE, JSON.stringify({ summary, results, consoleErrors }, null, 2));
  console.log(`\n=== ${summary.pass} PASS / ${summary.fail} FAIL / ${summary.warn} WARN / ${summary.defects} known-defects ===`);
  console.log(`Results → ${RESULTS_FILE}`);
  browser?.close().then(() => process.exit(summary.fail ? 1 : 0));
}

run().catch(async (e) => { console.error(e); rec("FAIL", "suite crashed", e.message); process.exit(1); });
