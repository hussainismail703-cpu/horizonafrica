# Scope Freeze Full-Coverage Test Plan — Horizon Africa

**Master source:** `Layla Phase 1 Scope Freeze.txt` (Q-2026-0825-HC-CAMPAIGN)
**Purpose:** Prove — section by section, layer by layer — that the delivered system
matches the frozen scope. Unlike `scope-compliance-plan.md` (existence/compliance)
and `scope-freeze-deep-audit.mjs` (boundary/edge cases), this plan verifies **every
clause of the document through every layer**: UI/UX → API → database → n8n/Meta
workflows → out-of-scope negative confirmation → operational/contractual sign-off.

**Statuses:** `PASS` | `FAIL` | `PARTIAL` | `MANUAL` | `N/A`
**Deliverables:**
1. `tests/scope-freeze-coverage.mjs` — automated checks (W/U/C/D/N tracks below)
2. `tests/scope-freeze-coverage-report.md` — one evidence row per matrix line
3. Evidence pack: screenshots under `tests/screenshots/coverage/`, n8n execution
   IDs, and Supabase row snapshots recorded in the results JSON

**Safety rules (unchanged from prior audits):**
- Real WhatsApp sends only to `27832763116` (Hussain's number), opt-in per run.
- Fibre campaign `febe1cac-cf87-46c3-bbc7-160d3b96e28e` restored to `paused` after tests.
- All test data prefixed `[COVERAGE]` and deleted in teardown.
- Webhook posts are HMAC-signed via `tests/lib/webhook.mjs`.
- Never enrol real lead segments; pilot enrolment is a separate client decision.

---

## Layer key

| Layer | What is verified |
|-------|------------------|
| **UI** | Screen renders, controls work, empty/error/loading states, responsive (375/768/1440px), no console errors, accessible labels |
| **API** | Route behaviour: auth enforcement, validation, response shape, status codes |
| **DB** | Schema, columns, constraints, triggers, RLS, indexes; row-level assertions after actions |
| **WF** | n8n workflow existence, activation, node behaviour, live execution evidence (execution IDs) |
| **META** | Meta Graph API: WABA, template status, phone quality/tier |
| **NEG** | Negative check: confirm out-of-scope items are genuinely absent |
| **MANUAL** | Requires human/client sign-off — listed, not automated |

---

## Track W — Workflow Coverage (every n8n workflow, end to end)

Seven workflows exist. For each: confirm active/published state, inspect nodes, and
capture at least one real execution ID as evidence.

| ID | Workflow | n8n ID | Checks |
|----|----------|--------|--------|
| W1 | Inbound AI Lead Qualification | `kW4ELXolGnYx2AvB` | Webhook receives → Extract Message (text/media/location) → Fetch Lead (`executeOnce`) → OpenRouter → Verify (deterministic) → Jev verifier → Process Response → Send WhatsApp → Upsert Lead → Advance Lead Status → Update Lead Score (atomic, `score_locked`-aware) → Log Conversation. Confirm `needs_escalation` triggers Chatwoot handover + Brevo email. |
| W2 | Campaign Sequence Engine (scheduler) | `rOGNKmgeCRikitAe` | 15-min schedule, calls `https://dashboard.horizonafrica.co.za/api/campaigns/process` with bearer token; writes `system_heartbeats.campaign_process`; confirm production URL (not old Vercel hostname). |
| W3 | Layla Follow-up Sender | `Jz1na3ZFwZG1V0Vq` | Daily 09:00 schedule → `/api/follow-ups/cron`; eligible leads get follow-up; `follow_up_sent`/`follow_up_sent_at` set; template parameters correct. |
| W4 | Missed Message Recovery | `PvCdg60gkRYVxYOf` | Finds conversations with `ai_response=null` in the 5-min–2-hr window → resubmits to AI → verify a recovery execution created a response. |
| W5 | Webhook Proxy Error Alert | `9Hc0ZrL3H5LucMyA` | Triggered on delivery failures; confirm `message_delivery_failures` row → email path. Check alert-noise level. |
| W6 | Layla Error Alert | `4sKjZjAY91UzCmqe` | n8n error-trigger wiring; confirm it fires on workflow crash (or document 0 executions = healthy). |
| W7 | Webhook Health Monitor | `ytA7xBbvP6ubsY12` | Schedule → Meta phone status check → **Check Scheduler Heartbeat** → Analyze Health (45-min staleness + 24-hr alert cooldown) → alert path. |

Workflow evidence method: n8n MCP `get_workflow` (structure) + `search_executions` /
`get_execution` (runtime proof). A workflow that exists but has never executed is
`PARTIAL`, not `PASS`.

---

## Track U — UI/UX Coverage (every screen, every state)

Headed Playwright (`headless:false, slowMo`). Each page is tested for:
render, primary actions, empty state, error state, loading behaviour, responsive
layout at 375px / 768px / 1440px, and zero console errors.

| ID | Screen | Route | Key checks |
|----|--------|-------|------------|
| U1 | Login / Forgot / Reset | `/login`, `/forgot-password`, `/reset-password` | Valid/invalid login, error messages, redirect rules, password-reset flow reachable |
| U2 | Dashboard overview | `/dashboard` | KPIs, Active Conversations = distinct threads (7-day), Recent Conversations deduped by phone, live lead scores |
| U3 | Leads | `/leads` | List, search by phone variants (`0832…` ≡ `2783…`), drawer fields incl. preferred contact number + address, score/status edit → `*_locked` + "Manual" chip, CSV export formula-safe |
| U4 | Conversations | `/conversations` | Thread list newest-first, open thread, mobile chat pane opens + Back returns, score filter chips, live scores |
| U5 | Broadcasts | `/broadcasts` | Group list, contact management, template send UI, bulk import via OWD template, opt-out exclusion reflected |
| U6 | Campaigns list/create | `/campaigns`, `/campaigns/create` | Create form validation, dates, group targeting, duplicate-name 409, empty-name disabled submit |
| U7 | Campaign detail | `/campaigns/[id]` | Status controls (activate/pause/stop guards), sequence builder, **`template_parameters` preserved on save** (regression — bug found & fixed), error-monitoring panel |
| U8 | Enrolments | `/campaigns/[id]/enrolments` | Group enrol, manual phone enrol, status override, removal, all status badges render |
| U9 | Customer journey | `/campaigns/[id]/customers/[phone]` | Flat record: campaign → step/status → classification → last response → outcome (§7.3 shape — no funnels needed here) |
| U10 | Audit trail | `/campaigns/[id]/audit` | Manual changes show old value, new value, user, timestamp (§7.1a) |
| U11 | Campaign dashboard | `/campaigns/dashboard` | Active campaigns, contacts-per-step counts, progress (§4.8) |
| U12 | Campaign report | `/campaigns/reports/[id]` | Sent, delivery rate, response rate, entered-sales-flow, converted; funnel + classification + outcome breakdowns; failed-message list (§4.9, §8) |
| U13 | Calling queue | `/calling-queue` | Queue items, status transitions pending→called→converted/lost, call notes, campaign filter |
| U14 | Follow-ups | `/follow-ups` | Scheduled list, due/overdue display, sent markers |
| U15 | Templates | `/templates` | Template list from WABA, statuses, submit flow presence |
| U16 | Products | `/products` | Catalog CRUD; changes reflected in AI context (cross-check W1) |
| U17 | Reports | `/reports` | KPIs, charts, date-range filters |
| U18 | Health | `/health` | 6 service checks + scheduler heartbeat freshness, statuses render |
| U19 | Settings | `/settings` | Alert-emails save/load; integration status cards accurate |
| U20 | Shell | all | Sidebar nav, top-bar notification bell (dropdown works), logout, session-expiry redirect, 404 handling |

---

## Track C — Campaign Engine (§4–§6 functional spine)

Full lifecycle on an isolated `[COVERAGE]` campaign; enrols only test phones.

| ID | Scope ref | Test |
|----|-----------|------|
| C1 | §4.1 | Create campaign end-to-end via UI: name, objective, start/end, group target |
| C2 | §4.2 | Build 3-step sequence (Day 0/2/5), save, re-edit to different timings — no code change |
| C3 | §4.3 | Backdated enrolment → process → step advances; delay enforcement between steps |
| C4 | §4.4 | Inbound reply → sequence stops, interaction recorded, routed to calling queue |
| C5 | §4.5 | Each of 8 rejection reasons (`price, already_has_service, not_needed, not_now, needs_more_info, competitor, not_eligible, other`) classified and stored on lead |
| C6 | §4.6 | Each intent class exercised; ambiguous input → `uncertain`/review path |
| C7 | §4.7 | Interaction rows carry who/when/status/wamid; failure surfaces in errors API + report UI |
| C8 | §4.8 | Dashboard shows enrolment counts per step matching DB |
| C9 | §4.9 + §8 | Stats endpoint math verified per agreed definitions (delivery incl. read; read/delivered; conversion = lead status `converted`) |
| C10 | §4.10 | Group-based enrolment of a `[COVERAGE]` group; dedupe on re-enrol |
| C11 | §4.11 | Lead shows campaign history, `last_campaign_contact_date`, `last_campaign_response`, `rejection_reason` |
| C12 | §4.12 | Non-responder past final step → `no_response_final` + `nurture_flag`; late reply revives |
| C13 | §5 | Same phone enrolled in two campaigns; independent progression; per-list targeting only |
| C14 | §6 | Duplicate-send prevention: unique `(enrol_id, step_number)`; concurrent process runs; inbound `wamid` dedupe |
| C15 | §7.1 | Manual status override, classification correction (original preserved, `classified_by=manual`), manual removal stops sends — each writes audit row |
| C16 | §7.2 | `BACKUP-RECOVERY.md` procedure accuracy re-verified (script runs, files produced) |
| C17 | §7.3 | Journey page shows complete flat record for test customer |

---

## Track D — Data Layer (schema/RLS/triggers/indexes)

| ID | Check |
|----|-------|
| D1 | All campaign tables + columns per migrations (enrolments, interactions, classifications, audit, errors, `meta_error`, `nurture_flag`, `final_outcome`, `template_parameters`, `group_id`) |
| D2 | `calling_queue`, `opt_out_list`, `inbound_webhook_messages`, `system_heartbeats`, `message_delivery_failures`, `broadcast_messages` exist with RLS enabled |
| D3 | Unique constraints: `(enrol_id, step_number)` outbound, `meta_message_id` inbound, `(group_id, phone_number)` contacts |
| D4 | Triggers fire: audit on enrolment/classification change, audit cleanup on delete, `conversation_threads` view, `upsert_lead_from_conversation` respects `score_locked` |
| D5 | Lead extension columns: `last_campaign_contact_date`, `last_campaign_response`, `rejection_reason`, `preferred_contact_number`, `score_locked`, `status_locked` |
| D6 | RLS spot-check: unauthenticated REST cannot read campaign/lead tables |

---

## Track N — Out-of-Scope Negative Verification (§9, all 19 items)

Confirm each excluded item is genuinely absent (or documented as a delivered
enhancement where prior sessions consciously added it):

| ID | §9 item | Check |
|----|---------|-------|
| N1 | 1. Mobile app | NEG — web dashboard only |
| N2 | 2. Third-party CRM integrations | NEG — no HubSpot/Salesforce code/deps |
| N3 | 3. Google Sheets sync | NEG — code, deps, and n8n nodes absent |
| N4 | 4. SMS/email campaign channels | NEG — campaigns are WhatsApp-only (Brevo exists only for baseline alerts, not campaigns) |
| N5 | 5. Voice/IVR | NEG |
| N6 | 6. Custom AI model training | NEG — OpenRouter API calls only |
| N7 | 7. Auto rules-based segmentation | NEG — targeting is manual per §5 |
| N8 | 8. Auto conflict prevention | NEG — document behavior if contact in two groups |
| N9 | 9. Nurture campaigns | NEG — `nurture_flag` only (flag feeds Phase 2) |
| N10 | 10. Customer Intelligence Profile | NEG |
| N11 | 11. Visual journey timeline | NEG — flat record view only (§7.3 boundary) |
| N12 | 12. Pause/resume mid-sequence restore | NEG — document actual pause semantics |
| N13 | 13. Self-learning classification | NEG — corrections stored only |
| N14 | 14. Failed-message auto-retry | NEG — visibility only, no retry daemon |
| N15 | 15. Campaign CSV export | NEG — no route exists |
| N16 | 16. Auto in-flight resume | NEG — document restart behavior |
| N17 | 17. Non-template data cleaning | NEG |
| N18 | 18. Perf/load testing | NEG — document as accepted limitation |
| N19 | 19. Advanced DR/SLA | NEG — basic backups only per §7.2 |

---

## Track P — Production & Acceptance Evidence

| ID | Check |
|----|-------|
| P1 | Production endpoints live on `dashboard.horizonafrica.co.za` (root project, not legacy `horizon-africa/dashboard`) |
| P2 | Signed webhook POST works; unsigned behavior documented (soft vs enforced mode; `META_APP_SECRET` presence) |
| P3 | Fresh production executions for W2/W3/W7 schedulers |
| P4 | Meta: WABA approved, phone CONNECTED/GREEN, templates `telkom_fibre_packages` + `telkom_reengagement` APPROVED |
| P5 | Delivery-status callbacks persist (`message_delivery_failures` + interaction status) |
| P6 | §10.3 pilot readiness checklist produced (leads segment count, enrolment plan, rollback steps) — execution itself is MANUAL |
| P7 | §2/§7.2: Supabase Pro plan + daily backup schedule evidence — MANUAL confirm |
| P8 | §12 client inputs: OWD template bulk upload round-trip works |
| P9 | §13.1 admin access inventory (dashboard, Supabase, n8n, Vercel, Meta) — MANUAL |

---

## Execution order

1. **Preflight:** env vars, dev server, Supabase, Meta, n8n MCP reachable.
2. **Track D** (schema) → **Track W** (workflow evidence) → **Track C** (engine
   lifecycle) → **Track U** (UI walks) → **Track N** (negatives) → **Track P**
   (production smoke + sign-off list).
3. Every matrix row gets `PASS/FAIL/PARTIAL/MANUAL` + evidence pointer in the report.
4. Every FAIL gets root cause + recommended fix; every PARTIAL gets a stated gap and
   whether it blocks acceptance.

## Automation split

- `tests/scope-freeze-coverage.mjs` automates Tracks C, D, N, the API/DB parts of W,
  and machine-checkable parts of P. Playwright covers Track U (headed for visibility).
- MANUAL items are emitted as a sign-off checklist in the report — never auto-passed.

## Known risks / notes

- n8n workflow executions are asynchronous — all webhook-driven checks poll with
  generous timeouts and exact `incoming_message`/`wamid` matching.
- Prior flaky patterns already accounted for: dev-server cold compile (warm routes
  first), selector ambiguity (scoped locators), timestamp skew (exact match +
  tolerance).
- Manual sign-off items expected: Supabase Pro/backup drill, pilot execution,
  ownership transfer, Chatwoot live-fire, webhook signature enforcement flip.
