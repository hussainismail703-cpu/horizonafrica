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
const PRODUCTION_URL = process.env.TEST_TARGET || "http://localhost:3000";
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

  // Calling queue (latest entry)
  const queueRes = await supabaseFetch(`/calling_queue?phone_number=eq.${TEST_PHONE}&order=created_at.desc&limit=1&select=queue_status,campaign_stage,customer_request`);
  const queue = (await queueRes.json())[0];

  // Calling queue count (all entries for this enrolment — for duplicate prevention tests)
  const queueCountRes = await supabaseFetch(`/calling_queue?enrolment_id=eq.${enrolmentId}&select=id`);
  const queueCount = (await queueCountRes.json()).length;

  // Lead
  const leadRes = await supabaseFetch(`/leads?id=eq.${LEAD_ID}&select=status,rejection_reason`);
  const lead = (await leadRes.json())[0];

  // Opt-out
  const optRes = await supabaseFetch(`/opt_out_list?phone_number=eq.${TEST_PHONE}&select=id,reason`);
  const optOut = (await optRes.json())[0];

  // Inbound interaction
  const intRes = await supabaseFetch(`/campaign_interactions?enrol_id=eq.${enrolmentId}&message_type=eq.inbound&order=created_at.desc&limit=1&select=message_body,message_type`);
  const interaction = (await intRes.json())[0];

  return { enrolment, classification, queue, queueCount, lead, optOut, interaction };
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

// --- Process endpoint helpers ---

async function triggerProcess() {
  const res = await fetch(`${PRODUCTION_URL}/api/campaigns/process`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.APP_SECRET}`,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function setEnrolmentState(enrolmentId, state) {
  await supabaseFetch(`/campaign_enrolments?id=eq.${enrolmentId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(state),
  });
}

async function setCampaignStatus(status) {
  await supabaseFetch(`/campaigns?id=eq.${CAMPAIGN_ID}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status }),
  });
}

async function getCampaignStatus() {
  const res = await supabaseFetch(`/campaigns?id=eq.${CAMPAIGN_ID}&select=status`);
  const data = await res.json();
  return data[0]?.status;
}

async function getOutboundInteractions(enrolmentId) {
  const res = await supabaseFetch(
    `/campaign_interactions?enrol_id=eq.${enrolmentId}&message_type=eq.outbound&order=created_at.asc&select=id,step_number,template_name,delivery_status`
  );
  return await res.json();
}

async function countOutboundForStep(enrolmentId, stepNumber) {
  const res = await supabaseFetch(
    `/campaign_interactions?enrol_id=eq.${enrolmentId}&message_type=eq.outbound&step_number=eq.${stepNumber}&select=id`
  );
  const data = await res.json();
  return data.length;
}

async function insertOutboundInteraction(enrolmentId, stepNumber, templateName) {
  await supabaseFetch(`/campaign_interactions`, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      campaign_id: CAMPAIGN_ID,
      enrol_id: enrolmentId,
      phone_number: TEST_PHONE,
      step_number: stepNumber,
      message_type: "outbound",
      template_name: templateName,
      delivery_status: "sent",
      meta_message_id: "test-dummy-msg-id",
    }),
  });
}

async function getEnrolment(enrolmentId) {
  const res = await supabaseFetch(
    `/campaign_enrolments?id=eq.${enrolmentId}&select=id,current_step,status,final_outcome,nurture_flag`
  );
  const data = await res.json();
  return data[0];
}

async function createTempCampaign() {
  const res = await supabaseFetch(`/campaigns`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      name: "TEMP TEST CAMPAIGN — DELETE",
      status: "active",
      start_date: new Date(Date.now() - 7 * 86400000).toISOString(),
      end_date: new Date(Date.now() - 86400000).toISOString(),
    }),
  });
  const data = await res.json();
  return data[0]?.id;
}

async function deleteTempCampaign(id) {
  await supabaseFetch(`/campaign_enrolments?campaign_id=eq.${id}`, { method: "DELETE" });
  await supabaseFetch(`/campaign_interactions?campaign_id=eq.${id}`, { method: "DELETE" });
  await supabaseFetch(`/campaign_steps?campaign_id=eq.${id}`, { method: "DELETE" });
  await supabaseFetch(`/campaigns?id=eq.${id}`, { method: "DELETE" });
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

  // Group E — Duplicate Prevention & Edge Cases
  { id: "E2", desc: "Duplicate calling queue prevention", input: "FIBRE", payload: webhook("FIBRE"),
    setup: async (enrolmentId) => {
      // Pre-create a pending calling queue entry for this enrolment
      await supabaseFetch(`/calling_queue`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          campaign_id: CAMPAIGN_ID,
          enrolment_id: enrolmentId,
          phone_number: TEST_PHONE,
          lead_id: LEAD_ID,
          queue_status: "pending",
          campaign_stage: "INTERESTED",
          campaign_source: "Fibre Lead Re-Engagement",
          customer_request: "Pre-existing queue entry",
        }),
      });
    },
    expect: { class: "interested", enrol: "interested", queue: true, queueCount: 1, lead: "qualified" } },
  { id: "E3", desc: "Re-classification clears stale rejection_reason", input: "FIBRE", payload: webhook("FIBRE"),
    setup: async (enrolmentId) => {
      // Set lead to lost with price rejection
      await supabaseFetch(`/leads?id=eq.${LEAD_ID}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "lost", rejection_reason: "price" }),
      });
    },
    expect: { class: "interested", enrol: "interested", queue: true, lead: "qualified", leadRejNull: true } },

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

  // Queue count (for duplicate prevention tests)
  if (e.queueCount !== undefined) {
    results.queueCount = s.queueCount === e.queueCount ? "PASS" : `FAIL: expected ${e.queueCount}, got ${s.queueCount}`;
    if (s.queueCount !== e.queueCount) issues.push(`queueCount expected ${e.queueCount}, got ${s.queueCount}`);
  }

  // Lead rejection_reason null check (for re-classification tests)
  if (e.leadRejNull) {
    results.leadRejNull = s.lead?.rejection_reason === null ? "PASS" : `FAIL: expected null, got ${s.lead?.rejection_reason}`;
    if (s.lead?.rejection_reason !== null) issues.push(`lead rejection_reason expected null, got ${s.lead?.rejection_reason}`);
  }

  // Inbound interaction recorded
  results.interaction = s.interaction ? "PASS" : "FAIL: no inbound interaction";
  if (!s.interaction) issues.push("no inbound interaction recorded");

  const passed = Object.values(results).every((r) => r === "PASS");
  return { passed, results, issues };
}

// ---------------------------------------------------------------------------
// Process Tests (C, D, E1, F) — tests that require the campaign process endpoint
// ---------------------------------------------------------------------------

const processTests = [

  // Group C — Step 2 Delivery Rules
  {
    id: "C1",
    desc: "Non-responder gets Step 2 (sends real WhatsApp)",
    run: async () => {
      const enrolmentId = await resetAndCreateEnrolment();
      if (!enrolmentId) return { passed: false, issues: ["Could not create enrolment"] };

      // Set enrolment to step 1 (0-indexed), enrolled 3 days ago
      const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
      await setEnrolmentState(enrolmentId, { current_step: 1, enrolled_at: threeDaysAgo });
      // Insert dummy step 1 outbound (simulates step 1 was already sent)
      await insertOutboundInteraction(enrolmentId, 1, "telkom_fibre_packages");

      const origStatus = await getCampaignStatus();
      await setCampaignStatus("active");
      const result = await triggerProcess();
      await setCampaignStatus(origStatus);

      const step2Count = await countOutboundForStep(enrolmentId, 2);
      const enrol = await getEnrolment(enrolmentId);

      const issues = [];
      if (step2Count < 1) issues.push(`expected step 2 outbound >= 1, got ${step2Count}`);
      if (enrol.current_step !== 2) issues.push(`expected current_step=2, got ${enrol.current_step}`);

      return { passed: issues.length === 0, issues, actual: { step2Outbound: step2Count, current_step: enrol.current_step, status: enrol.status, processResult: result.data } };
    },
  },
  {
    id: "C2",
    desc: "Responder does NOT get Step 2",
    run: async () => {
      const enrolmentId = await resetAndCreateEnrolment();
      if (!enrolmentId) return { passed: false, issues: ["Could not create enrolment"] };

      const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
      await setEnrolmentState(enrolmentId, { current_step: 1, enrolled_at: threeDaysAgo, status: "responded" });
      await insertOutboundInteraction(enrolmentId, 1, "telkom_fibre_packages");

      const origStatus = await getCampaignStatus();
      await setCampaignStatus("active");
      await triggerProcess();
      await setCampaignStatus(origStatus);

      const step2Count = await countOutboundForStep(enrolmentId, 2);
      const enrol = await getEnrolment(enrolmentId);

      const issues = [];
      if (step2Count !== 0) issues.push(`expected 0 step 2 outbound, got ${step2Count}`);
      if (enrol.status !== "responded") issues.push(`expected status=responded, got ${enrol.status}`);

      return { passed: issues.length === 0, issues, actual: { step2Outbound: step2Count, status: enrol.status, current_step: enrol.current_step } };
    },
  },
  {
    id: "C3",
    desc: "Opted-out does NOT get Step 2",
    run: async () => {
      const enrolmentId = await resetAndCreateEnrolment();
      if (!enrolmentId) return { passed: false, issues: ["Could not create enrolment"] };

      const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
      await setEnrolmentState(enrolmentId, { current_step: 1, enrolled_at: threeDaysAgo, status: "opted_out" });
      await insertOutboundInteraction(enrolmentId, 1, "telkom_fibre_packages");
      // Add to opt_out_list
      await supabaseFetch(`/opt_out_list`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ phone_number: TEST_PHONE, reason: "STOP keyword", source_campaign_id: CAMPAIGN_ID }),
      });

      const origStatus = await getCampaignStatus();
      await setCampaignStatus("active");
      await triggerProcess();
      await setCampaignStatus(origStatus);

      const step2Count = await countOutboundForStep(enrolmentId, 2);
      const enrol = await getEnrolment(enrolmentId);

      const issues = [];
      if (step2Count !== 0) issues.push(`expected 0 step 2 outbound, got ${step2Count}`);
      if (enrol.status !== "opted_out") issues.push(`expected status=opted_out, got ${enrol.status}`);

      return { passed: issues.length === 0, issues, actual: { step2Outbound: step2Count, status: enrol.status } };
    },
  },
  {
    id: "C4",
    desc: "Step 2 delay enforcement (enrolled 1 day ago)",
    run: async () => {
      const enrolmentId = await resetAndCreateEnrolment();
      if (!enrolmentId) return { passed: false, issues: ["Could not create enrolment"] };

      const oneDayAgo = new Date(Date.now() - 1 * 86400000).toISOString();
      await setEnrolmentState(enrolmentId, { current_step: 1, enrolled_at: oneDayAgo });
      await insertOutboundInteraction(enrolmentId, 1, "telkom_fibre_packages");

      const origStatus = await getCampaignStatus();
      await setCampaignStatus("active");
      await triggerProcess();
      await setCampaignStatus(origStatus);

      const step2Count = await countOutboundForStep(enrolmentId, 2);
      const enrol = await getEnrolment(enrolmentId);

      const issues = [];
      if (step2Count !== 0) issues.push(`expected 0 step 2 outbound (not due yet), got ${step2Count}`);
      if (enrol.current_step !== 1) issues.push(`expected current_step=1 (unchanged), got ${enrol.current_step}`);

      return { passed: issues.length === 0, issues, actual: { step2Outbound: step2Count, current_step: enrol.current_step } };
    },
  },

  // Group D — No Response Flow
  {
    id: "D1",
    desc: "No response after both steps → no_response_final",
    run: async () => {
      const enrolmentId = await resetAndCreateEnrolment();
      if (!enrolmentId) return { passed: false, issues: ["Could not create enrolment"] };

      // Set enrolment past last step (current_step = 2, stepList has 2 entries at indices 0,1)
      await setEnrolmentState(enrolmentId, { current_step: 2, status: "active" });

      const origStatus = await getCampaignStatus();
      await setCampaignStatus("active");
      await triggerProcess();
      await setCampaignStatus(origStatus);

      const enrol = await getEnrolment(enrolmentId);

      const issues = [];
      if (enrol.status !== "no_response_final") issues.push(`expected status=no_response_final, got ${enrol.status}`);
      if (enrol.nurture_flag !== true) issues.push(`expected nurture_flag=true, got ${enrol.nurture_flag}`);
      if (enrol.final_outcome !== "NO RESPONSE – FINAL ATTEMPT") issues.push(`expected final_outcome="NO RESPONSE – FINAL ATTEMPT", got "${enrol.final_outcome}"`);

      return { passed: issues.length === 0, issues, actual: { status: enrol.status, nurture_flag: enrol.nurture_flag, final_outcome: enrol.final_outcome } };
    },
  },
  {
    id: "D2",
    desc: "Campaign closure (end_date passed)",
    run: async () => {
      // Create a temporary campaign with end_date in the past
      const tempCampaignId = await createTempCampaign();
      if (!tempCampaignId) return { passed: false, issues: ["Could not create temp campaign"] };

      try {
        // Create an active enrolment in the temp campaign
        const enrolRes = await supabaseFetch(`/campaign_enrolments`, {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            campaign_id: tempCampaignId,
            phone_number: TEST_PHONE,
            lead_id: LEAD_ID,
            current_step: 0,
            status: "active",
            enrolled_at: new Date(Date.now() - 5 * 86400000).toISOString(),
          }),
        });
        const enrolData = await enrolRes.json();
        const enrolmentId = enrolData[0]?.id;
        if (!enrolmentId) return { passed: false, issues: ["Could not create enrolment in temp campaign"] };

        // Trigger process — should close the expired campaign
        await triggerProcess();

        // Check enrolment status
        const enrol = await getEnrolment(enrolmentId);

        // Check campaign status
        const campRes = await supabaseFetch(`/campaigns?id=eq.${tempCampaignId}&select=status`);
        const campData = await campRes.json();
        const campaignStatus = campData[0]?.status;

        const issues = [];
        if (enrol.status !== "no_response_final") issues.push(`expected enrolment status=no_response_final, got ${enrol.status}`);
        if (enrol.nurture_flag !== true) issues.push(`expected nurture_flag=true, got ${enrol.nurture_flag}`);
        if (campaignStatus !== "completed") issues.push(`expected campaign status=completed, got ${campaignStatus}`);

        return { passed: issues.length === 0, issues, actual: { enrolment: enrol.status, nurture_flag: enrol.nurture_flag, campaign: campaignStatus } };
      } finally {
        await deleteTempCampaign(tempCampaignId);
      }
    },
  },

  // Group E1 — Duplicate Step 1 prevention
  {
    id: "E1",
    desc: "Duplicate Step 1 prevention",
    run: async () => {
      const enrolmentId = await resetAndCreateEnrolment();
      if (!enrolmentId) return { passed: false, issues: ["Could not create enrolment"] };

      // Set to step 0 (about to send step 1) — resetAndCreateEnrolment defaults to 1
      await setEnrolmentState(enrolmentId, { current_step: 0 });
      // Insert a dummy step 1 outbound interaction (simulates step 1 already sent)
      await insertOutboundInteraction(enrolmentId, 1, "telkom_fibre_packages");

      const origStatus = await getCampaignStatus();
      await setCampaignStatus("active");
      const result = await triggerProcess();
      await setCampaignStatus(origStatus);

      const step1Count = await countOutboundForStep(enrolmentId, 1);
      const enrol = await getEnrolment(enrolmentId);

      const issues = [];
      if (step1Count !== 1) issues.push(`expected 1 step 1 outbound (no duplicate), got ${step1Count}`);
      if (enrol.current_step !== 0) issues.push(`expected current_step=0 (not advanced), got ${enrol.current_step}`);

      return { passed: issues.length === 0, issues, actual: { step1Outbound: step1Count, current_step: enrol.current_step, processSent: result.data?.sent } };
    },
  },

  // Group F — Campaign Flow Integration
  {
    id: "F1",
    desc: "Full happy path: Step 1 → FIBRE → interested → no Step 2 (sends real WhatsApp)",
    run: async () => {
      const enrolmentId = await resetAndCreateEnrolment();
      if (!enrolmentId) return { passed: false, issues: ["Could not create enrolment"] };
      await setEnrolmentState(enrolmentId, { current_step: 0 });

      const origStatus = await getCampaignStatus();
      await setCampaignStatus("active");

      try {
        // Step 1: Trigger process → Step 1 sent
        const r1 = await triggerProcess();
        const step1Count = await countOutboundForStep(enrolmentId, 1);
        let enrol = await getEnrolment(enrolmentId);

        const issues = [];
        if (step1Count < 1) issues.push(`Step 1 not sent: outbound count=${step1Count}`);
        if (enrol.current_step !== 1) issues.push(`expected current_step=1 after step 1, got ${enrol.current_step}`);

        // Step 2: Reply "FIBRE"
        await sendWebhook(webhook("FIBRE"));
        await new Promise((r) => setTimeout(r, 3000));

        const state = await readState(enrolmentId);
        enrol = await getEnrolment(enrolmentId);

        if (state.classification?.classification !== "interested") issues.push(`expected classification=interested, got ${state.classification?.classification}`);
        if (enrol.status !== "interested") issues.push(`expected enrolment status=interested, got ${enrol.status}`);
        if (!state.queue) issues.push("expected calling queue entry");
        if (state.lead?.status !== "qualified") issues.push(`expected lead status=qualified, got ${state.lead?.status}`);

        // Step 3: Trigger process again → Step 2 NOT sent (enrolment not active)
        const r2 = await triggerProcess();
        const step2Count = await countOutboundForStep(enrolmentId, 2);

        if (step2Count !== 0) issues.push(`expected 0 step 2 outbound (enrolment not active), got ${step2Count}`);

        return { passed: issues.length === 0, issues, actual: { step1Outbound: step1Count, classification: state.classification?.classification, enrolment: enrol.status, queue: !!state.queue, lead: state.lead?.status, step2Outbound: step2Count } };
      } finally {
        await setCampaignStatus(origStatus);
      }
    },
  },
  {
    id: "F2",
    desc: "Full no-response path: Step 1 → no reply → Step 2 → no reply → no_response_final (sends real WhatsApp)",
    run: async () => {
      const enrolmentId = await resetAndCreateEnrolment();
      if (!enrolmentId) return { passed: false, issues: ["Could not create enrolment"] };
      await setEnrolmentState(enrolmentId, { current_step: 0 });

      const origStatus = await getCampaignStatus();
      await setCampaignStatus("active");

      try {
        // Step 1: Trigger process → Step 1 sent
        await triggerProcess();
        const step1Count = await countOutboundForStep(enrolmentId, 1);
        let enrol = await getEnrolment(enrolmentId);

        const issues = [];
        if (step1Count < 1) issues.push(`Step 1 not sent: outbound count=${step1Count}`);
        if (enrol.current_step !== 1) issues.push(`expected current_step=1, got ${enrol.current_step}`);

        // Step 2: Simulate 3 days passing, trigger process → Step 2 sent
        const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
        await setEnrolmentState(enrolmentId, { enrolled_at: threeDaysAgo });
        await triggerProcess();
        const step2Count = await countOutboundForStep(enrolmentId, 2);
        enrol = await getEnrolment(enrolmentId);

        if (step2Count < 1) issues.push(`Step 2 not sent: outbound count=${step2Count}`);
        if (enrol.current_step !== 2) issues.push(`expected current_step=2, got ${enrol.current_step}`);

        // Step 3: Trigger process → no_response_final
        await triggerProcess();
        enrol = await getEnrolment(enrolmentId);

        if (enrol.status !== "no_response_final") issues.push(`expected status=no_response_final, got ${enrol.status}`);
        if (enrol.nurture_flag !== true) issues.push(`expected nurture_flag=true, got ${enrol.nurture_flag}`);

        return { passed: issues.length === 0, issues, actual: { step1Outbound: step1Count, step2Outbound: step2Count, finalStatus: enrol.status, nurture_flag: enrol.nurture_flag } };
      } finally {
        await setCampaignStatus(origStatus);
      }
    },
  },
  {
    id: "F3",
    desc: "Response after Step 2: Step 1 → no reply → Step 2 → reply 3 → interested (sends real WhatsApp)",
    run: async () => {
      const enrolmentId = await resetAndCreateEnrolment();
      if (!enrolmentId) return { passed: false, issues: ["Could not create enrolment"] };
      await setEnrolmentState(enrolmentId, { current_step: 0 });

      const origStatus = await getCampaignStatus();
      await setCampaignStatus("active");

      try {
        // Step 1: Trigger process → Step 1 sent
        await triggerProcess();
        let enrol = await getEnrolment(enrolmentId);
        const issues = [];
        if (enrol.current_step !== 1) issues.push(`expected current_step=1 after step 1, got ${enrol.current_step}`);

        // Step 2: Simulate 3 days passing, trigger process → Step 2 sent
        const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
        await setEnrolmentState(enrolmentId, { enrolled_at: threeDaysAgo });
        await triggerProcess();
        enrol = await getEnrolment(enrolmentId);
        if (enrol.current_step !== 2) issues.push(`expected current_step=2 after step 2, got ${enrol.current_step}`);

        // Step 3: Reply "3" (interested from numbered menu)
        await sendWebhook(webhook("3"));
        await new Promise((r) => setTimeout(r, 3000));

        const state = await readState(enrolmentId);
        enrol = await getEnrolment(enrolmentId);

        if (state.classification?.classification !== "interested") issues.push(`expected classification=interested, got ${state.classification?.classification}`);
        if (enrol.status !== "interested") issues.push(`expected enrolment status=interested, got ${enrol.status}`);
        if (!state.queue) issues.push("expected calling queue entry");

        return { passed: issues.length === 0, issues, actual: { current_step: enrol.current_step, classification: state.classification?.classification, enrolment: enrol.status, queue: !!state.queue } };
      } finally {
        await setCampaignStatus(origStatus);
      }
    },
  },
  {
    id: "F4",
    desc: "Opt-out after Step 1: Step 1 → STOP → opted_out → no Step 2 (sends real WhatsApp)",
    run: async () => {
      const enrolmentId = await resetAndCreateEnrolment();
      if (!enrolmentId) return { passed: false, issues: ["Could not create enrolment"] };
      await setEnrolmentState(enrolmentId, { current_step: 0 });

      const origStatus = await getCampaignStatus();
      await setCampaignStatus("active");

      try {
        // Step 1: Trigger process → Step 1 sent
        await triggerProcess();
        let enrol = await getEnrolment(enrolmentId);
        const issues = [];
        if (enrol.current_step !== 1) issues.push(`expected current_step=1 after step 1, got ${enrol.current_step}`);

        // Step 2: Reply "STOP"
        await sendWebhook(webhook("STOP"));
        await new Promise((r) => setTimeout(r, 3000));

        enrol = await getEnrolment(enrolmentId);
        if (enrol.status !== "opted_out") issues.push(`expected enrolment status=opted_out, got ${enrol.status}`);

        // Check opt_out_list
        const optRes = await supabaseFetch(`/opt_out_list?phone_number=eq.${TEST_PHONE}&select=id`);
        const optData = await optRes.json();
        if (!optData[0]) issues.push("expected opt_out_list entry");

        // Step 3: Simulate 3 days passing, trigger process → Step 2 NOT sent
        const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
        await setEnrolmentState(enrolmentId, { enrolled_at: threeDaysAgo });
        await triggerProcess();
        const step2Count = await countOutboundForStep(enrolmentId, 2);

        if (step2Count !== 0) issues.push(`expected 0 step 2 outbound (opted out), got ${step2Count}`);

        return { passed: issues.length === 0, issues, actual: { enrolment: enrol.status, optOut: !!optData[0], step2Outbound: step2Count } };
      } finally {
        await setCampaignStatus(origStatus);
      }
    },
  },
];

async function main() {
  console.log("=== Campaign Response Test Suite ===");
  console.log(`Target: ${PRODUCTION_URL}`);
  console.log(`Phone: ${TEST_PHONE} | Lead: ${LEAD_ID}`);
  console.log(`Webhook tests: ${tests.length} | Process tests: ${processTests.length} | Total: ${tests.length + processTests.length}`);
  console.log("=" .repeat(60));
  console.log("");

  const summary = [];
  let passCount = 0;
  let failCount = 0;

  console.log("--- Phase 1: Webhook Response Tests (Groups A, B, E) ---\n");

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

    // Run custom setup if defined (e.g. pre-create queue entry, set lead state)
    if (test.setup) {
      await test.setup(enrolmentId);
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

  // --- Phase 2: Process Endpoint Tests (Groups C, D, E1, F) ---
  console.log("\n--- Phase 2: Process Endpoint Tests (Groups C, D, E1, F) ---");
  console.log("NOTE: Some tests send real WhatsApp messages to the test phone.\n");

  for (const test of processTests) {
    process.stdout.write(`[${test.id}] ${test.desc}... `);

    try {
      const result = await test.run();

      if (result.passed) {
        console.log("PASS");
        passCount++;
      } else {
        console.log("FAIL");
        console.log(`  Issues: ${result.issues.join("; ")}`);
        if (result.actual) console.log(`  Actual: ${JSON.stringify(result.actual)}`);
        failCount++;
      }

      summary.push({
        id: test.id,
        desc: test.desc,
        passed: result.passed,
        issues: result.issues,
        actual: result.actual,
      });
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      failCount++;
      summary.push({
        id: test.id,
        desc: test.desc,
        passed: false,
        issues: [err.message],
        actual: null,
      });
    }
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
  const totalTests = tests.length + processTests.length;
  console.log("\n" + "=".repeat(60));
  console.log(`RESULTS: ${passCount} passed, ${failCount} failed out of ${totalTests}`);
  console.log("=".repeat(60));

  // Write detailed results to file
  const fs = await import("fs");
  const reportPath = "tests/campaign-response-results.json";
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    target: PRODUCTION_URL,
    phone: TEST_PHONE,
    total: totalTests,
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
