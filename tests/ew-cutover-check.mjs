#!/usr/bin/env node
/**
 * Eastern Wear — M8 Cutover Readiness Dry-Run (full-suite-test-plan.md Suite I)
 *
 * Readiness checks that run BEFORE cutover, without changing anything:
 *   I1 env audit vs runbook requirements
 *   I2 template wiring — code has zero telkom_/horizon_ refs in active paths
 *   I3 rollback artifacts present (telecom workflow exports)
 *   I4 WABA template statuses via Meta API (all ew_* APPROVED)
 *   I5 Shopify oversell check on one-of variants
 *   I6 backup artifacts integrity
 *   I7 business-rules TODO scan + n8n export redaction
 *   I8 workflow inventory notes (manual confirmation prompts)
 *
 * Usage: node --env-file=.env.local tests/ew-cutover-check.mjs
 * Purely read-only. No sends, no writes.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));

const ROOT = process.cwd();
const RESULTS_FILE = path.join(ROOT, "tests", "ew-cutover-results.json");
const results = [];
function record(status, name, detail = "") {
  results.push({ name, status, detail });
  const icon = { PASS: "✅", FAIL: "❌", WARN: "⚠️ ", INFO: "ℹ️ " }[status];
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}
const pass = (n, d) => record("PASS", n, d);
const fail = (n, d) => record("FAIL", n, d);
const warn = (n, d) => record("WARN", n, d);
const info = (n, d) => record("INFO", n, d);

// ── I1: env audit ────────────────────────────────────────────────────────────
console.log("\n— I1. Environment audit —");
const envReqs = [
  ["NEXT_PUBLIC_SUPABASE_URL", v => v?.includes("supabase")],
  ["SUPABASE_SERVICE_ROLE_KEY", v => v?.length > 20],
  ["APP_SECRET", v => v?.length >= 16],
  ["META_ACCESS_TOKEN", v => v?.length > 20],
  ["META_WABA_ID", v => /^\d{10,}$/.test(v || "")],
  ["META_PHONE_NUMBER_ID", v => /^\d{10,}$/.test(v || "")],
  ["META_APP_SECRET", v => v?.length > 8],
  ["META_VERIFY_TOKEN", v => v?.length > 4],
  ["N8N_WEBHOOK_URL", v => v?.startsWith("https://")],
  ["OPENROUTER_API_KEY", v => v?.startsWith("sk-or-")],
  ["SHOPIFY_STORE_DOMAIN", v => v?.includes("myshopify")],
  ["SHOPIFY_CLIENT_ID", v => !!v],
  ["SHOPIFY_CLIENT_SECRET", v => !!v],
];
for (const [key, check] of envReqs) {
  const v = process.env[key];
  if (!v) fail(`env ${key}`, "missing");
  else if (check && !check(v)) warn(`env ${key}`, "present but unusual format");
  else pass(`env ${key}`, "present");
}
{
  const v = process.env.ORDER_FOLLOWUP_TEMPLATES;
  if (!v) warn("env ORDER_FOLLOWUP_TEMPLATES", "not set — verify code default does not silently use horizon_*");
  else if (/horizon_|telkom_/.test(v)) fail("env ORDER_FOLLOWUP_TEMPLATES", `telecom template: ${v}`);
  else pass("env ORDER_FOLLOWUP_TEMPLATES", v);
}

// ── I2: template wiring / telecom residue in active code ────────────────────
console.log("\n— I2. Telecom residue scan (app/, lib/, components/) —");
try {
  const out = execSync(
    `grep -rniE "telkom_|horizon_|fibre|mbps" app lib components middleware.ts 2>/dev/null | grep -v "\\.test\\." || true`,
    { cwd: ROOT, encoding: "utf8" }
  ).trim();
  if (!out) pass("zero telecom refs in app/lib/components");
  else {
    const lines = out.split("\n");
    // horizon-africa.co.za infra hostnames are factual, not copy
    const real = lines.filter((l) => !/n8n\.horizonafrica|dashboard\.horizonafrica|test@horizonafrica/.test(l));
    if (!real.length) pass("zero telecom refs (infra hostnames only)", `${lines.length} benign`);
    else {
      warn("telecom residue found", `${real.length} lines — review`);
      real.slice(0, 10).forEach((l) => console.log(`      ${l.slice(0, 140)}`));
    }
  }
} catch (e) { warn("residue scan", e.message); }
try {
  const ewRefs = execSync(`grep -rn "ew_" lib app | grep -iE "template|ew_order|ew_payment|ew_followup|ew_campaign|ew_reengagement|ew_collection|ew_imported" | wc -l`, { cwd: ROOT, encoding: "utf8" }).trim();
  if (parseInt(ewRefs) > 0) pass("ew_* template names referenced in code", `${ewRefs} refs`);
  else warn("ew_* template names", "none found in code — templates may be env/n8n-configured only");
} catch {}

// ── I3: rollback artifacts ──────────────────────────────────────────────────
console.log("\n— I3. Rollback artifacts —");
const wfDir = path.join(ROOT, "n8n", "workflows");
const expectedExports = [
  "inbound-ai-lead-qualification-pre-repurpose.json",
  "eastern-wear-layla-inbound.json",
  "eastern-wear-follow-up-sender.json",
  "chatwoot-handover-sync.json",
];
for (const f of expectedExports) {
  const p = path.join(wfDir, f);
  if (fs.existsSync(p)) pass(`workflow export ${f}`, `${(fs.statSync(p).size / 1024).toFixed(0)}KB`);
  else fail(`workflow export ${f}`, "missing");
}
// redaction check across exports
try {
  const files = fs.readdirSync(wfDir).filter((f) => f.endsWith(".json"));
  let leaky = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(wfDir, f), "utf8");
    if (/eyJhbGciOi|shpat_|sk-or-|Bearer [A-Za-z0-9_-]{30,}/.test(text)) leaky.push(f);
  }
  if (!leaky.length) pass("workflow exports redacted", `${files.length} files`);
  else fail("workflow exports redacted", `possible secrets in: ${leaky.join(", ")}`);
} catch { warn("workflow export redaction", "n8n/workflows missing"); }

// ── I4: Meta WABA template statuses ─────────────────────────────────────────
console.log("\n— I4. Meta template status —");
const EW_TEMPLATES = [
  "ew_order_confirmation", "ew_payment_reminder_1", "ew_payment_reminder_2",
  "ew_payment_reminder_3", "ew_collection_reminder", "ew_imported_order_update",
  "ew_campaign_intro", "ew_reengagement", "ew_followup_nudge", "ew_imported_terms",
];
(async () => {
try {
  const waba = process.env.META_WABA_ID;
  const token = process.env.META_ACCESS_TOKEN;
  if (!waba || !token) { warn("Meta template check", "META_WABA_ID/META_ACCESS_TOKEN missing"); }
  else {
    const res = await fetch(`https://graph.facebook.com/v21.0/${waba}/message_templates?fields=name,status,category&limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) fail("Meta template API", `HTTP ${res.status} — ${data?.error?.message || ""}`);
    else {
      const byName = Object.fromEntries((data.data || []).map((t) => [t.name, t]));
      for (const name of EW_TEMPLATES) {
        const t = byName[name];
        if (!t) fail(`template ${name}`, "not found in WABA");
        else if (t.status === "APPROVED") pass(`template ${name}`, `APPROVED ${t.category}`);
        else fail(`template ${name}`, `status ${t.status}`);
      }
      const telecomLive = (data.data || []).filter((t) => /^(telkom_|horizon_)/.test(t.name) && t.status === "APPROVED");
      info("telecom templates still in WABA", `${telecomLive.length} approved (retire at cutover)`);
    }
  }
} catch (e) { fail("Meta template check", e.message); }

// ── I5: Shopify oversell + connectivity ─────────────────────────────────────
console.log("\n— I5. Shopify checks —");
try {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const ver = process.env.SHOPIFY_API_VERSION || "2025-01";
  let token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!token && process.env.SHOPIFY_CLIENT_ID) {
    const r = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET, grant_type: "client_credentials" }),
    });
    if (r.ok) token = (await r.json()).access_token;
  }
  if (!token) warn("Shopify", "no admin token — skipped");
  else {
    const res = await fetch(`https://${domain}/admin/api/${ver}/variants.json?limit=250&fields=id,inventory_policy,inventory_quantity`, {
      headers: { "X-Shopify-Access-Token": token },
    });
    const data = await res.json();
    if (!res.ok) fail("Shopify variants API", `HTTP ${res.status}`);
    else {
      const variants = data.variants || [];
      const allowsOversell = variants.filter((v) => v.inventory_policy === "continue");
      const oneOfOversell = variants.filter((v) => v.inventory_policy === "continue" && v.inventory_quantity === 1);
      pass("Shopify connectivity", `${variants.length} variants sampled`);
      if (oneOfOversell.length) warn("oversell risk", `${oneOfOversell.length} one-of variants allow overselling (inventory_policy=continue)`);
      else pass("oversell policy", "no one-of variants allow overselling");
      info("oversell stats", `${allowsOversell.length}/${variants.length} variants allow oversell`);
    }
  }
} catch (e) { fail("Shopify checks", e.message); }

// ── I6: backup artifacts ─────────────────────────────────────────────────────
console.log("\n— I6. Backup artifacts —");
const backupsDir = path.join(ROOT, "backups");
if (!fs.existsSync(backupsDir)) fail("backups dir", "missing");
else {
  const files = fs.readdirSync(backupsDir);
  const zip = files.find((f) => f.includes("horizon-africa-data-export") && f.endsWith(".zip"));
  if (zip) {
    const sz = fs.statSync(path.join(backupsDir, zip)).size;
    if (sz > 100_000) pass("Horizon data export zip", `${zip} (${(sz / 1024).toFixed(0)}KB) — still needs WeTransfer to client`);
    else fail("Horizon data export zip", `suspiciously small (${sz}B)`);
  } else fail("Horizon data export zip", "not found");
  const dirs = files.filter((f) => fs.statSync(path.join(backupsDir, f)).isDirectory());
  info("backup dirs present", dirs.slice(0, 5).join(", ") || "none");
}

// ── I7: business rules + prompts ────────────────────────────────────────────
console.log("\n— I7. Knowledge base files —");
for (const f of ["business-rules.md", "layla-system-prompt.md", "inbound-categories.md", "website-context.md"]) {
  const p = path.join(ROOT, "n8n", "prompts", f);
  if (!fs.existsSync(p)) fail(`prompt ${f}`, "missing");
  else {
    const text = fs.readFileSync(p, "utf8");
    const todos = (text.match(/TODO/g) || []).length;
    if (todos) fail(`prompt ${f}`, `${todos} TODO placeholders`);
    else pass(`prompt ${f}`, "no TODOs");
  }
}
// status report date sanity
const sr = path.join(ROOT, "repurpose", "eastern-wear-status-report.md");
if (fs.existsSync(sr)) pass("status report", "present");
else warn("status report", "missing");

// ── I8: manual confirmations ────────────────────────────────────────────────
console.log("\n— I8. Manual confirmations required —");
info("n8n inventory", "confirm in n8n UI: EW inbound + EW follow-up INACTIVE; telecom inbound ACTIVE (rollback)");
info("Chatwoot webhook", "confirm Chatwoot → handover-sync webhook subscription configured");
info("number cutover", "joint session only — see docs/eastern-wear-m8-cutover-runbook.md");
info("OpenRouter credits", "AI paths untestable until topped up");
info("Chatwoot token rotation", "required before pushing branch (token in local git history)");

const summary = {
  total: results.length,
  pass: results.filter((r) => r.status === "PASS").length,
  fail: results.filter((r) => r.status === "FAIL").length,
  warn: results.filter((r) => r.status === "WARN").length,
  info: results.filter((r) => r.status === "INFO").length,
  ran_at: new Date().toISOString(),
};
fs.writeFileSync(RESULTS_FILE, JSON.stringify({ summary, results }, null, 2));
console.log(`\n=== ${summary.pass} PASS / ${summary.fail} FAIL / ${summary.warn} WARN / ${summary.info} INFO ===`);
console.log(`Results → ${RESULTS_FILE}`);
process.exit(summary.fail ? 1 : 0);
})();
