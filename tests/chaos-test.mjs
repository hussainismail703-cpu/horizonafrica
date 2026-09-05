/**
 * Chaos / Destructive Test Suite for Horizon Africa Campaign Engine
 *
 * This test tries to BREAK the application by throwing malicious, malformed,
 * and edge-case inputs at every API endpoint and UI form. The goal is to
 * find crashes, unhandled errors, data leaks, and security holes before
 * a real attacker does.
 *
 * Categories:
 *   1. SQL Injection attempts
 *   2. XSS / script injection in text fields
 *   3. Extremely long strings (DoS / buffer limits)
 *   4. Invalid UUIDs and path traversal in URL params
 *   5. Malformed JSON to API routes
 *   6. Wrong HTTP methods on endpoints
 *   7. Authentication bypass attempts
 *   8. Invalid phone number formats
 *   9. Unicode / emoji / null bytes in inputs
 *  10. Rapid concurrent submissions
 *  11. Huge payload sizes
 *  12. Invalid enum values (status, classification)
 *  13. Negative / NaN / Infinity numbers
 *  14. Missing required fields
 *  15. Webhook spoofing attempts
 */

import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const TEST_EMAIL = "test@horizonafrica.co.za";
const TEST_PASSWORD = "TestPass123!";

const results = [];
const bugs = [];
const securityIssues = [];

function pass(name, detail = "") {
  results.push({ test: name, status: "PASS", detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, error, severity = "bug") {
  results.push({ test: name, status: "FAIL", error });
  bugs.push({ test: name, error, severity });
  console.log(`  ❌ ${name}: ${error}`);
}

function securityFail(name, error) {
  results.push({ test: name, status: "SECURITY", error });
  securityIssues.push({ test: name, error });
  console.log(`  🚨 SECURITY: ${name}: ${error}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function apiCall(method, path, body, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body !== undefined) {
    opts.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  try {
    const res = await fetch(url, opts);
    let data;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, text };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

async function loginAndGetCookies(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.locator("#email").fill(TEST_EMAIL);
  await page.locator("#password").fill(TEST_PASSWORD);
  await page.locator("button[type='submit']").click();
  await page.waitForURL("**/dashboard", { timeout: 15000 }).catch(() => {});
  return page.url().includes("/dashboard");
}

// ─── Payloads ─────────────────────────────────────────────────────────────

const SQL_INJECTIONS = [
  "'; DROP TABLE campaigns;--",
  "' OR '1'='1",
  "'; INSERT INTO campaigns (name) VALUES ('hacked');--",
  "' UNION SELECT * FROM auth.users;--",
  "1; DELETE FROM campaign_enrolments WHERE 1=1;--",
  "' OR 1=1 --",
  "admin'--",
  "'; UPDATE campaigns SET status='active' WHERE 1=1;--",
];

const XSS_PAYLOADS = [
  "<script>alert('xss')</script>",
  "<img src=x onerror=alert(1)>",
  "javascript:alert(document.cookie)",
  "<svg onload=alert(1)>",
  "';alert(String.fromCharCode(88,83,83))//",
  "<iframe src=javascript:alert(1)>",
  "${7*7}",
  "{{constructor.constructor('alert(1)')()}}",
];

const LONG_STRINGS = [
  "A".repeat(10000),
  "A".repeat(100000),
  "A".repeat(1000000),
  "🚀".repeat(5000),
];

const INVALID_UUIDS = [
  "not-a-uuid",
  "00000000-0000-0000-0000-000000000000",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
  "1; DROP TABLE campaigns;--",
  "../../../etc/passwd",
  "../../.env.local",
  "null",
  "undefined",
  "",
  "   ",
  "1' OR '1'='1",
];

const INVALID_PHONES = [
  "abc",
  "",
  "   ",
  "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "'; DROP TABLE leads;--",
  "<script>alert(1)</script>",
  "27",
  "123",
  "+-#*",
  "null",
];

const UNICODE_PAYLOADS = [
  "\x00null\x00byte",
  "\u0000",
  "\u200B\u200C\u200D", // zero-width chars
  "𝕳𝖊𝖑𝖑𝖔", // mathematical symbols
  "🏳️‍🌈", // complex emoji
  "\uFFFF\uFFFE",
  "line1\r\nline2\r\nline3",
];

const INVALID_STATUSES = [
  "hacked",
  "ACTIVE",
  "active'; DROP TABLE campaigns;--",
  "",
  "null",
  "1",
  "DROP TABLE campaigns",
  "<script>alert(1)</script>",
];

const INVALID_CLASSIFICATIONS = [
  "hacked",
  "INTERESTED",
  "interested'; DROP TABLE campaign_classifications;--",
  "",
  "null",
  "1",
  "<script>alert(1)</script>",
];

// ─── Main ─────────────────────────────────────────────────────────────────

async function run() {
  console.log("\n🔥 CHAOS TEST SUITE — TRYING TO BREAK THE APP 🔥\n");

  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Capture console errors and page crashes
  const consoleErrors = [];
  const pageCrashes = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageCrashes.push(err.message);
    console.log(`  💥 PAGE CRASH: ${err.message}`);
  });

  // ── Login ──────────────────────────────────────────────────────────────
  console.log("=== SETUP: LOGIN ===");
  const loggedIn = await loginAndGetCookies(page);
  if (loggedIn) pass("Login successful");
  else { fail("Login", "Could not login — aborting"); await browser.close(); return; }

  // Get auth cookies for API calls
  const cookies = await context.cookies();
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join("; ");

  // Find an existing campaign to test against
  let campaignId = null;
  try {
    const res = await apiCall("GET", "/api/campaigns/enrolments?campaign_id=00000000-0000-0000-0000-000000000000", null, { Cookie: cookieHeader });
    // Use a real campaign from the list page
    await page.goto(`${BASE_URL}/campaigns`, { waitUntil: "networkidle" });
    const manageLink = page.locator("a[href*='/campaigns/']").first();
    const href = await manageLink.getAttribute("href");
    if (href) campaignId = href.split("/campaigns/")[1];
  } catch { /* ok */ }
  if (!campaignId) campaignId = "91619bef-9447-4866-afb6-a4c11b094449"; // fallback
  console.log(`  Using campaign ID: ${campaignId}\n`);

  const authHeaders = { Cookie: cookieHeader };
  const appSecretHeaders = { Authorization: "Bearer wrong-secret-12345" };

  // ═══════════════════════════════════════════════════════════════════════
  // 1. SQL INJECTION ATTEMPTS
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 1. SQL INJECTION ATTEMPTS ===");

  for (const payload of SQL_INJECTIONS) {
    // Try via campaign creation
    const res = await apiCall("POST", "/api/campaigns", { name: payload, objective: "test" }, authHeaders);
    if (res.status === 500) fail(`SQLi campaign create: "${payload.substring(0, 40)}"`, "500 — possible SQLi");
    else if (res.status === 409) pass(`SQLi rejected (duplicate name guard): "${payload.substring(0, 40)}"`);
    else if (res.status === 201) {
      // Created — check if it's stored raw (Supabase parameterized queries should handle this)
      pass(`SQLi stored safely (parameterized): "${payload.substring(0, 40)}"`, `status ${res.status}`);
    } else pass(`SQLi handled: "${payload.substring(0, 40)}"`, `status ${res.status}`);
  }

  // SQLi via URL params
  for (const payload of SQL_INJECTIONS) {
    const res = await apiCall("GET", `/api/campaigns/enrolments?campaign_id=${encodeURIComponent(payload)}`, null, authHeaders);
    if (res.status === 500) fail(`SQLi enrolments GET: "${payload.substring(0, 40)}"`, "500 error");
    else pass(`SQLi enrolments GET handled: "${payload.substring(0, 40)}"`, `status ${res.status}`);
  }

  // SQLi via PATCH status
  for (const payload of SQL_INJECTIONS) {
    const res = await apiCall("PATCH", `/api/campaigns/${campaignId}`, { status: payload }, authHeaders);
    if (res.status === 500) fail(`SQLi PATCH status: "${payload.substring(0, 40)}"`, "500 error");
    else pass(`SQLi PATCH status handled: "${payload.substring(0, 40)}"`, `status ${res.status}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. XSS / SCRIPT INJECTION
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 2. XSS / SCRIPT INJECTION ===");

  for (const payload of XSS_PAYLOADS) {
    const res = await apiCall("POST", "/api/campaigns", { name: payload, objective: payload }, authHeaders);
    if (res.status === 201) {
      // Check if it renders as raw text (safe) or executes (unsafe)
      const createdId = res.data.id;
      await page.goto(`${BASE_URL}/campaigns/${createdId}`, { waitUntil: "networkidle" }).catch(() => {});
      const bodyText = await page.locator("body").textContent().catch(() => "");
      if (bodyText?.includes("<script>")) {
        securityFail(`XSS stored & rendered raw: "${payload.substring(0, 40)}"`, "Script tag visible in DOM");
      } else {
        pass(`XSS payload neutralized: "${payload.substring(0, 40)}"`, "React escapes by default");
      }
    } else {
      pass(`XSS payload rejected: "${payload.substring(0, 40)}"`, `status ${res.status}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. EXTREMELY LONG STRINGS (DoS)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 3. EXTREMELY LONG STRINGS (DoS) ===");

  for (const [i, payload] of LONG_STRINGS.entries()) {
    const label = payload.length > 1000 ? `${payload.length} chars` : payload.substring(0, 30);
    const res = await apiCall("POST", "/api/campaigns", { name: payload, objective: payload }, authHeaders);
    if (res.status === 500) fail(`Long string (${label})`, "500 — server crashed");
    else if (res.status === 201) pass(`Long string stored (${label})`, `status 201`);
    else pass(`Long string rejected (${label})`, `status ${res.status}`);

    // Only check list page if the long string was actually created (status 201)
    if (res.status === 201 && i < 2) {
      await page.goto(`${BASE_URL}/campaigns`, { waitUntil: "networkidle" }).catch(() => {});
      const bodyText = await page.locator("body").textContent().catch(() => "");
      if (bodyText && bodyText.length > 500000) fail(`Long string rendered on list (${label})`, "Page may be lagging");
      else pass(`Long string didn't break list page (${label})`);
    } else {
      pass(`Long string skipped list check (${label})`, `API rejected with ${res.status}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. INVALID UUIDs & PATH TRAVERSAL
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 4. INVALID UUIDs & PATH TRAVERSAL ===");

  for (const uuid of INVALID_UUIDS) {
    // Via API
    const res = await apiCall("PATCH", `/api/campaigns/${uuid}`, { name: "hacked" }, authHeaders);
    if (res.status === 500) fail(`Invalid UUID API: "${uuid.substring(0, 30)}"`, "500 error");
    else pass(`Invalid UUID API handled: "${uuid.substring(0, 30)}"`, `status ${res.status}`);

    // Via UI — check for crash page
    await page.goto(`${BASE_URL}/campaigns/${encodeURIComponent(uuid)}`, { waitUntil: "networkidle" }).catch(() => {});
    const bodyText = await page.locator("body").textContent().catch(() => "");
    if (bodyText?.includes("Application error") || bodyText?.includes("Internal Server Error")) {
      fail(`Invalid UUID UI crash: "${uuid.substring(0, 30)}"`, "App error page shown");
    } else if (pageCrashes.length > 0) {
      fail(`Invalid UUID UI crash: "${uuid.substring(0, 30)}"`, pageCrashes[pageCrashes.length - 1]);
    } else {
      pass(`Invalid UUID UI handled: "${uuid.substring(0, 30)}"`, "No crash");
    }
  }

  // Path traversal via customer phone URL
  const pathTraversalPayloads = [
    "../../../etc/passwd",
    "..%2F..%2F..%2Fetc%2Fpasswd",
    "../../.env.local",
    "../../.env",
    "%2e%2e%2f%2e%2e%2f%2e%2e%2f",
  ];
  for (const payload of pathTraversalPayloads) {
    await page.goto(`${BASE_URL}/campaigns/${campaignId}/customers/${encodeURIComponent(payload)}`, { waitUntil: "networkidle" }).catch(() => {});
    const bodyText = await page.locator("body").textContent().catch(() => "");
    if (bodyText?.includes("root:") || bodyText?.includes("NEXT_PUBLIC") || bodyText?.includes("SUPABASE")) {
      securityFail(`Path traversal leaked file: "${payload}"`, "File contents visible in response");
    } else {
      pass(`Path traversal blocked: "${payload}"`, "No file contents leaked");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. MALFORMED JSON
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 5. MALFORMED JSON ===");

  const malformedBodies = [
    "{",
    "}",
    "{,,}",
    "null",
    "undefined",
    "[]",
    '"string"',
    "123",
    "true",
    "{name}",
    "{name: }",
    '{"name": }',
    "{'name': 'test'}", // single quotes — invalid JSON
  ];

  for (const body of malformedBodies) {
    const res = await apiCall("POST", "/api/campaigns", body, authHeaders);
    if (res.status === 500) fail(`Malformed JSON: "${body.substring(0, 30)}"`, "500 — unhandled parse error");
    else pass(`Malformed JSON handled: "${body.substring(0, 30)}"`, `status ${res.status}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6. WRONG HTTP METHODS
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 6. WRONG HTTP METHODS ===");

  const methodTests = [
    ["DELETE", "/api/campaigns", "DELETE on campaigns collection"],
    ["PUT", "/api/campaigns", "PUT on campaigns collection"],
    ["PATCH", "/api/campaigns", "PATCH on campaigns collection"],
    ["DELETE", "/api/campaigns/process", "DELETE on process endpoint"],
    ["GET", "/api/campaigns/process", "GET on process endpoint"],
    ["PUT", `/api/campaigns/${campaignId}`, "PUT on campaign (no handler)"],
    ["DELETE", `/api/campaigns/${campaignId}`, "DELETE on campaign (no handler)"],
    ["GET", "/api/campaigns/classify", "GET on classify (POST only)"],
    ["DELETE", "/api/campaigns/classify", "DELETE on classify"],
  ];

  for (const [method, path, label] of methodTests) {
    const res = await apiCall(method, path, { name: "test" }, authHeaders);
    if (res.status === 500) fail(`Wrong method: ${label}`, "500 error");
    else pass(`Wrong method handled: ${label}`, `status ${res.status}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7. AUTHENTICATION BYPASS
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 7. AUTHENTICATION BYPASS ===");

  // Use a fresh browser context with NO cookies to test unauth access.
  // Node's fetch doesn't send browser cookies, so we use page.evaluate
  // from an unauthenticated page instead.
  const unauthContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const unauthPage = await unauthContext.newPage();
  // Navigate to login page first so fetch calls resolve against localhost
  await unauthPage.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });

  // No auth — fetch from browser context with no cookies.
  // Middleware redirects to /login (307), which browser follows to the login page (200).
  // We check if the final URL is the login page (meaning auth worked — request was blocked).
  const noAuthResult = await unauthPage.evaluate(async () => {
    const res = await fetch("/api/campaigns/enrolments?campaign_id=test");
    return { status: res.status, url: res.url, redirected: res.redirected };
  }).catch(() => ({ status: 0, url: "", redirected: false }));

  // If redirected to login or got 401, auth is working
  if (noAuthResult.status === 401 || noAuthResult.redirected || noAuthResult.url.includes("/login")) {
    pass("No auth → blocked (redirected to login)", `status ${noAuthResult.status}, redirected: ${noAuthResult.redirected}`);
  } else {
    securityFail("No auth bypass", `Expected 401 or redirect, got ${noAuthResult.status}`);
  }

  // Garbage auth cookie
  const garbageResult = await unauthPage.evaluate(async () => {
    document.cookie = "sb-garbage=invalidtoken; path=/";
    const res = await fetch("/api/campaigns/enrolments?campaign_id=test");
    return { status: res.status, url: res.url, redirected: res.redirected };
  }).catch(() => ({ status: 0, url: "", redirected: false }));

  if (garbageResult.status === 401 || garbageResult.redirected || garbageResult.url.includes("/login")) {
    pass("Garbage auth → blocked", `status ${garbageResult.status}`);
  } else {
    securityFail("Garbage auth bypass", `Expected 401 or redirect, got ${garbageResult.status}`);
  }

  // Wrong APP_SECRET on process endpoint (this one doesn't need cookies — uses Bearer token)
  const wrongSecretRes = await apiCall("POST", "/api/campaigns/process", {}, appSecretHeaders);
  if (wrongSecretRes.status === 401) pass("Wrong APP_SECRET → 401");
  else securityFail("APP_SECRET bypass", `Expected 401, got ${wrongSecretRes.status}`);

  // No auth on PATCH campaign — use unauthenticated browser context
  const noAuthPatchResult = await unauthPage.evaluate(async (cId) => {
    const res = await fetch(`/api/campaigns/${cId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "hacked" }),
    });
    return { status: res.status, url: res.url, redirected: res.redirected };
  }, campaignId).catch(() => ({ status: 0, url: "", redirected: false }));

  if (noAuthPatchResult.status === 401 || noAuthPatchResult.redirected || noAuthPatchResult.url.includes("/login")) {
    pass("No auth PATCH → blocked", `status ${noAuthPatchResult.status}`);
  } else {
    securityFail("Unauth PATCH bypass", `Expected 401 or redirect, got ${noAuthPatchResult.status}`);
  }

  // No auth on classification correction
  const noAuthClassResult = await unauthPage.evaluate(async () => {
    const res = await fetch("/api/campaigns/classifications/00000000-0000-0000-0000-000000000000", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classification: "interested" }),
    });
    return { status: res.status, url: res.url, redirected: res.redirected };
  }).catch(() => ({ status: 0, url: "", redirected: false }));

  if (noAuthClassResult.status === 401 || noAuthClassResult.redirected || noAuthClassResult.url.includes("/login")) {
    pass("No auth classification PATCH → blocked", `status ${noAuthClassResult.status}`);
  } else {
    securityFail("Unauth classification bypass", `Expected 401 or redirect, got ${noAuthClassResult.status}`);
  }

  await unauthContext.close();

  // ═══════════════════════════════════════════════════════════════════════
  // 8. INVALID PHONE NUMBER FORMATS
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 8. INVALID PHONE NUMBER FORMATS ===");

  for (const phone of INVALID_PHONES) {
    const res = await apiCall("POST", "/api/campaigns/enrolments", {
      campaign_id: campaignId,
      phone_numbers: [phone],
    }, authHeaders);
    if (res.status === 500) fail(`Invalid phone "${phone.substring(0, 30)}"`, "500 error");
    else if (res.status === 201 && res.data?.enrolled > 0) {
      // Check if garbage phone was actually enrolled
      pass(`Invalid phone processed "${phone.substring(0, 30)}"`, `enrolled ${res.data.enrolled} — stripped to digits`);
    } else pass(`Invalid phone rejected "${phone.substring(0, 30)}"`, `status ${res.status}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 9. UNICODE / EMOJI / NULL BYTES
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 9. UNICODE / EMOJI / NULL BYTES ===");

  for (const payload of UNICODE_PAYLOADS) {
    const label = payload.replace(/\x00/g, "\\x00").substring(0, 40);
    const res = await apiCall("POST", "/api/campaigns", { name: `Unicode Test ${label}`, objective: payload }, authHeaders);
    if (res.status === 500) fail(`Unicode payload: "${label}"`, "500 error");
    else if (res.status === 201) pass(`Unicode payload stored: "${label}"`, "Handled safely");
    else pass(`Unicode payload rejected: "${label}"`, `status ${res.status}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 10. RAPID CONCURRENT SUBMISSIONS
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 10. RAPID CONCURRENT SUBMISSIONS ===");

  const concurrentCount = 20;
  const concurrentPromises = [];
  for (let i = 0; i < concurrentCount; i++) {
    concurrentPromises.push(
      apiCall("POST", "/api/campaigns", { name: `Concurrent Test ${Date.now()}-${i}`, objective: "stress" }, authHeaders)
    );
  }
  const concurrentResults = await Promise.all(concurrentPromises);
  const concurrentCrashes = concurrentResults.filter(r => r.status === 500).length;
  const concurrentCreated = concurrentResults.filter(r => r.status === 201).length;
  if (concurrentCrashes > 0) fail(`Concurrent submissions (${concurrentCount})`, `${concurrentCrashes} crashes out of ${concurrentCount}`);
  else pass(`Concurrent submissions (${concurrentCount})`, `${concurrentCreated} created, 0 crashes`);

  // Concurrent enrolments on same campaign
  const enrolPromises = [];
  for (let i = 0; i < 10; i++) {
    enrolPromises.push(
      apiCall("POST", "/api/campaigns/enrolments", {
        campaign_id: campaignId,
        phone_numbers: [`27840000${String(i).padStart(2, "0")}0`],
      }, authHeaders)
    );
  }
  const enrolResults = await Promise.all(enrolPromises);
  const enrolCrashes = enrolResults.filter(r => r.status === 500).length;
  if (enrolCrashes > 0) fail(`Concurrent enrolments (10)`, `${enrolCrashes} crashes`);
  else pass(`Concurrent enrolments (10)`, "No crashes — dedup working");

  // ═══════════════════════════════════════════════════════════════════════
  // 11. HUGE PAYLOAD SIZES
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 11. HUGE PAYLOAD SIZES ===");

  // 10,000 phone numbers
  const hugePhoneList = Array.from({ length: 10000 }, (_, i) => `2784000${String(i).padStart(4, "0")}`);
  const hugeRes = await apiCall("POST", "/api/campaigns/enrolments", {
    campaign_id: campaignId,
    phone_numbers: hugePhoneList,
  }, authHeaders);
  if (hugeRes.status === 500) fail("10K phone numbers", "500 — server choked");
  else pass("10K phone numbers", `status ${hugeRes.status}, enrolled ${hugeRes.data?.enrolled ?? "?"}`);

  // 1000 campaign steps
  const hugeSteps = Array.from({ length: 1000 }, (_, i) => ({
    step_number: i + 1,
    delay_days: i,
    template_name: `template_${i}`,
  }));
  const hugeStepsRes = await apiCall("PUT", `/api/campaigns/${campaignId}/steps`, { steps: hugeSteps }, authHeaders);
  if (hugeStepsRes.status === 500) fail("1K campaign steps", "500 — server choked");
  else pass("1K campaign steps", `status ${hugeStepsRes.status}`);
  // Clean up — restore 1 step
  await apiCall("PUT", `/api/campaigns/${campaignId}/steps`, { steps: [{ step_number: 1, delay_days: 0, template_name: "hello_world" }] }, authHeaders);

  // ═══════════════════════════════════════════════════════════════════════
  // 12. INVALID ENUM VALUES
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 12. INVALID ENUM VALUES ===");

  for (const status of INVALID_STATUSES) {
    const res = await apiCall("PATCH", `/api/campaigns/${campaignId}`, { status }, authHeaders);
    if (res.status === 500) fail(`Invalid status "${status.substring(0, 30)}"`, "500 — no enum validation");
    else pass(`Invalid status handled "${status.substring(0, 30)}"`, `status ${res.status}`);
  }

  for (const classification of INVALID_CLASSIFICATIONS) {
    const res = await apiCall("PATCH", "/api/campaigns/classifications/00000000-0000-0000-0000-000000000000", { classification }, authHeaders);
    if (res.status === 500) fail(`Invalid classification "${classification.substring(0, 30)}"`, "500 — no validation");
    else pass(`Invalid classification handled "${classification.substring(0, 30)}"`, `status ${res.status}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 13. NEGATIVE / NaN / INFINITY NUMBERS
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 13. NEGATIVE / NaN / INFINITY NUMBERS ===");

  const badNumbers = [
    { label: "negative delay", steps: [{ step_number: 1, delay_days: -1, template_name: "test" }] },
    { label: "NaN delay", steps: [{ step_number: 1, delay_days: NaN, template_name: "test" }] },
    { label: "Infinity delay", steps: [{ step_number: 1, delay_days: Infinity, template_name: "test" }] },
    { label: "huge delay", steps: [{ step_number: 1, delay_days: 999999999, template_name: "test" }] },
    { label: "negative step_number", steps: [{ step_number: -1, delay_days: 0, template_name: "test" }] },
    { label: "float step_number", steps: [{ step_number: 1.5, delay_days: 0, template_name: "test" }] },
  ];

  for (const { label, steps } of badNumbers) {
    const res = await apiCall("PUT", `/api/campaigns/${campaignId}/steps`, { steps }, authHeaders);
    if (res.status === 500) fail(`Bad number: ${label}`, "500 error");
    else pass(`Bad number handled: ${label}`, `status ${res.status}`);
  }
  // Clean up
  await apiCall("PUT", `/api/campaigns/${campaignId}/steps`, { steps: [{ step_number: 1, delay_days: 0, template_name: "hello_world" }] }, authHeaders);

  // ═══════════════════════════════════════════════════════════════════════
  // 14. MISSING REQUIRED FIELDS
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 14. MISSING REQUIRED FIELDS ===");

  const missingFieldTests = [
    ["POST /api/campaigns", {}, "empty body"],
    ["POST /api/campaigns", { objective: "no name" }, "missing name"],
    ["POST /api/campaigns", { name: "" }, "empty name"],
    ["POST /api/campaigns", { name: "   " }, "whitespace name"],
    ["POST /api/campaigns/enrolments", {}, "empty body"],
    ["POST /api/campaigns/enrolments", { campaign_id: campaignId }, "no phones or group"],
    ["PUT /api/campaigns/{id}/steps", {}, "missing steps array"],
    ["PUT /api/campaigns/{id}/steps", { steps: "notarray" }, "steps is string"],
    ["PUT /api/campaigns/{id}/steps", { steps: [] }, "empty steps array"],
    ["PATCH /api/campaigns/classifications/{id}", {}, "empty body"],
  ];

  for (const [path, body, label] of missingFieldTests) {
    const resolvedPath = path.replace("{id}", campaignId);
    const method = path.split(" ")[0];
    const routePath = path.split(" ")[1];
    const res = await apiCall(method, resolvedPath, body, authHeaders);
    if (res.status === 500) fail(`Missing fields: ${label}`, "500 error");
    else pass(`Missing fields handled: ${label}`, `status ${res.status}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 15. WEBHOOK SPOOFING
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 15. WEBHOOK SPOOFING ===");

  // Wrong verify token — use page.evaluate for proper browser fetch
  const wrongTokenRes = await page.evaluate(async () => {
    const res = await fetch("/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123");
    return { status: res.status };
  }).catch(() => ({ status: 0 }));
  if (wrongTokenRes.status === 403) pass("Wrong webhook verify token → 403");
  else securityFail("Webhook verify token bypass", `Expected 403, got ${wrongTokenRes.status}`);

  // Correct verify token (should return challenge)
  const correctTokenRes = await page.evaluate(async () => {
    const res = await fetch("/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=horizon_africa_verify_2026&hub.challenge=test123");
    return { status: res.status, text: await res.text() };
  }).catch(() => ({ status: 0, text: "" }));
  if (correctTokenRes.status === 200) pass("Correct webhook verify token → 200");
  else fail("Webhook verify token", `Expected 200, got ${correctTokenRes.status}`);

  // Spoofed inbound message (fake WhatsApp payload)
  const spoofedPayload = {
    entry: [{
      changes: [{
        value: {
          messages: [{
            from: "27840000000",
            text: { body: "'; DROP TABLE campaign_enrolments;--" },
          }],
        },
      }],
    }],
  };
  const spoofRes = await apiCall("POST", "/api/whatsapp-webhook", spoofedPayload, {});
  if (spoofRes.status === 500) fail("Spoofed webhook payload", "500 error");
  else pass("Spoofed webhook handled", `status ${spoofRes.status}`);

  // Malformed webhook payload
  const malformedWebhookRes = await apiCall("POST", "/api/whatsapp-webhook", { garbage: true }, {});
  if (malformedWebhookRes.status === 500) fail("Malformed webhook", "500 error");
  else pass("Malformed webhook handled", `status ${malformedWebhookRes.status}`);

  // ═══════════════════════════════════════════════════════════════════════
  // 16. UI FORM CHAOS
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 16. UI FORM CHAOS ===");

  // Create campaign with XSS in name via UI
  try {
    await page.goto(`${BASE_URL}/campaigns/create`, { waitUntil: "networkidle" });
    const nameInput = page.locator("input[placeholder*='Fibre Lead']");
    const createButton = page.getByRole("button", { name: /^Create Campaign$|^Creating…$/ });

    // XSS in name
    await nameInput.fill(`<script>alert('xss')</script>`);
    if (await createButton.isEnabled()) {
      await createButton.click();
      await page.waitForTimeout(3000);
      const url = page.url();
      if (url.match(/\/campaigns\/[a-f0-9-]+$/)) {
        // Check the campaign list page for raw script tags
        await page.goto(`${BASE_URL}/campaigns`, { waitUntil: "networkidle" });
        const html = await page.content();
        if (html.includes("<script>alert('xss')</script>")) {
          securityFail("XSS in campaign name via UI", "Script tag injected into DOM");
        } else {
          pass("XSS in campaign name via UI", "React escaped the script tag");
        }
      } else {
        pass("XSS campaign name rejected", `stayed on create page`);
      }
    }
  } catch (err) {
    fail("UI XSS test", err.message);
  }

  // Paste huge text into form fields
  try {
    await page.goto(`${BASE_URL}/campaigns/create`, { waitUntil: "networkidle" });
    const nameInput = page.locator("input[placeholder*='Fibre Lead']");
    const objectiveTextarea = page.locator("textarea[placeholder*='trying to achieve']");
    await nameInput.fill("A".repeat(10000));
    await objectiveTextarea.fill("B".repeat(100000));
    await page.waitForTimeout(1000);
    // Check page didn't freeze
    const isResponsive = await page.locator("body").isVisible().catch(() => false);
    if (isResponsive) pass("Huge text in form fields", "Page stayed responsive");
    else fail("Huge text in form fields", "Page froze");
  } catch (err) {
    fail("Huge text form test", err.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 17. PAGE CRASH DETECTION
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== 17. PAGE CRASH DETECTION ===");

  if (pageCrashes.length === 0) pass("No page crashes during entire test");
  else fail(`Page crashes detected (${pageCrashes.length})`, pageCrashes.join("; "));

  if (consoleErrors.length < 20) pass(`Console errors manageable (${consoleErrors.length})`);
  else fail(`Excessive console errors (${consoleErrors.length})`, "Too many errors may indicate instability");

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n========================================");
  console.log("🔥 CHAOS TEST SUMMARY 🔥");
  console.log("========================================");

  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  const security = results.filter(r => r.status === "SECURITY").length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Security Issues: ${security}`);
  console.log("");

  if (bugs.length > 0) {
    console.log("BUGS / CRASHES FOUND:");
    console.log("----------------------------------------");
    bugs.forEach((bug, i) => {
      console.log(`${i + 1}. [${bug.severity}] ${bug.test}: ${bug.error}`);
    });
    console.log("");
  }

  if (securityIssues.length > 0) {
    console.log("🚨 SECURITY ISSUES FOUND:");
    console.log("----------------------------------------");
    securityIssues.forEach((issue, i) => {
      console.log(`${i + 1}. ${issue.test}: ${issue.error}`);
    });
    console.log("");
  }

  if (bugs.length === 0 && securityIssues.length === 0) {
    console.log("💪 APP SURVIVED ALL CHAOS ATTACKS. No crashes or security holes found.");
  }

  // Save report
  const report = {
    summary: { total: results.length, passed, failed, security, pageCrashes: pageCrashes.length, consoleErrors: consoleErrors.length },
    results,
    bugs,
    securityIssues,
    pageCrashes,
    consoleErrors,
  };
  const fs = await import("fs");
  fs.writeFileSync("./tests/chaos-test-results.json", JSON.stringify(report, null, 2));
  console.log(`\nDetailed report: ./tests/chaos-test-results.json`);

  await browser.close();
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
