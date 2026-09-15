#!/usr/bin/env node
/**
 * Phase 1 Full System Retest — master runner.
 *
 * Runs every Phase 1 test stage in order and produces one aggregated report:
 *   Stage 0  Pre-flight checks (inline)
 *   Stage 1  UI — headed browser (ui-dashboard + campaign-engine + gap UI)
 *   Stage 2  Campaign engine backend (response + client-sim + advanced-sim)
 *   Stage 3  API + security (comprehensive + chaos)
 *   Stage 4  n8n / AI pipeline (ai-conversation + workflow-e2e)
 *   Stage 5  Live WhatsApp (--live only, rate-limit aware)
 *   Stage 6  New-feature gap tests (phase1-gap-test.mjs, headed)
 *   Stage 7  Regression checklist cross-reference + cleanup
 *
 * Usage:
 *   node --env-file=.env.local tests/phase1-retest.mjs              # all stages, no real sends
 *   node --env-file=.env.local tests/phase1-retest.mjs --live       # + live WhatsApp stage
 *   node --env-file=.env.local tests/phase1-retest.mjs --ui-only    # headed UI stage only
 *   node --env-file=.env.local tests/phase1-retest.mjs --gap-only   # preflight + gap tests only
 *   node --env-file=.env.local tests/phase1-retest.mjs --skip 3,4   # skip stages
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

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

const BASE_URL = process.env.TEST_TARGET || "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_SECRET = process.env.APP_SECRET;
const TEST_PHONE = "27832763116";
const LEAD_ID = 816;
const FIBRE_CAMPAIGN = "febe1cac-cf87-46c3-bbc7-160d3b96e28e";

const args = process.argv.slice(2);
const LIVE = args.includes("--live");
const UI_ONLY = args.includes("--ui-only");
const GAP_ONLY = args.includes("--gap-only");
const skipIdx = args.indexOf("--skip");
const SKIP = new Set(skipIdx !== -1 && args[skipIdx + 1] ? args[skipIdx + 1].split(",").map(Number) : []);

// ─── Helpers ────────────────────────────────────────────────────────────────
const results = { stages: [], startedAt: new Date().toISOString() };

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

function runSuite(name, script, env = {}, extraArgs = []) {
  console.log(`\n${"▶".repeat(3)} Running: ${name}`);
  console.log("-".repeat(64));
  const t0 = Date.now();
  const r = spawnSync("node", ["--env-file=.env.local", script, ...extraArgs], {
    stdio: "inherit",
    env: { ...process.env, ...env },
    cwd: process.cwd(),
  });
  const durationMs = Date.now() - t0;
  return { name, script, exitCode: r.status ?? -1, durationMs };
}

// Normalize each suite's results file into {total, passed, failed, failures[]}
function parseReport(file, arrayKeys = ["results", "tests", "scenarios"]) {
  try {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    const sum = d.summary ?? d;
    let total = sum.total ?? sum.passed + sum.failed ?? 0;
    let passed = sum.passed ?? 0;
    let failed = sum.failed ?? 0;
    let failures = [];
    for (const key of arrayKeys) {
      if (Array.isArray(d[key])) {
        failures = d[key]
          .filter((t) => t.status === "FAIL" || t.passed === false)
          .map((t) => t.id ?? t.test ?? t.desc ?? "unknown");
        if (!total) total = d[key].length;
        if (!passed && !failed) {
          passed = d[key].filter((t) => t.status === "PASS" || t.passed === true).length;
          failed = d[key].filter((t) => t.status === "FAIL" || t.passed === false).length;
        }
        break;
      }
    }
    return { total, passed, failed, failures, warnings: sum.warnings ?? 0 };
  } catch (e) {
    return { total: 0, passed: 0, failed: 0, failures: [`report unreadable: ${e.message}`], warnings: 0 };
  }
}

// ─── Stage 0: Pre-flight ────────────────────────────────────────────────────
async function preflight() {
  console.log("=".repeat(64));
  console.log("STAGE 0 — PRE-FLIGHT CHECKS");
  console.log("=".repeat(64));
  const checks = [];
  const ok = (name, detail = "") => { checks.push({ name, status: "PASS", detail }); console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`); };
  const bad = (name, detail = "") => { checks.push({ name, status: "FAIL", detail }); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); };

  // Env vars
  const envVars = [
    "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "META_PHONE_NUMBER_ID", "META_ACCESS_TOKEN", "META_WABA_ID", "OPENROUTER_API_KEY", "APP_SECRET",
  ];
  for (const v of envVars) {
    if (process.env[v]) ok(`env ${v}`); else bad(`env ${v}`, "missing");
  }

  // Dev server
  try {
    const r = await fetch(`${BASE_URL}/login`, { signal: AbortSignal.timeout(8000) });
    if (r.status === 200) ok("dev server /login → 200"); else bad("dev server /login", `status=${r.status}`);
  } catch (e) { bad("dev server /login", e.message); }

  // Supabase connectivity
  try {
    const r = await sb("/leads?select=id&limit=1");
    if (r.ok) ok("Supabase service client"); else bad("Supabase service client", `status=${r.status}`);
  } catch (e) { bad("Supabase service client", e.message); }

  // Phase 1 tables
  const tables = [
    "campaigns", "campaign_steps", "campaign_enrolments", "campaign_interactions",
    "campaign_classifications", "campaign_audit_log", "calling_queue", "opt_out_list",
    "message_delivery_failures", "campaign_errors",
  ];
  for (const t of tables) {
    try {
      const r = await sb(`/${t}?select=*&limit=1`);
      if (r.ok) ok(`table ${t}`); else bad(`table ${t}`, `status=${r.status}`);
    } catch (e) { bad(`table ${t}`, e.message); }
  }

  // Lead columns
  try {
    const r = await sb("/leads?select=preferred_contact_number,last_campaign_response,rejection_reason,product_interest,household_size,internet_usage,needs_escalation&limit=1");
    if (r.ok) ok("lead extended columns"); else bad("lead extended columns", `status=${r.status}`);
  } catch (e) { bad("lead extended columns", e.message); }

  // nurture_flag lives on campaign_enrolments, not leads
  try {
    const r = await sb("/campaign_enrolments?select=nurture_flag&limit=1");
    if (r.ok) ok("campaign_enrolments.nurture_flag"); else bad("campaign_enrolments.nurture_flag", `status=${r.status}`);
  } catch (e) { bad("campaign_enrolments.nurture_flag", e.message); }

  // campaign_steps.template_parameters
  try {
    const r = await sb("/campaign_steps?select=template_parameters&limit=1");
    if (r.ok) ok("campaign_steps.template_parameters"); else bad("campaign_steps.template_parameters", `status=${r.status}`);
  } catch (e) { bad("campaign_steps.template_parameters", e.message); }

  // Meta API reachable
  try {
    const r = await fetch(
      `https://graph.facebook.com/${process.env.META_API_VERSION ?? "v21.0"}/${process.env.META_WABA_ID}/message_templates?limit=1`,
      { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(10000) }
    );
    if (r.ok) ok("Meta API reachable (templates list)"); else bad("Meta API reachable", `status=${r.status}`);
  } catch (e) { bad("Meta API reachable", e.message); }

  // n8n webhook reachable
  try {
    const r = await fetch("https://n8n.horizonafrica.co.za/webhook/whatsapp-webhook", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ping: true }), signal: AbortSignal.timeout(10000),
    });
    ok("n8n inbound webhook reachable", `status=${r.status}`);
  } catch (e) { bad("n8n inbound webhook reachable", e.message); }

  // Test user can log in (Supabase Auth)
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@horizonafrica.co.za", password: "TestPass123!" }),
    });
    if (r.ok) ok("test user auth (test@horizonafrica.co.za)");
    else bad("test user auth", `status=${r.status}`);
  } catch (e) { bad("test user auth", e.message); }

  const failed = checks.filter((c) => c.status === "FAIL");
  results.stages.push({ stage: 0, name: "Pre-flight", total: checks.length, passed: checks.length - failed.length, failed: failed.length, failures: failed.map((f) => f.name) });
  console.log(`\nPre-flight: ${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length > 0) {
    console.log("⚠️  Pre-flight failures — dependent stages may fail:");
    failed.forEach((f) => console.log(`   - ${f.name}: ${f.detail}`));
  }
  return failed.length === 0;
}

// ─── Stage 5: Live WhatsApp (opt-in) ───────────────────────────────────────
async function liveStage() {
  console.log("=".repeat(64));
  console.log("STAGE 5 — LIVE WHATSAPP (rate-limit aware)");
  console.log("=".repeat(64));
  const checks = [];
  const ok = (id, name, detail = "") => { checks.push({ id, status: "PASS", detail }); console.log(`  ✅ ${id} ${name}${detail ? ` — ${detail}` : ""}`); };
  const bad = (id, name, detail = "") => { checks.push({ id, status: "FAIL", detail }); console.log(`  ❌ ${id} ${name}${detail ? ` — ${detail}` : ""}`); };
  const wrn = (id, name, detail = "") => { checks.push({ id, status: "WARN", detail }); console.log(`  ⚠️  ${id} ${name}${detail ? ` — ${detail}` : ""}`); };

  let enrolId = null;
  try {
    // Enrol test phone into the Fibre campaign
    const enr = await sb(`/campaign_enrolments`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        campaign_id: FIBRE_CAMPAIGN, phone_number: TEST_PHONE, lead_id: LEAD_ID,
        current_step: 0, status: "active", nurture_flag: false,
      }),
    });
    const enrBody = await enr.json().catch(() => null);
    enrolId = enrBody?.[0]?.id;
    if (!enrolId) throw new Error(`enrol insert failed: ${JSON.stringify(enrBody).slice(0, 200)}`);

    // Activate campaign
    await sb(`/campaigns?id=eq.${FIBRE_CAMPAIGN}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) });

    // L1: trigger process endpoint → Meta accepts Step 1
    const proc = await fetch(`${BASE_URL}/api/campaigns/process`, {
      method: "POST",
      headers: { Authorization: `Bearer ${APP_SECRET}`, "Content-Type": "application/json" },
      body: "{}",
    });
    const procBody = await proc.json().catch(() => ({}));
    const inter = await sb(`/campaign_interactions?enrol_id=eq.${enrolId}&message_type=eq.outbound&order=created_at.desc&limit=1&select=*`);
    const interBody = await inter.json().catch(() => []);
    const msg = interBody?.[0];
    if (proc.ok && msg?.meta_message_id) {
      ok("L1", "Step 1 telkom_fibre_packages sent via Meta", `wamid=${msg.meta_message_id.slice(0, 30)}…`);
    } else if (proc.ok && msg) {
      wrn("L1", "Step 1 processed but no meta_message_id", `delivery_status=${msg.delivery_status}`);
    } else {
      bad("L1", "Step 1 telkom_fibre_packages sent via Meta", `proc=${proc.status} ${JSON.stringify(procBody).slice(0, 150)}`);
    }

    // L2: no delivery failure recorded for the message
    if (msg?.meta_message_id) {
      await new Promise((r) => setTimeout(r, 8000));
      const f = await sb(`/message_delivery_failures?message_id=eq.${encodeURIComponent(msg.meta_message_id)}&select=id`);
      const fb = await f.json().catch(() => []);
      if ((fb ?? []).length === 0) ok("L2", "No delivery-failure callback for the sent message");
      else bad("L2", "No delivery-failure callback for the sent message", "failure row found — message was dropped by Meta");
    }

    // L3: poll 120s for the user's reply → detection → classification
    console.log("  ⏳ Waiting up to 120s for a WhatsApp reply from the test phone…");
    const deadline = Date.now() + 120000;
    let enrolState = null;
    while (Date.now() < deadline) {
      const r = await sb(`/campaign_enrolments?id=eq.${enrolId}&select=status,current_step`);
      const b = await r.json().catch(() => []);
      enrolState = b?.[0];
      if (enrolState && !["active", "no_response_final"].includes(enrolState.status)) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (enrolState && !["active", "no_response_final"].includes(enrolState.status)) {
      ok("L3", `Reply detected → enrolment status=${enrolState.status}`);
      const cls = await sb(`/campaign_classifications?enrol_id=eq.${enrolId}&order=created_at.desc&limit=1&select=*`);
      const clsBody = await cls.json().catch(() => []);
      if (clsBody?.[0]) ok("L4", `Classification recorded: ${clsBody[0].classification} (conf ${clsBody[0].confidence})`);
      else wrn("L4", "Classification recorded", "no classification row found yet");
      const audit = await sb(`/campaign_audit_log?entity_id=eq.${enrolId}&select=id&limit=1`);
      const auditBody = await audit.json().catch(() => []);
      if ((auditBody ?? []).length > 0) ok("L4b", "Audit trail entry logged for status change");
      else wrn("L4b", "Audit trail entry logged", "none found");
    } else {
      wrn("L3", "Reply detected", "no reply within 120s — reply on WhatsApp to complete this check");
    }
  } catch (e) {
    bad("L1", "Live stage", e.message);
  } finally {
    // Cleanup: remove test enrolment + pause campaign
    if (enrolId) {
      await sb(`/campaign_interactions?enrol_id=eq.${enrolId}`, { method: "DELETE" });
      await sb(`/campaign_classifications?enrol_id=eq.${enrolId}`, { method: "DELETE" });
      await sb(`/calling_queue?enrolment_id=eq.${enrolId}`, { method: "DELETE" });
      await sb(`/campaign_audit_log?entity_id=eq.${enrolId}`, { method: "DELETE" });
      await sb(`/campaign_enrolments?id=eq.${enrolId}`, { method: "DELETE" });
    }
    await sb(`/campaigns?id=eq.${FIBRE_CAMPAIGN}`, { method: "PATCH", body: JSON.stringify({ status: "paused" }) });
    console.log("  Cleanup done — campaign paused");
  }

  const failedN = checks.filter((c) => c.status === "FAIL").length;
  results.stages.push({ stage: 5, name: "Live WhatsApp", total: checks.length, passed: checks.filter((c) => c.status === "PASS").length, failed: failedN, failures: checks.filter((c) => c.status === "FAIL").map((f) => `${f.id} ${f.name}`) });
}

// ─── Stage 7: Regression cross-reference ────────────────────────────────────
function regressionCheck() {
  console.log("=".repeat(64));
  console.log("STAGE 7 — REGRESSION CHECKLIST");
  console.log("=".repeat(64));
  const checks = [];

  // Cross-reference specific test IDs in the per-suite reports
  const expect = [
    { report: "tests/campaign-response-results.json", ids: ["A7", "A8", "A10", "F3"], label: "classification fixes (contact-me, call-me, needs_info ordering, late response)" },
    { report: "tests/advanced-simulation-results.json", ids: [], label: "responded→completed, STOP-all-enrolments, 0-prefix normalization" },
    { report: "tests/phase1-gap-results.json", ids: ["G1", "G11", "G18", "G19", "G23", "G25", "G26"], label: "delivery failures, normalization, dedup, n8n persistence" },
  ];
  for (const e of expect) {
    if (!fs.existsSync(e.report)) {
      checks.push({ name: `regression: ${e.label}`, status: "SKIP", detail: "report missing" });
      console.log(`  ⏭️  ${e.label} — report missing, skipped`);
      continue;
    }
    const d = JSON.parse(fs.readFileSync(e.report, "utf8"));
    const items = d.tests ?? d.results ?? d.scenarios ?? [];
    const failedItems = items.filter((t) => t.status === "FAIL" || t.passed === false);
    const relevant = e.ids.length
      ? failedItems.filter((t) => e.ids.includes(t.id))
      : failedItems;
    if (relevant.length === 0) {
      checks.push({ name: `regression: ${e.label}`, status: "PASS" });
      console.log(`  ✅ ${e.label}`);
    } else {
      checks.push({ name: `regression: ${e.label}`, status: "FAIL", detail: relevant.map((t) => t.id ?? t.test).join(", ") });
      console.log(`  ❌ ${e.label} — regressed: ${relevant.map((t) => t.id ?? t.test).join(", ")}`);
    }
  }
  const failedN = checks.filter((c) => c.status === "FAIL").length;
  results.stages.push({ stage: 7, name: "Regression checklist", total: checks.length, passed: checks.length - failedN, failed: failedN, failures: checks.filter((c) => c.status === "FAIL").map((f) => f.name) });
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔" + "═".repeat(62) + "╗");
  console.log("║  PHASE 1 FULL SYSTEM RETEST" + " ".repeat(35) + "║");
  console.log(`║  Target: ${BASE_URL}` + " ".repeat(Math.max(0, 52 - BASE_URL.length)) + "║");
  console.log(`║  Live sends: ${LIVE ? "ENABLED" : "disabled (use --live)"}` + " ".repeat(LIVE ? 35 : 21) + "║");
  console.log("╚" + "═".repeat(62) + "╝");

  const preflightOk = await preflight();

  const suites = [];
  const should = (n) => !SKIP.has(n);

  if (UI_ONLY || GAP_ONLY) {
    // selective modes
    if (UI_ONLY) {
      suites.push({ stage: 1, name: "UI — dashboard suite (headed)", script: "tests/ui-dashboard-test.mjs", env: { HEADED: "1" }, report: "tests/ui-dashboard-results.json" });
      suites.push({ stage: 1, name: "UI — campaign engine suite (headed)", script: "tests/campaign-engine-test.mjs", env: {}, report: "tests/test-results.json" });
      suites.push({ stage: 1, name: "UI — gap tests (headed)", script: "tests/phase1-gap-test.mjs", env: {}, args: ["--ui-only"], report: "tests/phase1-gap-results.json" });
    }
    if (GAP_ONLY) {
      suites.push({ stage: 6, name: "Gap tests", script: "tests/phase1-gap-test.mjs", env: {}, args: [], report: "tests/phase1-gap-results.json" });
    }
  } else {
    if (should(1)) {
      suites.push({ stage: 1, name: "UI — dashboard suite (headed)", script: "tests/ui-dashboard-test.mjs", env: { HEADED: "1" }, report: "tests/ui-dashboard-results.json" });
      suites.push({ stage: 1, name: "UI — campaign engine suite (headed)", script: "tests/campaign-engine-test.mjs", env: {}, report: "tests/test-results.json" });
    }
    if (should(2)) {
      suites.push({ stage: 2, name: "Campaign response classification", script: "tests/campaign-response-test.mjs", env: {}, report: "tests/campaign-response-results.json" });
      suites.push({ stage: 2, name: "Client simulation", script: "tests/client-simulation-test.mjs", env: {}, report: "tests/client-simulation-results.json" });
      suites.push({ stage: 2, name: "Advanced simulation", script: "tests/advanced-simulation-test.mjs", env: {}, report: "tests/advanced-simulation-results.json" });
    }
    if (should(3)) {
      suites.push({ stage: 3, name: "Comprehensive (UI+security+logic)", script: "tests/comprehensive-test.mjs", env: {}, report: "tests/comprehensive-test-results.json" });
      suites.push({ stage: 3, name: "Chaos / destructive", script: "tests/chaos-test.mjs", env: {}, report: "tests/chaos-test-results.json" });
    }
    if (should(4)) {
      suites.push({ stage: 4, name: "AI conversation quality", script: "tests/ai-conversation-test.mjs", env: {}, report: "tests/ai-conversation-results.json" });
      suites.push({ stage: 4, name: "Workflow e2e", script: "tests/workflow-e2e-test.mjs", env: {}, report: "tests/workflow-e2e-results.json" });
    }
    if (should(6)) {
      suites.push({ stage: 6, name: "Gap tests (headed)", script: "tests/phase1-gap-test.mjs", env: {}, args: [], report: "tests/phase1-gap-results.json" });
    }
  }

  for (const s of suites) {
    const run = runSuite(s.name, s.script, s.env, s.args ?? []);
    const rep = parseReport(s.report);
    results.stages.push({ stage: s.stage, name: s.name, script: s.script, ...rep, exitCode: run.exitCode, durationMs: run.durationMs });
  }

  if (LIVE && !UI_ONLY && !GAP_ONLY && should(5)) {
    await liveStage();
  }

  if (!UI_ONLY && !GAP_ONLY && should(7)) {
    regressionCheck();
  }

  // ── Aggregated report ──
  const totalPass = results.stages.reduce((a, s) => a + (s.passed ?? 0), 0);
  const totalFail = results.stages.reduce((a, s) => a + (s.failed ?? 0), 0);
  const totalTests = results.stages.reduce((a, s) => a + (s.total ?? 0), 0);

  console.log("\n" + "═".repeat(64));
  console.log("AGGREGATED RESULTS");
  console.log("═".repeat(64));
  console.log(`${"Stage".padEnd(6)}${"Suite".padEnd(42)}${"Pass".padEnd(7)}${"Fail".padEnd(6)}Total`);
  for (const s of results.stages) {
    console.log(`${String(s.stage).padEnd(6)}${s.name.slice(0, 40).padEnd(42)}${String(s.passed ?? "-").padEnd(7)}${String(s.failed ?? "-").padEnd(6)}${s.total ?? "-"}`);
  }
  console.log("-".repeat(64));
  console.log(`TOTAL: ${totalPass} passed, ${totalFail} failed, ${totalTests} tests`);

  const allFailures = results.stages.flatMap((s) => (s.failures ?? []).map((f) => `[${s.name}] ${f}`));
  if (allFailures.length > 0) {
    console.log("\nALL FAILURES:");
    allFailures.forEach((f) => console.log(`  ❌ ${f}`));
  }

  results.finishedAt = new Date().toISOString();
  results.totals = { total: totalTests, passed: totalPass, failed: totalFail };
  fs.writeFileSync("tests/phase1-retest-results.json", JSON.stringify(results, null, 2));
  console.log(`\nReport: tests/phase1-retest-results.json`);

  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
