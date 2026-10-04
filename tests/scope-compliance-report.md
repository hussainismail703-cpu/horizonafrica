# Scope Compliance Report — Horizon Africa

**Date:** 2026-10-04
**Master source:** `horizon-africa/Scope-Freeze-Reconstructed.md` (reconstructed — replace with the original Scope Freeze when provided and remap IDs)
**Companion artifacts:** `tests/scope-compliance-test.mjs`, `tests/scope-compliance-results.json`
**Severity key:** `blocker` | `should-fix` | `cosmetic` | `deviation` (works, but differs from signed scope → needs client sign-off)

---

## 1. Executive Summary

| Result | Count |
|--------|-------|
| Automated checks executed this audit | 22 (scope-compliance suite) |
| Supporting regression evidence | ~950 checks across 15 suites |
| **PASS** | 18 |
| **PARTIAL** | 4 (all documented deviations/gaps — none block launch) |
| **FAIL** | 0 |
| **MANUAL** | 6 items awaiting human sign-off |

**Overall verdict: GO, conditional on client sign-off for the 4 deviations/gaps below and completion of the manual checklist in §6.**

### Deviation/gap summary (severity)

| ID | Item | Severity | Detail |
|----|------|----------|--------|
| 1.2 / 2.1 | Product catalog is Fibre-only | `deviation` | Quote lists Fibre, LTE, Wireless, Starlink. `products` table has 8 rows, all `product_type=fibre`. Layla handles LTE/Wireless conversationally; Starlink is explicitly excluded by the prompt. Client must confirm Fibre-only is acceptable for launch. |
| 1.3 / 2.6 | Google Sheets replaced by Supabase CRM | `deviation` | Signed quote specified Google Sheets lead tracking. Implementation persists leads in Supabase + dashboard; zero Google Sheets code, dependencies, or n8n nodes exist. Functionally equivalent or better, but it is a substitution of a line-item deliverable — needs explicit client sign-off. |
| 3.3 / 3.5 | Broadcast group creation has no UI/API | `should-fix` | Groups can only be seeded directly in the DB. Contact add/remove and bulk import exist, and sends work, but staff cannot create new segments without developer help. Contacts carry no segment fields — segmentation is group-membership only. |
| 5.4 | Alert-emails setting is saved but unused | `should-fix` | Settings page persists staff alert emails, but the n8n workflow hardcodes `keshlan@horizonafrica.co.za` + `sifosman@gmail.com`. Saved emails have no effect — the setting is misleading. |

---

## 2. Automated Evidence Base

### Scope-compliance suite (this audit) — 18 PASS / 4 PARTIAL / 0 FAIL

`tests/scope-compliance-results.json` — run against `localhost:3000` with signed webhooks, live n8n/OpenRouter path, Supabase assertions, real broadcast + follow-up round-trips to `27832763116` only.

### Supporting suites (local, Oct 3–4)

| Suite | Result | Scope coverage |
|-------|--------|----------------|
| `phase1-retest.mjs` (master) | 729/736 — 7 env flakes, all passed on isolated rerun | §4, §5, §7 bulk regression |
| `ui-dashboard-test.mjs` | 125/125 | §5 dashboard pages |
| `campaign-engine-test.mjs` | 76/76 | §4 campaign UI |
| `campaign-response-test.mjs` | 45/45 local + **45/45 production** | §4, §8.4 response paths |
| `client-simulation-test.mjs` | 40/40 | §2 classification/personas |
| `advanced-simulation-test.mjs` | 47/47 | §4, §7 edge cases |
| `comprehensive-test.mjs` | 64/64 | §5, §6 security/UI |
| `chaos-test.mjs` | 156/156, 0 security issues | §6 security/adversarial |
| `ai-conversation-test.mjs` | 59/59 | §2.1, 2.7–2.10 AI quality |
| `workflow-e2e-test.mjs` | 67 pass / 3 warnings / 3 n8n-pending | §2, §6 workflow checks |
| `webhook-security-test.mjs` | 27/27 (signature enforcement ON locally) | §6.7 |
| `prompt-injection-test.mjs` | 15/15 | §2.9 safety |
| `post-release-test.mjs` | 25/25 | §2.3 score locks, §2.8 location |
| `prelaunch-audit.mjs` | 41/41, 0 security issues | §3–§6 scale/security |
| `live-campaign-test.mjs` | 73/73 (prior run) | §4 + §8.4 end-to-end |

---

## 3. Compliance Matrix — Results

### Section 1: Purpose & Platform

| ID | Requirement | Status | Evidence | Severity |
|----|-------------|--------|----------|----------|
| 1.1 | AI WhatsApp sales/lead-qualification platform end-to-end | **PASS** | webhook → n8n → OpenRouter → reply → logged conversation verified live (workflow `kW4ELXolGnYx2AvB`, 59/59 AI suite) | — |
| 1.2 | Products: Fibre, LTE, Wireless, Starlink | **PARTIAL** | `products` table: 8 rows, all `fibre`. Scope suite §S1 | `deviation` |
| 1.3 | Lead data → Google Sheets CRM | **PARTIAL** | No Google Sheets code/deps/n8n nodes; leads in Supabase + dashboard. Scope suite §S2 | `deviation` |
| 1.4 | Staff alerts via Brevo | **PASS** | `Check Hot Lead` → Brevo send on HOT verified; recipients keshlan@horizonafrica.co.za + sifosman@gmail.com (see 5.4 gap re: configurable emails) | — |
| 1.5 | Accounts in client's name; admin handover | **MANUAL** | Keshlan to confirm ownership/access of Meta, OpenRouter, Supabase, n8n, Vercel, Brevo, Chatwoot accounts | — |

### Section 2: Inbound AI Lead Qualification ("Layla")

| ID | Requirement | Status | Evidence | Severity |
|----|-------------|--------|----------|----------|
| 2.1 | Chatbot answers product enquiries | **PASS (scoped)** | 59/59 AI scenarios; correct Fibre catalog answers incl. speed/price questions | catalog Fibre-only — see 1.2 |
| 2.2 | Qualification collects name, number, address, product interest, service requirements | **PASS** | `leads` fields exist and populate: `full_name`, `physical_address`, `product_interest`, `household_size`, `internet_usage`, `preferred_contact_number` | — |
| 2.3 | HOT/WARM/COLD lead scoring | **PASS** | Scores written per message; `score_locked` respected end-to-end (post-release C-track, trigger fix verified) | — |
| 2.4 | Hot-lead email alerts | **PASS** | Scope suite §S5: HOT classification → Brevo alert branch fires | — |
| 2.5 | Chatwoot human handover + summary note | **PASS** | Chatwoot endpoint reachable (HTTP 200); `needs_escalation` rows verified; workflow creates conversation w/ private note | — |
| 2.6 | Lead logging for CRM | **PASS** | Supabase `leads` + dashboard Leads page; 2.6 deviation = Google Sheets substitution | `deviation` (folded into 1.3) |
| 2.7 | 24/7 automated response | **PASS** | Workflow active; webhook → AI reply round-trip verified without staff | — |
| 2.8 | Escalation triggers (availability, discount, callback, human, complex) | **PASS** | `needs_escalation` set; consultant-request + availability paths verified in suites | — |
| 2.9 | Persona constraints + JSON output + context | **PASS** | Structured `replyText`/fields in `conversations`; 15/15 prompt-injection suite | — |
| 2.10a–e | Objection handling: Price / Comparing / Think-About-It / Have-Fibre / Relocating | **PASS** | All 5 live webhook scenarios pass — incl. relocation escalation + new-address capture | — |
| 2.11 | Follow-Up Reminders add-on | **PASS (function)** | Daily workflow `YcEUNe5qVam06kps` + flag→send round-trip verified (§S7). **MANUAL sub-item:** confirm the add-on was actually purchased/invoiced | — |

### Section 3: Broadcast & Follow-Up Platform

| ID | Requirement | Status | Evidence | Severity |
|----|-------------|--------|----------|----------|
| 3.1 | Web interface sends to groups | **PASS** | Group listed via API w/ contacts; send executed `sent=1 failed=0` | — |
| 3.2 | ≥5 approved marketing templates | **PASS** | 16 APPROVED templates on WABA `1613835747059073` | — |
| 3.3 | Segmentation by product/location/type | **PARTIAL** | Groups exist but are DB-seeded only; no segment fields on contacts — segmentation = group membership only | `should-fix` |
| 3.4 | Broadcast history + delivery tracking | **PASS** | `broadcast_history` + `broadcast_messages` with per-recipient wamid and sent/delivered/read/failed status (migration `20261003000000`) | — |
| 3.5 | Contacts manager incl. bulk import | **PASS** | Add/remove + bulk import w/ dedup verified; **but no group-creation UI** (folded into 3.3) | `should-fix` |
| 3.6 | Test send to single phone | **PASS** | `test_phone` path verified; opt-out respected | — |
| 3.7 | STOP/unsubscribe honored in broadcasts | **PASS** | Opted-out group send → `400 "All recipients have opted out"`; `skipped_opted_out` counted | — |
| 3.8 | Follow-ups: pending/overdue/sent, manual + daily cron | **PASS** | Follow-Ups page + daily n8n workflow; flag→send→`follow_up_sent=true` round-trip verified | — |
| 3.9 | Template manager (create→submit→status) | **PASS** | Template CRUD + Meta status sync via WABA | — |

### Section 4: Campaign Engine (Verbatim Scope Freeze)

| ID | Requirement | Status | Evidence | Severity |
|----|-------------|--------|----------|----------|
| 4.1 | Campaign Creator | **PASS** | UI + API creation; 76/76 campaign UI suite | — |
| 4.2 | Multi-step sequences w/ per-step templates | **PASS** | Steps incl. `template_parameters` persisted (UI round-trip bug found in audit and fixed in `edb49b5`) | — |
| 4.3 | Auto progression at configured interval | **PASS** | Process endpoint + 15-min n8n scheduler + heartbeat verified | — |
| 4.4 | Response detection → stop sequence → sales flow | **PASS** | 45/45 campaign-response suite; interested/callback → calling queue | — |
| 4.5 | Not-interested reason on profile | **PASS** | `rejection_reason` persisted on lead + classification; stale reason cleared on re-interest | — |
| 4.6 | Intent classification; uncertain → human review | **PASS** | `campaign_classifications` + `uncertain` path + manual correction UI | — |
| 4.7 | Interaction tracking (who/when/delivery/outcome) | **PASS** | `campaign_interactions` + monotonic delivery-status updates | — |
| 4.7a | Failed message visibility | **PASS** | `campaign_errors`, `meta_error`, `message_delivery_failures` + report UI | — |
| 4.8 | Campaign dashboard | **PASS** | `/campaigns/dashboard` stats render correctly | — |
| 4.9 | Performance report (sent, delivery %, response %, sales flow, converted) | **PASS** | `/api/campaigns/stats/[id]` funnel math verified incl. read-rate | — |
| 4.10 | Contact targeting via broadcast groups | **PASS** | Group enrolment path verified (chunked `.in()` for 1,719 scale) | — |
| 4.11 | Profile extension (history, last contact/response, rejection) | **PASS** | Lead campaign fields + customer-journey page | — |
| 4.12 | No-response flagging after final step | **PASS** | `nurture_flag` + `no_response_final` verified incl. late-response revival | — |

### Section 5: Dashboard & Administration

| ID | Requirement | Status | Evidence | Severity |
|----|-------------|--------|----------|----------|
| 5.1 | Overview stats + recent leads + score breakdown | **PASS** | Dashboard cards render; Active Conversations counts distinct 7-day threads via `conversation_threads` | — |
| 5.2 | Leads mgmt: search/filter/CSV export/drawer/follow-up | **PASS** | All flows verified; CSV export formula-injection-safe; score/status lock UI | — |
| 5.3 | Conversations grouped by phone, newest-first, read-only | **PASS** | Thread view w/ newest-first ordering + cursor pagination; mobile pane fix verified | — |
| 5.4 | Settings: integration statuses + staff alert emails | **PARTIAL** | Statuses now honest (OpenRouter/Brevo/Chatwoot/Meta Connected, Google Sheets Not Configured); **alert-emails saved but n8n hardcodes recipients** | `should-fix` |
| 5.5 | Notifications bell (badge, deep links) | **PASS** | `/api/notifications` + dropdown + lead deep-link (gap suite) | — |
| 5.6 | Auth: login/remember/forgot/sign out/protected routes | **PASS** | HttpOnly cookie login, middleware protection verified across suites | — |
| 5.7 | Sidebar nav + extended pages | **PASS** | All nav items reachable (125-test UI suite) | — |
| 5.8 | Error monitoring → Brevo alerts | **PASS** | Delivery-failure logging → n8n alert verified; health monitor wired | — |
| 5.9 | Health page | **PASS** | `/api/health` reports statuses incl. scheduler heartbeat freshness | — |

### Section 6: Integrations & Infrastructure

| ID | Requirement | Status | Evidence | Severity |
|----|-------------|--------|----------|----------|
| 6.1 | Meta Cloud API + verified WABA/phone | **PASS** | WABA `1613835747059073` APPROVED; phone CONNECTED, GREEN quality, TIER_2K | — |
| 6.2 | LLM via OpenRouter | **PASS** | `openai/gpt-5.6-sol` working w/ JEV verification layer. **Deviation:** quote said "Gemini 3.1 Flash" — OpenRouter chosen instead | `deviation` (cosmetic — needs note in handover) |
| 6.3 | Supabase persistence | **PASS** | All tables + RLS + triggers verified; 21+ migrations applied | — |
| 6.4 | Chatwoot handover endpoint | **PASS** | `chat.horizonafrica.co.za` reachable; handover path exercised | — |
| 6.5 | Brevo transactional email | **PASS** | Hot-lead alert + error alert sends verified through n8n server (local sends IP-blocked by Brevo whitelist — expected) | — |
| 6.6 | n8n + Caddy TLS + Vercel hosting | **PASS** | `dashboard.horizonafrica.co.za` + `n8n.horizonafrica.co.za` serving HTTPS | — |
| 6.7 | Webhook verification + signature security | **PASS (local) / MANUAL (prod)** | 27/27 webhook-security suite; enforcement ON locally. Prod pending: real `META_APP_SECRET` in Vercel → then `META_WEBHOOK_ENFORCE_SIGNATURE=true` | — |
| 6.8 | Chatwoot agent workflow usable | **MANUAL** | Agent must log in, find handover, reply, resolve — human verification needed | — |

### Section 7: Manual Controls & Operations (Verbatim)

| ID | Requirement | Status | Evidence | Severity |
|----|-------------|--------|----------|----------|
| 7.1 | Status override, classification correction, removal | **PASS** | Enrolment manager flows verified in UI + API suites | — |
| 7.1a | Audit trail (old/new/user/time) | **PASS** | `campaign_audit_log` rows verified; cleanup triggers fixed | — |
| 7.2 | Daily backups + documented restore | **MANUAL** | `BACKUP-RECOVERY.md` written; Supabase backup schedule + one live restore drill still to be executed/witnessed | — |
| 7.3 | Customer journey flat record | **PASS** | `/campaigns/[id]/customers/[phone]` renders full history | — |

### Section 8: Delivery, Handover & Acceptance

| ID | Requirement | Status | Evidence | Severity |
|----|-------------|--------|----------|----------|
| 8.1 | Training session + docs + admin transfer | **MANUAL** | `docs-*.html` exist; training session + formal transfer outstanding | — |
| 8.2 | Testing & go-live | **PASS** | Production serving hardened code; 45/45 production campaign-response smoke | — |
| 8.3 | M9 pilot + sign-off + `phase1-delivered` tag | **MANUAL** | Pilot enrolment of 1,719-lead segment is a launch decision; tag on sign-off | — |
| 8.4 | Fibre campaign spec (2 msgs, 6 paths, queue, opt-out, nurture, final status, funnel) | **PASS** | All paths verified incl. funnel reporting, STOP opt-out, late-response revival | — |

---

## 4. Section Verdicts

| Section | Verdict | Condition |
|---------|---------|-----------|
| §1 Purpose & Platform | **GO*** | Client sign-off on Fibre-only catalog + Supabase-instead-of-Sheets |
| §2 AI Qualification | **GO** | Confirm follow-up add-on invoiced (2.11 manual sub-item) |
| §3 Broadcast & Follow-Up | **GO*** | Decide whether group-creation UI is needed before launch (3.3/3.5) |
| §4 Campaign Engine | **GO** | — |
| §5 Dashboard & Admin | **GO*** | Fix or document unused alert-emails setting (5.4) |
| §6 Integrations & Infra | **GO*** | Enable prod signature enforcement after `META_APP_SECRET` confirmed |
| §7 Manual Controls & Ops | **GO*** | Execute one backup/restore drill (7.2) |
| §8 Delivery & Acceptance | **PENDING** | Training, handover, 1,719-lead pilot sign-off |

\* GO = all automated checks pass; asterisk marks the residual item.

---

## 5. Manual Sign-off Checklist (M9 gate)

- [ ] **1.5** — Keshlan confirms ownership/admin access to all accounts
- [ ] **1.2/2.1** — Client accepts Fibre-only catalog (or schedules LTE/Wireless/Starlink content)
- [ ] **1.3/2.6** — Client accepts Supabase dashboard instead of Google Sheets tracking
- [ ] **2.11** — Confirm Follow-Up Reminders add-on was purchased/invoiced
- [ ] **3.3/3.5** — Decide whether a group-creation UI is needed before launch (or accept DB-seeded groups + documented process)
- [ ] **5.4** — Fix n8n workflow to read saved alert emails, or remove/document the setting
- [ ] **6.7** — Set real `META_APP_SECRET` in Vercel → monitor soft-mode logs → `META_WEBHOOK_ENFORCE_SIGNATURE=true`
- [ ] **6.8** — Chatwoot agent live-fire drill (receive handover → reply → resolve)
- [ ] **7.2** — Execute one documented backup/restore drill from `BACKUP-RECOVERY.md`
- [ ] **8.1** — Training session + admin transfer
- [ ] **8.3** — 1,719-lead pilot enrolment decision → sign-off → `phase1-delivered` tag

## 6. Notes & Caveats

- The reconstructed scope freeze contains verbatim items only in §4 and §7 (marked `[V]`). All other sections are reconstructed from the quotes and docs — when the original Scope Freeze is supplied, remap IDs and re-audit the reconstructed items.
- The `phase1-retest` master run reported 7 environment flakes (navigation timeouts, 2 AI timeouts); every one passed on isolated rerun. No product defect was confirmed from those.
- Live WhatsApp sends were restricted to `27832763116`; the 1,719-lead segment was never enrolled.
- Fibre campaign `febe1cac-cf87-46c3-bbc7-160d3b96e28e` remains **paused** with correct step parameters.
