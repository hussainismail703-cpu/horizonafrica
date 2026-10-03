# Phase 1 Acceptance Test Plan

**Project:** Layla Campaign Orchestration & Customer Lifecycle Engine — Phase 1
**Generated:** 29 September 2026
**Product-plan sources:** `Phase1-Implementation-Plan.md` (milestones M1–M9, acceptance checklist 4.1–4.12 and 7.1–7.3) and `Fibre-Lead-Re-Engagement-Campaign.md` (2-step re-engagement campaign spec)
**Status:** Draft — results section to be filled after the verification run.

---

## 1. Purpose

This document maps every Phase 1 product-plan acceptance criterion and every Fibre
Re-Engagement campaign rule to a concrete, executable verification. It serves as the
formal M8 test deliverable (`tests/phase1-e2e.md`-style) and the M9 acceptance
evidence base.

## 2. Scope

**In scope**

- All acceptance criteria from the implementation plan (4.1–4.12, 7.1–7.3).
- All behavioural rules from the Fibre campaign spec (message timing, max two
  messages, six response paths, calling queue qualification, opt-out, nurture
  pool, final outcomes, funnel reporting).
- Full local regression: every automated suite orchestrated by
  `tests/phase1-retest.mjs`, plus the standalone suites it does not drive
  (`webhook-security`, `prompt-injection`, `post-release`).
- Production smoke pass: `campaign-response-test.mjs` against
  `https://dashboard.horizonafrica.co.za` using simulated Meta webhooks.

**Out of scope**

- The 1,719-lead pilot enrolment — a launch decision requiring separate approval.
- Enabling `META_WEBHOOK_ENFORCE_SIGNATURE=true` in production (a post-verification
  operations step; soft-mode logging is already live).
- Real WhatsApp sends (Stage 5 / `--live`) — opt-in only, restricted to the test
  phone.

## 3. Prerequisites

| Item | Requirement |
|---|---|
| `.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`, `META_WABA_ID`, `META_API_VERSION`, `OPENROUTER_API_KEY`, `APP_SECRET`, `META_APP_SECRET`, `META_VERIFY_TOKEN` |
| Dev server | `npm run dev` responding at `http://localhost:3000/login` |
| Supabase | Project `gbchhzipbbxpvgtaheze` reachable with service key; all campaign tables present |
| Meta | Graph API reachable; WABA `1613835747059073`; campaign templates approved |
| n8n | `https://n8n.horizonafrica.co.za` webhook reachable; inbound AI workflow active |
| Test user | `test@horizonafrica.co.za` / `TestPass123!` (Supabase Auth) |
| Test data | Phone `27832763116` (lead 816) only; Fibre campaign `febe1cac-cf87-46c3-bbc7-160d3b96e28e` |

## 4. Requirement → Test Mapping

### 4.1 Scope-freeze acceptance criteria (Section 4)

| # | Criterion | Verified by |
|---|---|---|
| 4.1 | Campaign Creator — create, name, configure campaigns | `ui-dashboard-test.mjs` module 6; `campaign-engine-test.mjs` create/edit flows; `comprehensive-test.mjs` campaign lifecycle |
| 4.2 | Multi-Step Sequences — configurable steps, different templates | `campaign-engine-test.mjs` sequence builder; `campaign-response-test.mjs` C1–C4 step delivery |
| 4.3 | Auto Progression — next step sent at configured interval | `campaign-response-test.mjs` C1–C4 (delay enforcement), `advanced-simulation-test.mjs` process-endpoint tests |
| 4.4 | Response Detection — reply stops sequence, routes to sales flow | `campaign-response-test.mjs` A/B groups; `client-simulation-test.mjs`; `comprehensive-test.mjs` 3N |
| 4.5 | Not-Interested Capture — reason stored on profile | `campaign-response-test.mjs` (rejection_reason checks); lead-field assertions in gap tests |
| 4.6 | Intent Classification — every response classified; uncertain → review | `campaign-response-test.mjs` (45 cases); `ai-conversation-test.mjs` (59 cases); `client-simulation-test.mjs` |
| 4.7 | Interaction Tracking — who/when/delivery/response/outcome | `campaign-engine-test.mjs` UI; `webhook-security-test.mjs` delivery-status tests; `live-campaign-test.mjs` (when run) |
| 4.7a | Failed Message Visibility — failures logged and visible | `phase1-gap-test.mjs` delivery-failure tests; `webhook-security-test.mjs`; Error Monitoring UI checks |
| 4.8 | Campaign Dashboard — active campaigns, contacts per step | `ui-dashboard-test.mjs` module 9; campaign dashboard page tests |
| 4.9 | Performance Report — sent, delivery rate, response rate, entered sales flow, converted | `ui-dashboard-test.mjs` report module; `campaign-engine-test.mjs` report checks |
| 4.10 | Contact List Targeting — select contacts/groups via broadcast system | Enrolment group tests in `comprehensive-test.mjs` and `phase1-gap-test.mjs` |
| 4.11 | Customer Profile Extension — campaign history, last contact, last response, rejection reason | `ui-dashboard-test.mjs` customer journey + lead drawer; `phase1-gap-test.mjs` G-series |
| 4.12 | No-Response Flagging — non-responders flagged after final step | `campaign-response-test.mjs` D1–D2 (`no_response_final`, `nurture_flag`) |

### 4.2 Operations acceptance criteria (Section 7)

| # | Criterion | Verified by |
|---|---|---|
| 7.1 | Manual Controls — status override, classification correction, removal | `campaign-engine-test.mjs` enrolments manager; `comprehensive-test.mjs` correction flow |
| 7.1a | Audit Trail — old value, new value, user, timestamp | `campaign-engine-test.mjs` audit trail page; audit-log assertions in response suites |
| 7.2 | Basic Backups — documented backup + restore path | `BACKUP-RECOVERY.md` manual verification; `scripts/backup-db.mjs` run + manifest check (manual sign-off item) |
| 7.3 | Customer Journey View — campaign → customer → flat record | `ui-dashboard-test.mjs` journey tests; `phase1-gap-test.mjs` journey test |

### 4.3 Fibre campaign spec mapping

| Spec rule | Verified by |
|---|---|
| Day 1 initial message (`telkom_fibre_packages`, 4 price params) | `live-campaign-test.mjs` phases 1–2; `campaign-response-test.mjs` C-group timing |
| Day 3 final message (`telkom_reengagement`) only to non-responders | `campaign-response-test.mjs` C1–C4 delivery rules |
| Max two campaign messages per lead | `campaign-response-test.mjs` E1 (duplicate prevention), C-group |
| Response path: interested → calling queue | `campaign-response-test.mjs` A-group; queue assertions |
| Response path: callback requested → calling queue | `campaign-response-test.mjs` (callback cases); `client-simulation-test.mjs` |
| Response path: needs information → continue conversation, no queue | `campaign-response-test.mjs` A10 + related; `ai-conversation-test.mjs` Pillar A |
| Response path: not interested → reason recorded, removed | `campaign-response-test.mjs` not-interested cases; rejection_reason checks |
| Response path: no response → `no_response_final` + nurture pool | `campaign-response-test.mjs` D1–D2 |
| Response path: STOP → opted out globally, no further sends | `campaign-response-test.mjs` F4; `advanced-simulation-test.mjs` STOP tests |
| Every lead reaches a final recorded outcome | `advanced-simulation-test.mjs` P4 (responded→completed); campaign engine cleanup pass |
| Funnel reporting (leads → engaged → interested → queue) | `ui-dashboard-test.mjs` report module; campaign stats endpoint checks |
| Engagement vs sales-qualified distinction ("How much is 50 Mbps?" not queued) | `campaign-response-test.mjs` A10; `ai-conversation-test.mjs` |

## 5. Execution Stages

Mirror of `tests/phase1-retest.mjs` ordering; standalone suites run afterward.

| Stage | Content | Command/suite |
|---|---|---|
| 0 | Pre-flight (env vars, dev server, Supabase, tables, Meta, n8n, test user) | inline in `phase1-retest.mjs` |
| 1 | UI — headed Chromium | `ui-dashboard-test.mjs` (125), `campaign-engine-test.mjs` (76) |
| 2 | Campaign engine backend | `campaign-response-test.mjs` (45), `client-simulation-test.mjs` (40), `advanced-simulation-test.mjs` (47) |
| 3 | API + security | `comprehensive-test.mjs` (64), `chaos-test.mjs` (156) |
| 4 | n8n / AI pipeline | `ai-conversation-test.mjs` (59), `workflow-e2e-test.mjs` (68) |
| 5 | Live WhatsApp — **skipped** (opt-in `--live` only) | `phase1-retest.mjs --live` stage |
| 6 | New-feature gap tests | `phase1-gap-test.mjs` (41) |
| 7 | Regression cross-reference + cleanup | inline in `phase1-retest.mjs` |
| 8 | Standalone suites (not in master runner) | `webhook-security-test.mjs` (27), `prompt-injection-test.mjs` (15), `post-release-test.mjs` (25) |
| 9 | Production smoke | `TEST_TARGET=https://dashboard.horizonafrica.co.za campaign-response-test.mjs` (45) |

**Commands**

```bash
# Full local stack (no real sends)
node --env-file=.env.local tests/phase1-retest.mjs

# Standalone suites
node --env-file=.env.local tests/webhook-security-test.mjs
node --env-file=.env.local tests/prompt-injection-test.mjs
node --env-file=.env.local tests/post-release-test.mjs

# Production smoke
TEST_TARGET=https://dashboard.horizonafrica.co.za node --env-file=.env.local tests/campaign-response-test.mjs
```

## 6. Manual / Non-Automatable Checklist

| Item | How verified | Status |
|---|---|---|
| Meta template approval (`telkom_fibre_packages`, `telkom_reengagement`) | Meta API template list — both APPROVED | ✅ confirmed Sep 2026 |
| Backup taken + restore path documented | `BACKUP-RECOVERY.md`; latest DB backup manifest | ☐ manual sign-off |
| n8n scheduler heartbeats firing | `system_heartbeats` table; health endpoint | ☐ manual sign-off |
| Webhook signature enforcement enabled in prod | Vercel env `META_WEBHOOK_ENFORCE_SIGNATURE=true` after soft-mode log review | ☐ pending ops step |
| 1,719-lead pilot enrolment | Launch decision — **excluded from this test plan** | ☐ separate approval |

## 7. Pass/Fail and Sign-off Criteria

- **Pass:** all automated suites green; any failure either fixed (with rerun evidence)
  or documented as a test-harness flake with rationale.
- **Conditional pass:** flakes that re-run clean and are listed in the results section.
- **Fail / blocked sign-off:** any reproducible product defect affecting an acceptance
  criterion remains unresolved.

## 8. Data-Safety and Cleanup Rules

- Only test phone `27832763116` (lead 816) may be used; no other lead is enrolled or modified.
- The Fibre campaign is left **paused** after every run.
- All test enrolments, interactions, classifications, queue entries, opt-outs, and
  delivery-failure rows created during testing are removed by suite cleanup.
- No real WhatsApp sends occur without the explicit `--live` flag.
- Meta marketing frequency cap (error 131049) on the test number is a known
  environmental constraint — treated as a warning, not a product failure.

---

## 9. Results

_Verification executed 29 September 2026. Master retest plus targeted re-runs below._

### 9.1 Local full-stack run

| Stage | Suite | Passed | Failed | Notes |
|---|---|---|---|---|
| 0 | Pre-flight | 26 | 0 | All env, Supabase, Meta, webhook-verify checks green |
| 1 | UI — dashboard (headed) | 111/122 | 11 | Modules 9–10 failed late in a ~2 h headed run; **headless re-run: 125/125 PASS** — run-degradation flakes, not product defects |
| 1 | UI — campaign engine (headed) | 68/70 | 2 | "Campaign creation redirect" + "Customer Journey" — goto/timeout during long headed run; **re-run: 76/76 PASS** |
| 2 | Campaign response classification | 39/45 | 6 | C1, D1, F1–F4 failed while the Fibre campaign was corrupted (steps stripped of `template_parameters`, Meta error 132000). Root cause found in `campaign-detail.tsx` — sequence save omitted params. **Fixed; re-run: 45/45 PASS** |
| 2 | Client simulation | 40 | 0 | |
| 2 | Advanced simulation | 47 | 0 | |
| 3 | Comprehensive (UI+security+logic) | 64 | 0 | |
| 3 | Chaos / destructive | 156 | 0 | 0 security issues |
| 4 | AI conversation quality | 59 | 0 | Full webhook → n8n → OpenRouter → JEV pipeline |
| 4 | Workflow e2e | 67 | 0 | 3 warnings: external side effects needing manual confirmation |
| 6 | Gap tests | 41 | 0 | |
| 7 | Regression cross-reference | 2/3 | 1 | Failed only because campaign-response F3 failed in the corrupted window; resolved by the 45/45 re-run |
| 8 | webhook-security | 27 | 0 | Signature enforcement, replay/dedupe, message types, delivery statuses |
| 8 | prompt-injection | 15 | 0 | |
| 8 | post-release | 25 | 0 | Re-run clean: mobile pane, location, score-lock, JEV chain — 0 warnings |

### 9.2 Production smoke pass

| Suite | Passed | Failed | Notes |
|---|---|---|---|
| `campaign-response-test.mjs` → `https://dashboard.horizonafrica.co.za` | 45 | 0 | **Re-run 30 Sep 2026: 45/45 PASS** — all webhook classification groups, delivery rules, real-send paths (C1, F1–F4) and cleanup verified against production |

### 9.3 Failures and triage

| Failure | Root cause | Disposition |
|---|---|---|
| UI dashboard modules 9–10 (11 tests) | Resource degradation during ~2 h headed run — `/health` and `/settings` verified rendering correctly; headless re-run 125/125 | **Flake — closed** |
| Campaign-engine "Campaign creation redirect", "Customer Journey" | goto/redirect timeouts during ~4 h headed run | **Flake — re-run 76/76 PASS, closed** |
| Campaign-response C1, D1, F1–F4 | Real product bug: sequence-builder save dropped `template_parameters` (API replaces all steps), leaving Meta sends with missing params (error 132000). Fixed in `campaign-detail.tsx`; test suite also hardened to never mutate the real Fibre campaign | **Fixed — re-run 45/45 PASS** |
| Regression "classification fixes" | Secondary effect of the F3 failure above | **Resolved by re-run** |

### 9.4 Acceptance criterion status

| Criterion | Status | Evidence |
|---|---|---|
| 4.1 Campaign Creator | ✅ | ui-dashboard module 6, campaign-engine create flows, comprehensive lifecycle |
| 4.2 Multi-Step Sequences | ✅ | campaign-response C-group; template_parameters preserved after UI save fix |
| 4.3 Auto Progression | ✅ | C1–C4 delay enforcement, process endpoint (45/45 re-run) |
| 4.4 Response Detection | ✅ | A/B webhook groups, client-simulation 40/40 |
| 4.5 Not-Interested Capture | ✅ | rejection_reason verified on lead profile |
| 4.6 Intent Classification | ✅ | 45 + 59 + 40 classified cases, uncertain paths checked |
| 4.7 Interaction Tracking | ✅ | Interactions, delivery-status callbacks, Error Monitoring |
| 4.7a Failed Message Visibility | ✅ | `message_delivery_failures` + campaign errors verified (webhook-security 27/27) |
| 4.8 Campaign Dashboard | ✅ | Dashboard stats endpoint + UI |
| 4.9 Performance Report | ✅ | Report page, funnel breakdown, read-rate |
| 4.10 Contact List Targeting | ✅ | Group + manual enrolment paths |
| 4.11 Customer Profile Extension | ✅ | Customer journey page, lead campaign fields |
| 4.12 No-Response Flagging | ✅ | D1–D2: `no_response_final` + `nurture_flag` |
| 7.1 Manual Controls | ✅ | Enrolment overrides, classification correction |
| 7.1a Audit Trail | ✅ | Old/new values logged on every transition |
| 7.2 Basic Backups | ☐ | `BACKUP-RECOVERY.md` exists — manual sign-off item |
| 7.3 Customer Journey View | ✅ | Journey page verified |
| Fibre spec: Day 1 / Day 3 timing | ✅ | Steps verified: day 0 `telkom_fibre_packages`, day 2 `telkom_reengagement` |
| Fibre spec: max two messages | ✅ | E1 duplicate prevention |
| Fibre spec: six response paths | ✅ | interested, callback, needs-info, not-interested, no-response, STOP — all asserted |
| Fibre spec: calling-queue qualification | ✅ | Only interested/callback enter queue; price question excluded (A10) |
| Fibre spec: global opt-out | ✅ | STOP → `opt_out_list`, no further sends, all enrolments updated |
| Fibre spec: final outcomes | ✅ | Every terminal state covered incl. responded→completed cleanup |
| Fibre spec: funnel reporting | ✅ | Stats endpoint + report UI |

### 9.5 Conclusion

**All automated acceptance criteria pass.** Every retest failure was either a confirmed
test-harness flake (long-headed-run resource degradation, goto timeouts) that re-ran
clean, or the `template_parameters` product bug which was fixed and re-verified
(45/45 locally and 45/45 in production).

**Ready for sign-off pending two manual items:**

1. Backup/restore walkthrough per `BACKUP-RECOVERY.md` (documented, not executed).
2. Ops step: confirm `META_APP_SECRET` is set in Vercel, review soft-mode signature
   logs, then enable `META_WEBHOOK_ENFORCE_SIGNATURE=true`.

The 1,719-lead pilot enrolment remains a separate launch decision and is out of
scope for this acceptance pass.

---

## 10. Pre-Launch "Break the App" Audit (2026-10-03)

A second adversarial pass beyond the ~990-test suite, covering live-defect
verification, failure injection, launch-scale behaviour, session/UX edge cases,
and security extras. Full checklist: `tests/prelaunch-audit.md`.
Suite: `node --env-file=.env.local tests/prelaunch-audit.mjs`.

### 10.1 Defects confirmed and fixed

| Defect | Fix |
|--------|-----|
| Follow-ups cron was dead code (middleware 307 → n8n reported success-no-op; cookie client under RLS) | Middleware exemption + `createServiceClient` + n8n URL corrected — verified `processed=1` live |
| Bulk enrolment `.in()` URL overflow | Chunked at 200 + insert batches of 500 — 1,719 phones enrolled in 8.5s |
| Sequential campaign process vs 60s limit | Worker pool (8) + 45s budget, clean deferral |
| Duplicate-send race | Unique index + atomic claim-before-send; concurrent invocations verified single-send |
| Broadcast stuck `sending`, no `maxDuration` | Budget + concurrency + periodic progress + `partial` status |
| Delivered/read receipts discarded | `campaign_interactions` monotonic updates + `broadcast_messages` + history counters via trigger |
| CSV formula injection | `= + - @ \t \r` cells prefixed with `'` |
| Settings hardcoded wrong statuses | Brevo + Chatwoot now "connected" (live via n8n) |
| Unbounded conversations query | `conversation_threads` view + lazy `/api/conversations` per-thread load |
| `xlsx@0.18.5` CVEs | SheetJS 0.20.3 CDN tarball; Next 15.4.11→15.5.27 for critical advisory |
| Bulk import dupes | Payload dedupe + unique index + `ignoreDuplicates` upsert |
| Inbound wamid TOCTOU | `uq_campaign_interactions_meta_message_id` index — concurrent delivery now single-records |
| `broadcast_messages` RLS insert | Policy added (was silently dropping per-message rows) |

### 10.2 Results

**41 passed, 0 failed, 0 security, 11 manual.**

Notable evidence: 1,719-phone enrolment 8.5s; concurrent `process` calls → 1 send;
sent→delivered→read monotonic with no downgrade; broadcast counters via trigger;
15-webhook flood all 200s; `x-middleware-subrequest` does not bypass auth; no
secrets in client bundles; error responses don't leak internals.

### 10.3 Outstanding manual / accepted items

- Backup/restore drill, health→alert chain, Vercel env audit, signature
  enforcement rollout, token-revocation alerting, alert-email dedupe,
  deploy/migration rollback drill, POPIA workflows — see §D checklist in
  `tests/prelaunch-audit.md`.
- Accepted risks: no rate limiting on authenticated write endpoints
  (single-tenant internal tool); non-timing-safe Bearer compare; leads page
  and `/api/reports` remain unbounded-capped (documented for post-launch
  pagination); remaining `npm audit` findings need Next 16 or dev-only deps.

### 10.4 Go/No-Go

**GO, conditional on §10.3 manual items.** All client-blocking defects found
by the audit are fixed and verified green. The 1,719-lead enrolment path is
proven at full scale; the send path is race-safe, budgeted, and observable.
