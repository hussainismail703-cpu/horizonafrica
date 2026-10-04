# Scope Compliance Audit Plan — Horizon Africa

**Master source:** `Layla Phase 1 Scope Freeze.txt` (the real Scope Freeze,
Q-2026-0825-HC-CAMPAIGN — supersedes the earlier reconstruction, which has been
removed).

**Acceptance checklist (per §10.2):** Phase 1 is delivered when every feature in
**Section 4** (campaign engine, 4.1–4.12) and **Section 7** (extended controls,
7.1–7.3) passes its acceptance criterion, plus the controlled pilot (§10.3).

**Purpose:** Verify the software is complete and working against every
scope-freeze item, then produce a compliance report with evidence per item.

**Statuses:** `PASS` | `FAIL` | `PARTIAL` | `MANUAL` (human sign-off) | `N/A`

---

## 1. Verification Method Key

| Method | Tooling |
|--------|---------|
| `SCHEMA` | Supabase MCP / REST SQL inspection of columns, RLS, triggers, indexes |
| `N8N` | n8n MCP `get_workflow` / `search_executions` on live workflows |
| `META` | Meta Graph API (WABA templates, phone status, messaging tier) |
| `SUITE` | Existing automated test suite (see §4 for mapping) |
| `NEW-TEST` | Checks in `tests/scope-compliance-test.mjs` (S1–S13) |
| `API` | Authenticated HTTP call to local/production API |
| `UI` | Headed/headless Playwright check |
| `PROD` | Production smoke test at `https://dashboard.horizonafrica.co.za` |
| `CODE` | Deterministic inspection of source files/migrations |
| `MANUAL` | Cannot be automated — listed for sign-off |

---

## 2. Compliance Matrix — §4 Phase 1 Deliverables (ACCEPTANCE ITEMS)

| ID | Requirement | Method | Expected evidence |
|----|-------------|--------|-------------------|
| 4.1 | Campaign Creator — name, objective, start/end date, target via existing contact/broadcast system | SUITE + API | campaign CRUD; 76/76 campaign UI suite |
| 4.2 | Multi-Step Sequences — per-step templates, reconfigurable without code | SUITE | steps saved incl. `template_parameters` round-trip |
| 4.3 | Automatic Sequence Progression at configured interval | SUITE + N8N | process endpoint + 15-min n8n scheduler + heartbeat |
| 4.4 | Response Detection — response stops sequence, routes to sales flow, response/time/outcome recorded | SUITE | enrolment exits `active`; classification stored; calling queue entry |
| 4.5 | "Not Interested" Reason Capture — price / already has service / not needed / not now / needs more info / competitor / not eligible / other | NEW-TEST S11 + SUITE | all 8 reasons in `classification.ts`; `rejection_reason` persisted |
| 4.6 | Intent Classification — interested / not interested / already has service / needs information / no response / other; uncertain → human review (~85–90%) | NEW-TEST S11 + SUITE | all categories; `uncertain` + correction path |
| 4.7 | Interaction Tracking — who/when/delivery/response/outcome + failed-message visibility (auto-retry excluded) | SCHEMA + SUITE | `campaign_interactions`, `campaign_errors`, `meta_error`, `message_delivery_failures`, report UI |
| 4.8 | Campaign Dashboard — active campaigns, contacts per step, progress | SUITE | `/campaigns/dashboard` renders correctly |
| 4.9 | Performance Report — sent, delivery rate, response rate, entered sales flow, converted (per §8 definitions) | SUITE + NEW-TEST S12 | `/api/campaigns/stats/[id]` math per §8 |
| 4.10 | Contact List Targeting via existing broadcast system | SUITE + NEW-TEST S6 | group enrolment path; chunked `.in()` for scale |
| 4.11 | Customer Profile Extension — campaign history, last contact date, last response, rejection reason | SCHEMA + NEW-TEST S8 + UI | lead campaign fields + journey page |
| 4.12 | No-Response Flagging after final step | SUITE | `nurture_flag` + `no_response_final` |

## 3. §5–§6 — Simultaneous Campaigns & Duplicate Prevention

| ID | Requirement | Method | Expected evidence |
|----|-------------|--------|-------------------|
| 5 | Multiple simultaneous campaigns; manual per-list targeting (auto-segmentation is Phase 2) | NEW-TEST S13 + SUITE | `(campaign_id, phone_number)` uniqueness allows parallel enrolment; multi-campaign suite pillar |
| 6 | Duplicate sends prevented via sequence/send tracking (cross-campaign conflicts are Phase 2) | NEW-TEST S13 + SCHEMA | unique `(enrol_id, step_number)` outbound index + unique `meta_message_id` inbound index; concurrent-run suite evidence |

## 4. §7 Extended Controls (ACCEPTANCE ITEMS)

| ID | Requirement | Method | Expected evidence |
|----|-------------|--------|-------------------|
| 7.1 | Manual status override, classification correction (stored, feeds prompt tuning), campaign removal | SUITE + NEW-TEST S11 | enrolment manager + corrections API/UI |
| 7.1a | Audit trail on manual changes — original value, amended value, user, date/time | SCHEMA + SUITE | `campaign_audit_log` rows |
| 7.2 | Automated daily backups beyond free-tier limit (Supabase Pro) + documented restore path tested once at handover | MANUAL + CODE | Supabase Pro plan + daily backup schedule verified in dashboard; `BACKUP-RECOVERY.md`; one live restore drill |
| 7.3 | Customer Journey flat record — campaign → customer → what happened (no funnels required) | SUITE | `/campaigns/[id]/customers/[phone]` |

## 5. §8 Metric Definitions (agreed)

| Metric | Definition | Method | Evidence |
|--------|-----------|--------|----------|
| Response | WhatsApp inbound detected | SUITE | `campaign_detection.ts` + inbound interactions |
| Entered sales flow | Routed out of sequence into sales flow | SUITE | classification → calling queue |
| Conversion | lead `status='converted'` | NEW-TEST S12 + CODE | stats conversion query |
| Delivery rate | delivered / sent | NEW-TEST S12 | `campaign-stats.ts` math (read counts as delivered) |
| Read rate | read / delivered | NEW-TEST S12 | `campaign-stats.ts` math |

## 6. §3 Production Baseline (already built — verify working, not re-billed)

| Baseline item | Method | Status check |
|---------------|--------|--------------|
| WhatsApp Business API send/receive | SUITE + META | webhook + sends verified; phone CONNECTED/GREEN/TIER_2K |
| Layla AI (OpenRouter GPT-5.6-sol) | SUITE | 59/59 AI conversation suite |
| Dashboard + Supabase Auth | SUITE | 125/125 UI suite |
| Lead management + CSV export + bulk upload | SUITE | lead flows; formula-safe CSV |
| Conversation history viewer | SUITE | thread view verified |
| Broadcast system | NEW-TEST S6 | groups, send, opt-out |
| Template management | SUITE + META | 16 approved templates |
| Follow-up reminders | NEW-TEST S7 | schedule → send round-trip |
| Product catalog manager | NEW-TEST S1 | active products present |
| Reports & analytics | SUITE | reports pages verified |
| Health monitoring | SUITE | `/api/health` + heartbeat |
| Lead scoring HOT/WARM/COLD | SUITE | scores + lock protection |
| Objection detection (5 types) | NEW-TEST S3 | live scenarios |
| Escalation + Chatwoot handover | NEW-TEST S4 | endpoint + workflow evidence |
| Hot lead & escalation emails (Brevo) | NEW-TEST S5 | HOT → alert branch |
| Missed message recovery | N8N | workflow executions verified |
| Error alert notifications | N8N + SUITE | delivery-failure → alert verified |
| 15 approved templates | META | 16 approved |

## 7. §9 Out-of-Scope Confirmations

| Item | Expected | Check |
|------|----------|-------|
| §9.3 Google Sheets sync | absent | NEW-TEST S2 — confirm no Google Sheets code/nodes |
| Other §9 items (mobile app, CRM syncs, SMS/email channels, IVR, AI training, auto-segmentation, conflict prevention, nurture, journey timeline, pause/resume restore, self-learning, auto-retry, campaign CSV, workflow resume, data cleaning, perf testing, DR SLA) | absent or later-phase | CODE/review — extras delivered are enhancements, not violations |

## 8. §10/§13 Acceptance & Contract (manual)

| ID | Requirement | Method |
|----|-------------|--------|
| 10.3 | Controlled pilot before sign-off | MANUAL — 1,719-lead pilot decision |
| 13.1 | Ownership/admin access transfer | MANUAL |
| 13.2 | 1-month warranty period | MANUAL — operational |
| §2 | Supabase Pro subscription (enables §7.2 daily backups) | MANUAL — verify plan active |

---

## 9. Execution Plan

### Phase 1 — Evidence gathering (no sends)
1. `.env.local`, dev server, Supabase service access, Meta Graph, n8n MCP.
2. `SCHEMA` dump → map to §4.5, §4.7, §4.11, §5, §6, §7.1a.
3. `N8N` export live workflows → scheduler, follow-ups, error alerts, handover.
4. `META`: WABA templates, phone status, tier.
5. `CODE`: `classification.ts` taxonomy (§4.5/§4.6), `campaign-stats.ts` metric
   math (§8), migration constraints (§5/§6).

### Phase 2 — Automated suites (local)
| Suite | Covers |
|-------|--------|
| `tests/phase1-retest.mjs` | bulk of §4, §7 + regressions |
| `tests/ai-conversation-test.mjs` | §3 baseline AI quality |
| `tests/webhook-security-test.mjs` | §3 baseline webhook security |
| `tests/post-release-test.mjs` | score locks, location, Jev chain |
| `tests/prelaunch-audit.mjs` | scale/security |
| `tests/scope-compliance-test.mjs` | S1–S13 (this audit's new checks) |
| `tests/live-campaign-test.mjs --auto-confirm --local-only` | §4 end-to-end; real sends to `27832763116` only |

### Phase 3 — Production smoke
- `TEST_TARGET=https://dashboard.horizonafrica.co.za node --env-file=.env.local tests/campaign-response-test.mjs`.
- Signature-enforcement status: confirm `META_APP_SECRET` in Vercel; note whether
  `META_WEBHOOK_ENFORCE_SIGNATURE=true` is live.
- Follow-ups + scheduler n8n executions fresh; login visual pass.

### Phase 4 — Manual sign-off list
§2 (Supabase Pro), §7.2 (backup schedule + restore drill), §10.3 (pilot),
§13.1 (ownership transfer), Chatwoot agent live-fire, plus product gaps noted
outside the acceptance list (broadcast group-creation UI, alert-emails setting).

---

## 10. Deliverables

1. `tests/scope-compliance-test.mjs` — targeted checks S1–S13.
2. `tests/scope-compliance-report.md` — every matrix row with
   `PASS/FAIL/PARTIAL/MANUAL/N/A`, evidence pointer, gap severity,
   GO/NO-GO per section.
3. `Layla Phase 1 Scope Freeze.txt` is the master source (already in repo root).

## 11. Rules

- Real WhatsApp sends only to `27832763116`; never enroll real lead segments.
- Fibre campaign `febe1cac-…` stays paused; test data marked `[SCOPE-AUDIT]` and cleaned.
- Every FAIL gets root cause + recommended fix. Suspected gaps are verified, never assumed.
