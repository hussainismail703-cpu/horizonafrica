#!/usr/bin/env node
/**
 * Campaign Response Testing Script — Fully Automated
 * Tests all response classifications against the Fibre Lead Re-Engagement campaign
 * on PRODUCTION (dashboard.horizonafrica.co.za)
 *
 * Uses only: phone 27832763116, lead_id 816 (Hussain Ismail)
 *
 * Usage: node --env-file=.env.local tests/campaign-response-test.mjs
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRODUCTION_URL = "https://dashboard.horizonafrica.co.za";
const TEST_PHONE = "27832763116";
const LEAD_ID = 816;
const CAMPAIGN_ID = "febe1cac-cf87-46c3-bbc7-160d3b96e28e";

// We'll create a fresh enrolment for each test to avoid state issues
async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
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

// Reset all test data and create fresh active enrolment
async function resetAndCreateEnrolment() {
  // Delete all test data
  await supabaseFetch(`/campaign_classifications?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await supabaseFetch(`/calling_queue?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await supabaseFetch(`/opt_out_list?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await supabaseFetch(`/campaign_interactions?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await supabaseFetch(`/campaign_enrolments?phone_number=eq.${TEST_PHONE}&campaign_id=eq.${CAMPAIGN_ID}`, { method: "DELETE" });

  // Reset lead
  await supabaseFetch(`/leads?id=eq.${LEAD_ID}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "new", rejection_reason: null, notes: null }),
  });

  // Create fresh enrolment
  const res = await supabaseFetch(`/campaign_enrolments`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      campaign_id: CAMPAIGN_ID,
      phone_number: TEST_PHONE,
      lead_id: LEAD_ID,
      current_step: 1,
      status: "active",
      enrolled_at: new Date().toISOString(),
    }),
  });
  const data = await res.json();
  return data[0]?.id;
}

// Read current DB state
async function readState(enrolmentId) {
  // Enrolment
  const enrolRes = await supabaseFetch(`/campaign_enrolments?id=eq.${enrolmentId}&select=status,final_outcome`);
  const enrolment = (await enrolRes.json())[0];

  // Classification
  const classRes = await supabaseFetch(`/campaign_classifications?phone_number=eq.${TEST_PHONE}&order=created_at.desc&limit=1&select=classification,rejection_reason,confidence,classified_by`);
  const classification = (await classRes.json())[0];

  // Calling queue
  const queueRes = await supabaseFetch(`/calling_queue?phone_number=eq.${TEST_PHONE}&order=created_at.desc&limit=1&select=queue_status,campaign_stage,customer_request`);
  const queue = (await queueRes.json())[0];

  // Lead
  const leadRes = await supabaseFetch(`/leads?id=eq.${LEAD_ID}&select=status,rejection_reason`);
  const lead = (await leadRes.json())[0];

  // Opt-out
  const optRes = await supabaseFetch(`/opt_out_list?phone_number=eq.${TEST_PHONE}&select=id,reason`);
  const optOut = (await optRes.json())[0];

  // Inbound interaction
  const intRes = await supabaseFetch(`/campaign_interactions?enrol_id=eq.${enrolmentId}&message_type=eq.inbound&order=created_at.desc&limit=1&select=message_body,message_type`);
  const interaction = (await intRes.json())[0];

  return { enrolment, classification, queue, lead, optOut, interaction };
}

// Send webhook to production
async function sendWebhook(payload) {
  const res = await fetch(`${PRODUCTION_URL}/api/whatsapp-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, response: text };
}

// Build Meta webhook payloads
function webhook(text) {
  return { entry: [{ changes: [{ value: { messages: [{ from: TEST_PHONE, text: { body: text } }] } }] }] };
}
function buttonWebhook(text) {
  const msg = { from: TEST_PHONE, button: { text: text } };
  return { entry: [{ changes: [{ value: { messages: [msg] } }] }] };
}
function interactiveWebhook(title) {
  const msg = { from: TEST_PHONE, interactive: { button_reply: { title: title } } };
  return { entry: [{ changes: [{ value: { messages: [msg] } }] }] };
}

// Test definitions
const tests = [
  // Group A — Step 1 Response Classifications
  { id: "A1", desc: "FIBRE", input: "FIBRE", payload: webhook("FIBRE"), expect: { class: "interested", enrol: "interested", queue: true, lead: "qualified" } },
  { id: "A2", desc: "Yes", input: "Yes", payload: webhook("Yes"), expect: { class: "interested", enrol: "interested", queue: true, lead: "qualified" } },
  { id: "A3", desc: "I'm interested", input: "I'm interested", payload: webhook("I'm interested"), expect: { class: "interested", enrol: "interested", queue: true, lead: "qualified" } },
  { id: "A4", desc: "I want fibre", input: "I want fibre", payload: webhook("I want fibre"), expect: { class: "interested", enrol: "interested", queue: true, lead: "qualified" } },
  { id: "A5", desc: "How do I apply?", input: "How do I apply?", payload: webhook("How do I apply?"), expect: { class: "interested", enrol: "interested", queue: true, lead: "qualified" } },
  { id: "A6", desc: "I would like the R425 package", input: "I would like the R425 package", payload: webhook("I would like the R425 package"), expect: { class: "interested", enrol: "interested", queue: true, lead: "qualified" } },
  { id: "A7", desc: "Can someone contact me?", input: "Can someone contact me?", payload: webhook("Can someone contact me?"), expect: { class: "interested", enrol: "interested", queue: true, lead: "qualified" } },
  { id: "A8", desc: "Please call me", input: "Please call me", payload: webhook("Please call me"), expect: { class: "interested", enrol: "interested", queue: true, lead: "qualified" } },
  { id: "A9", desc: "I want the 50 Mbps package, please contact me", input: "I want the 50 Mbps package, please contact me", payload: webhook("I want the 50 Mbps package, please contact me"), expect: { class: "interested", enrol: "interested", queue: true, lead: "qualified" } },
  { id: "A10", desc: "How much is the 50 Mbps package?", input: "How much is the 50 Mbps package?", payload: webhook("How much is the 50 Mbps package?"), expect: { class: "needs_information", enrol: "responded", queue: false, lead: "new" } },
  { id: "A11", desc: "What packages are available?", input: "What packages are available?", payload: webhook("What packages are available?"), expect: { class: "needs_information", enrol: "responded", queue: false, lead: "new" } },
  { id: "A12", desc: "Is fibre available in my area?", input: "Is fibre available in my area?", payload: webhook("Is fibre available in my area?"), expect: { class: "needs_information", enrol: "responded", queue: false, lead: "new" } },
  { id: "A13", desc: "Not interested", input: "Not interested", payload: webhook("Not interested"), expect: { class: "not_interested", enrol: "not_interested", queue: false, lead: "lost" } },
  { id: "A14", desc: "Not interested, the price is too high", input: "Not interested, the price is too high", payload: webhook("Not interested, the price is too high"), expect: { class: "not_interested", rejReason: "price", enrol: "not_interested", queue: false, lead: "lost" } },
  { id: "A15", desc: "Too expensive", input: "Too expensive", payload: webhook("Too expensive"), expect: { class: "not_interested", rejReason: "price", enrol: "not_interested", queue: false, lead: "lost" } },
  { id: "A16", desc: "I already have Telkom fibre", input: "I already have Telkom fibre", payload: webhook("I already have Telkom fibre"), expect: { class: "already_has_service", rejReason: "already_has_service", enrol: "not_interested", queue: false, lead: "lost" } },
  { id: "A17", desc: "I have Vodacom fibre", input: "I have Vodacom fibre", payload: webhook("I have Vodacom fibre"), expect: { class: "already_has_service", rejReason: "competitor", enrol: "not_interested", queue: false, lead: "lost" } },
  { id: "A18", desc: "STOP", input: "STOP", payload: webhook("STOP"), expect: { class: null, enrol: "opted_out", queue: false, lead: "new", optOut: true } },
  { id: "A19", desc: "Unsubscribe", input: "Unsubscribe", payload: webhook("Unsubscribe"), expect: { class: null, enrol: "opted_out", queue: false, lead: "new", optOut: true } },
  { id: "A20", desc: "Call me back", input: "Call me back", payload: webhook("Call me back"), expect: { class: "callback_requested", enrol: "callback_requested", queue: true, lead: "qualified" } },
  { id: "A21", desc: "I'd like to speak to a consultant", input: "I'd like to speak to a consultant", payload: webhook("I'd like to speak to a consultant"), expect: { class: "callback_requested", enrol: "callback_requested", queue: true, lead: "qualified" } },
  { id: "A22", desc: "xyzabc123 (gibberish)", input: "xyzabc123", payload: webhook("xyzabc123"), expect: { class: "uncertain_or_ai", enrol: "responded", queue: false, lead: "new" } },
  { id: "A23", desc: "(empty message)", input: "", payload: webhook(""), expect: { class: "uncertain_or_ai", enrol: "responded", queue: false, lead: "new" } },

  // Group B — Step 2 Numbered Menu
  { id: "B1", desc: "1 (more info)", input: "1", payload: webhook("1"), expect: { class: "needs_information", enrol: "responded", queue: false, lead: "new" } },
  { id: "B2", desc: "2 (consultant)", input: "2", payload: webhook("2"), expect: { class: "callback_requested", enrol: "callback_requested", queue: true, lead: "qualified" } },
  { id: "B3", desc: "3 (interested)", input: "3", payload: webhook("3"), expect: { class: "interested", enrol: "interested", queue: true, lead: "qualified" } },
  { id: "B4", desc: "4 (not interested)", input: "4", payload: webhook("4"), expect: { class: "not_interested", enrol: "not_interested", queue: false, lead: "lost" } },
  { id: "B5", desc: "STOP (B)", input: "STOP", payload: webhook("STOP"), expect: { class: null, enrol: "opted_out", queue: false, lead: "new", optOut: true } },
  { id: "B6", desc: "1 – I'd like more information", input: "1 – I'd like more information", payload: webhook("1 – I'd like more information"), expect: { class: "needs_information", enrol: "responded", queue: false, lead: "new" } },
  { id: "B7", desc: "2 – I'd like to speak to a consultant", input: "2 – I'd like to speak to a consultant", payload: webhook("2 – I'd like to speak to a consultant"), expect: { class: "callback_requested", enrol: "callback_requested", queue: true, lead: "qualified" } },

  // Group E — Edge Cases (button/interactive replies)
  { id: "E4", desc: "Button reply: FIBRE", input: "Button: FIBRE", payload: buttonWebhook("FIBRE"), expect: { class: "interested", enrol: "interested", queue: true, lead: "qualified" } },
  { id: "E5", desc: "Interactive reply: Interested", input: "Interactive: Interested", payload: interactiveWebhook("Interested"), expect: { class: "interested", enrol: "interested", queue: true, lead: "qualified" } },
];

function evaluate(test, state) {
  const e = test.expect;
  const s = state;
  const results = {};
  const issues = [];

  // Classification
  if (e.class === null) {
    results.classification = s.classification ? "FAIL: expected none" : "PASS";
    if (s.classification) issues.push(`expected no classification, got ${s.classification.classification}`);
  } else if (e.class === "uncertain_or_ai") {
    const valid = ["uncertain", "other", "no_response", "needs_information", "interested", "not_interested", "callback_requested", "already_has_service"];
    results.classification = valid.includes(s.classification?.classification) ? "PASS" : "FAIL";
    if (!valid.includes(s.classification?.classification)) issues.push(`unexpected classification: ${s.classification?.classification}`);
  } else {
    results.classification = s.classification?.classification === e.class ? "PASS" : `FAIL: expected ${e.class}, got ${s.classification?.classification}`;
    if (s.classification?.classification !== e.class) issues.push(`expected ${e.class}, got ${s.classification?.classification}`);
  }

  // Rejection reason
  if (e.rejReason) {
    results.rejection_reason = s.classification?.rejection_reason === e.rejReason ? "PASS" : `FAIL: expected ${e.rejReason}, got ${s.classification?.rejection_reason}`;
    if (s.classification?.rejection_reason !== e.rejReason) issues.push(`rejection_reason expected ${e.rejReason}, got ${s.classification?.rejection_reason}`);
  }

  // Enrolment status
  results.enrolment = s.enrolment?.status === e.enrol ? "PASS" : `FAIL: expected ${e.enrol}, got ${s.enrolment?.status}`;
  if (s.enrolment?.status !== e.enrol) issues.push(`enrolment expected ${e.enrol}, got ${s.enrolment?.status}`);

  // Calling queue
  const hasQueue = !!s.queue;
  results.queue = hasQueue === e.queue ? "PASS" : `FAIL: expected ${e.queue ? "yes" : "no"}, got ${hasQueue ? "yes" : "no"}`;
  if (hasQueue !== e.queue) issues.push(`queue expected ${e.queue ? "yes" : "no"}, got ${hasQueue ? "yes" : "no"}`);

  // Lead status
  results.lead = s.lead?.status === e.lead ? "PASS" : `FAIL: expected ${e.lead}, got ${s.lead?.status}`;
  if (s.lead?.status !== e.lead) issues.push(`lead expected ${e.lead}, got ${s.lead?.status}`);

  // Opt-out
  if (e.optOut) {
    results.opt_out = s.optOut ? "PASS" : "FAIL: expected opt-out entry";
    if (!s.optOut) issues.push("expected opt_out_list entry");
  }

  // Inbound interaction recorded
  results.interaction = s.interaction ? "PASS" : "FAIL: no inbound interaction";
  if (!s.interaction) issues.push("no inbound interaction recorded");

  const passed = Object.values(results).every((r) => r === "PASS");
  return { passed, results, issues };
}

async function main() {
  console.log("=== Campaign Response Test Suite ===");
  console.log(`Target: ${PRODUCTION_URL}`);
  console.log(`Phone: ${TEST_PHONE} | Lead: ${LEAD_ID}`);
  console.log(`Tests: ${tests.length}`);
  console.log("=" .repeat(60));
  console.log("");

  const summary = [];
  let passCount = 0;
  let failCount = 0;

  for (const test of tests) {
    process.stdout.write(`[${test.id}] "${test.desc}"... `);

    // Reset and create fresh enrolment
    const enrolmentId = await resetAndCreateEnrolment();
    if (!enrolmentId) {
      console.log("RESET FAILED");
      summary.push({ ...test, status: "RESET_FAILED", issues: ["Could not create enrolment"] });
      failCount++;
      continue;
    }

    // Send webhook
    const webhookResult = await sendWebhook(test.payload);
    if (webhookResult.status !== 200) {
      console.log(`WEBHOOK FAILED (${webhookResult.status})`);
      summary.push({ ...test, status: "WEBHOOK_FAILED", issues: [`HTTP ${webhookResult.status}: ${webhookResult.response}`] });
      failCount++;
      continue;
    }

    // Wait for processing
    await new Promise((r) => setTimeout(r, 3000));

    // Read DB state
    const state = await readState(enrolmentId);

    // Evaluate
    const evalResult = evaluate(test, state);

    if (evalResult.passed) {
      console.log("PASS");
      passCount++;
    } else {
      console.log("FAIL");
      console.log(`  Issues: ${evalResult.issues.join("; ")}`);
      console.log(`  State: enrol=${state.enrolment?.status}, class=${state.classification?.classification}, queue=${!!state.queue}, lead=${state.lead?.status}`);
      failCount++;
    }

    summary.push({
      id: test.id,
      desc: test.desc,
      input: test.input,
      expected: test.expect,
      actual: {
        enrolment: state.enrolment?.status,
        classification: state.classification?.classification,
        rejection_reason: state.classification?.rejection_reason,
        confidence: state.classification?.confidence,
        classified_by: state.classification?.classified_by,
        queue: state.queue ? { status: state.queue.queue_status, stage: state.queue.campaign_stage } : null,
        lead: state.lead?.status,
        lead_rejection: state.lead?.rejection_reason,
        opt_out: !!state.optOut,
        interaction: state.interaction?.message_body,
      },
      passed: evalResult.passed,
      issues: evalResult.issues,
      details: evalResult.results,
    });
  }

  // Final cleanup
  console.log("\n--- Cleaning up ---");
  await resetAndCreateEnrolment();
  await supabaseFetch(`/campaign_enrolments?phone_number=eq.${TEST_PHONE}&campaign_id=eq.${CAMPAIGN_ID}`, { method: "DELETE" });
  await supabaseFetch(`/campaign_classifications?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await supabaseFetch(`/calling_queue?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await supabaseFetch(`/opt_out_list?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await supabaseFetch(`/campaign_interactions?phone_number=eq.${TEST_PHONE}`, { method: "DELETE" });
  await supabaseFetch(`/leads?id=eq.${LEAD_ID}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "new", rejection_reason: null, notes: null }) });
  console.log("Cleanup done.");

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log(`RESULTS: ${passCount} passed, ${failCount} failed out of ${tests.length}`);
  console.log("=".repeat(60));

  // Write detailed results to file
  const fs = await import("fs");
  const reportPath = "tests/campaign-response-results.json";
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    target: PRODUCTION_URL,
    phone: TEST_PHONE,
    total: tests.length,
    passed: passCount,
    failed: failCount,
    tests: summary,
  }, null, 2));
  console.log(`\nDetailed report: ${reportPath}`);

  // Print failures summary
  if (failCount > 0) {
    console.log("\n--- FAILURES ---");
    for (const s of summary.filter((s) => !s.passed)) {
      console.log(`[${s.id}] "${s.desc}": ${s.issues.join("; ")}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
