// Quick verification for: leads PATCH lock flags + dashboard conversation count.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

try {
  // Login
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await page.waitForTimeout(1500); // hydration
  await page.fill('input[type="email"]', "test@horizonafrica.co.za");
  await page.fill('input[type="password"]', "TestPass123!");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|leads|conversations/, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3000);

  // 1. Dashboard stat shows distinct conversation count
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const allText = await page.locator("body").innerText();
  const m = allText.match(/Active Conversations[\s\S]{0,60}?(\d+)/i);
  check("Dashboard Active Conversations = 1", m?.[1] === "1", `found: ${m?.[1] ?? "?"}`);

  // Cookie for API calls
  const cookies = await ctx.cookies(BASE);
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  // 2. PATCH lead_score sets score_locked
  const r1 = await fetch(`${BASE}/api/leads/816`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ lead_score: "WARM" }),
  });
  const j1 = await r1.json();
  check("PATCH lead_score=200", r1.ok);
  check("PATCH returns score_locked=true", j1.lead?.score_locked === true, `got ${j1.lead?.score_locked}`);

  // 3. Invalid enum rejected
  const r2 = await fetch(`${BASE}/api/leads/816`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ lead_score: "SCORCHING" }),
  });
  check("Invalid lead_score rejected (400)", r2.status === 400);

  // 4. Unlock works
  const r3 = await fetch(`${BASE}/api/leads/816`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ score_locked: false }),
  });
  const j3 = await r3.json();
  check("Unlock score_locked=false works", j3.lead?.score_locked === false);

  // 5. Status lock
  const r4 = await fetch(`${BASE}/api/leads/816`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ status: "qualified" }),
  });
  const j4 = await r4.json();
  check("PATCH status sets status_locked=true", j4.lead?.status_locked === true);

  // Restore lead 816 to pre-test state
  await supabase.from("leads").update({ lead_score: "HOT", status: "new", score_locked: false, status_locked: false }).eq("id", 816);
  console.log("Restored lead 816 -> HOT/new/unlocked");
} catch (e) {
  console.log("ERROR:", e.message);
  check("No exceptions", false, e.message);
} finally {
  await browser.close();
}

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} checks passed`);
process.exit(fails ? 1 : 0);
