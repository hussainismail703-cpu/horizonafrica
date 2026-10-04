# Scope Compliance Audit Plan — Horizon Africa

**Master source:** `horizon-africa/Scope-Freeze-Reconstructed.md` (reconstructed
scope freeze — replace with the original document when provided and remap IDs).

**Purpose:** Verify the software is complete and working against every
scope-freeze item, then produce a compliance report with evidence per item.

**Statuses:** `PASS` | `FAIL` | `PARTIAL` | `MANUAL` (human sign-off) | `N/A`

**Note on provenance:** items tagged `[V]` in the scope doc are verbatim from the
real Scope Freeze; all others are reconstructed and must be sanity-checked
against the original when it arrives.

---

## 1. Verification Method Key

| Method | Tooling |
|--------|---------|
| `SCHEMA` | Supabase MCP `list_tables` / SQL inspection of columns, RLS, triggers, views |
| `N8N` | n8n MCP `get_workflow` / `search_executions` on live workflows |
| `META` | Meta Graph API (WABA templates, phone status, messaging tier) |
| `SUITE` | Existing automated test suite (see §3 for mapping) |
| `NEW-TEST` | New checks added to `tests/scope-compliance-test.mjs` |
| `API` | Authenticated HTTP call to local/production API |
| `UI` | Headed/headless Playwright check |
| `PROD` | Production smoke test at `https://dashboard.horizonafrica.co.za` |
| `MANUAL` | Cannot be automated — listed for sign-off |

---

## 2. Compliance Matrix — Section 1: Purpose & Platform

| ID | Requirement | Method | Expected evidence |
|----|-------------|--------|-------------------|
| 1.1 | AI WhatsApp sales/lead-qualification platform end-to-end | SUITE + PROD | webhook → n8n → OpenRouter → reply → logged conversation |
| 1.2 | Products supported: Fibre, LTE, Wireless, Starlink | SCHEMA + NEW-TEST | `products` rows with non-Fibre lines; AI answers an LTE/Wireless/Starlink enquiry |
| 1.3 | Lead data → Google Sheets CRM tracking | N8N + UI | **SUSPECTED GAP/DEVIATION** — leads live in Supabase; Google Sheets shows "Not Configured". Record as PARTIAL/deviation → client decision |
| 1.4 | Staff alerts via Brevo | N8N + NEW-TEST | hot-lead email node fires; recipient list = configured staff emails |
| 1.5 | Accounts in client's name; admin handover | MANUAL | Keshlan confirms ownership/access |

## Section 2: Inbound AI Lead Qualification ("Layla")

| ID | Requirement | Method | Expected evidence |
|----|-------------|--------|-------------------|
| 2.1 | Chatbot answers product enquiries (4 lines) | SUITE (ai-conversation) + NEW-TEST | correct answers per product line; flag if catalog is Fibre-only |
| 2.2 | Qualification collects name, number, address, product interest, service requirements | SUITE + SCHEMA | `leads` fields populated: full_name, phone, physical_address, product_interest, household_size, internet_usage |
| 2.3 | HOT/WARM/COLD lead scoring | SUITE + SCHEMA | `lead_score` written; score-lock protection honored |
| 2.4 | Hot-lead email alerts | N8N + NEW-TEST | `Check Hot Lead` branch → Brevo send on HOT |
| 2.5 | Chatwoot human handover + private summary note | N8N + NEW-TEST | `Create Chatwoot Conversation` fires on `needsEscalation`; note contains name/phone/package/reason |
| 2.6 | Lead logging for CRM | SCHEMA + UI | leads rows + dashboard Leads page (deviation note vs Google Sheets) |
| 2.7 | 24/7 automated response | SUITE + N8N | workflow active, webhook responds without staff |
| 2.8 | Escalation triggers (availability, discount, callback, human, complex) | SUITE + NEW-TEST | `needs_escalation` set per trigger type |
| 2.9 | Persona constraints + JSON output + context window | N8N + SUITE | prompt inspection + consistent `replyText`/fields in `conversations` |
| 2.10a–e | Objection handling: Price / Comparing / Think-About-It / Have-Fibre / Relocating | NEW-TEST + SUITE pillar 3 | one webhook scenario per objection; B3 persists `preferred_package`/follow-up; B5 escalates + captures address |
| 2.11 | Follow-Up Reminders add-on | MANUAL (purchased?) + N8N | `Jz1na3ZFwZG1V0Vq` daily sender + `horizon_followup_v*` template approved |

## Section 3: Broadcast & Follow-Up Platform

| ID | Requirement | Method | Expected evidence |
|----|-------------|--------|-------------------|
| 3.1 | Web interface sends to Group A/B/C | SUITE (ui-dashboard broadcasts) | group dropdown + send works |
| 3.2 | ≥5 approved marketing templates | META | APPROVED marketing templates count ≥5 (16 seen) |
| 3.3 | Segmentation by product/location/customer type | SCHEMA + NEW-TEST | `broadcast_groups`/contacts carry segment fields usable in sends |
| 3.4 | Broadcast history + delivery tracking | SUITE + SCHEMA | `broadcast_history` + `broadcast_messages` w/ sent/delivered/read/failed |
| 3.5 | Contacts manager incl. bulk import | SUITE + API | add/remove contacts; bulk import dedupes |
| 3.6 | Test send to single phone | SUITE | test_phone path works, opt-out respected |
| 3.7 | STOP/unsubscribe honored in broadcasts | SUITE (gap/prelaunch) + API | `opt_out_list` excluded from broadcast sends |
| 3.8 | Follow-ups: pending/overdue/sent, manual + daily cron | SUITE + N8N + PROD | Follow-Ups page + daily workflow executions |
| 3.9 | Template manager (create→submit→status tracking) | SUITE + META | template CRUD + status sync |

## Section 4: Campaign Engine (Verbatim Scope Freeze)

| ID | Requirement | Method | Expected evidence |
|----|-------------|--------|-------------------|
| 4.1 | Campaign Creator | SUITE | campaign created via UI/API |
| 4.2 | Multi-step sequences w/ per-step templates | SUITE | steps saved incl. `template_parameters` |
| 4.3 | Auto progression at configured interval | SUITE + N8N | process endpoint + 15-min scheduler heartbeat |
| 4.4 | Response detection → stop sequence → sales flow | SUITE | enrolment leaves `active`; classification stored |
| 4.5 | Not-interested reason on profile | SUITE + SCHEMA | `rejection_reason` on lead/classification |
| 4.6 | Intent classification; uncertain → human review | SUITE | `campaign_classifications`; `uncertain` path exists |
| 4.7 | Interaction tracking (who/when/delivery/outcome) | SCHEMA + SUITE | `campaign_interactions` + delivery-status updates |
| 4.7a | Failed message visibility | SUITE + SCHEMA | `campaign_errors`, `meta_error`, `message_delivery_failures`, report UI |
| 4.8 | Campaign dashboard | SUITE | `/campaigns/dashboard` stats render |
| 4.9 | Performance report (sent, delivery %, response %, sales flow, converted) | SUITE + API | `/api/campaigns/stats/[id]` math correct |
| 4.10 | Contact targeting via broadcast groups | SUITE + API | group enrolment path |
| 4.11 | Profile extension (history, last contact/response, rejection) | SCHEMA + UI | lead campaign fields + journey page |
| 4.12 | No-response flagging after final step | SUITE | `nurture_flag` + `no_response_final` |

## Section 5: Dashboard & Administration (Reconstructed)

| ID | Requirement | Method | Expected evidence |
|----|-------------|--------|-------------------|
| 5.1 | Overview stats + recent leads + score breakdown | SUITE | dashboard cards render correct counts (distinct phones for conversations) |
| 5.2 | Leads mgmt: search/filter/CSV export/drawer/follow-up scheduling | SUITE | lead-table flows; CSV export is formula-injection safe |
| 5.3 | Conversations grouped by phone, newest-first, read-only | SUITE | conversation view + thread pagination |
| 5.4 | Settings: integration statuses + staff alert emails | UI + NEW-TEST | statuses accurate (not hardcoded wrong); alert emails save |
| 5.5 | Notifications bell (4 types, badge, deep links) | SUITE (gap) | `/api/notifications` + dropdown + lead deep-link |
| 5.6 | Auth: login/remember/forgot/sign out/protected routes | SUITE | auth flows + middleware protection |
| 5.7 | Sidebar nav + quick action + extended pages | SUITE | all nav items reachable |
| 5.8 | Error monitoring → Brevo alerts | N8N + NEW-TEST | error workflow active; alert on forced failure |
| 5.9 | Health page | SUITE | `/health` + `/api/health` report statuses incl. scheduler heartbeat |

## Section 6: Integrations & Infrastructure (Reconstructed)

| ID | Requirement | Method | Expected evidence |
|----|-------------|--------|-------------------|
| 6.1 | Meta Cloud API + verified WABA/phone | META | `CONNECTED`, `name_status` APPROVED, GREEN quality |
| 6.2 | OpenRouter GPT-5.6-sol (Gemini→OpenRouter deviation) | N8N + API | model string; working completions; record deviation vs "Gemini 3.1 Flash" in quote |
| 6.3 | Supabase persistence | SCHEMA | all tables + RLS policies |
| 6.4 | Chatwoot handover endpoint | NEW-TEST | `chat.horizonafrica.co.za` reachable; handover creates conversation |
| 6.5 | Brevo transactional email | N8N + NEW-TEST | recent successful sends |
| 6.6 | n8n + Caddy TLS + Vercel hosting | PROD | endpoints reachable over HTTPS |
| 6.7 | Webhook verification + signature security | SUITE (webhook-security) + PROD | GET handshake; HMAC enforced or soft-mode logged w/ plan to enforce |
| 6.8 | Chatwoot agent workflow usable | MANUAL | agent logs in, finds handover, replies, resolves |

## Section 7: Manual Controls & Operations (Verbatim)

| ID | Requirement | Method | Expected evidence |
|----|-------------|--------|-------------------|
| 7.1 | Status override, classification correction, removal | SUITE | enrolment manager flows |
| 7.1a | Audit trail (old/new/user/time) | SCHEMA + SUITE | `campaign_audit_log` rows on changes |
| 7.2 | Daily backups + documented restore | MANUAL + SCHEMA | Supabase backup schedule verified; `BACKUP-RECOVERY.md` restore drill executed once |
| 7.3 | Customer journey flat record | SUITE | `/campaigns/[id]/customers/[phone]` renders history |

## Section 8: Delivery, Handover & Acceptance

| ID | Requirement | Method | Expected evidence |
|----|-------------|--------|-------------------|
| 8.1 | Training session + docs + admin transfer | MANUAL | evidence/docs exist (`docs-*.html` count toward docs) |
| 8.2 | Testing & go-live | SUITE + PROD | production serving current code |
| 8.3 | M9 pilot + sign-off + `phase1-delivered` tag | MANUAL | pilot decision; tag exists when signed |
| 8.4 | Fibre campaign spec (2 msgs, 6 paths, queue, opt-out, nurture, final status, funnel) | SUITE (campaign-response/advanced/live) | all paths verified incl. report funnel |

---

## 3. Execution Plan

### Phase 1 — Evidence gathering (no sends)
1. `.env.local`, dev server, Supabase service access, Meta Graph, n8n MCP.
2. `SCHEMA` dump → map to 2.2, 3.3, 4.5, 4.7, 4.7a, 6.3, 7.1a.
3. `N8N` export live workflows → inspect for Google Sheets node (1.3), Chatwoot
   nodes (2.5/6.4), objection prompt content (2.10), catalog scope (1.2/2.1),
   scheduler + health + error workflows (4.3, 5.8, 5.9, 6.x).
4. `META`: WABA templates (3.2), phone status (6.1), tier.

### Phase 2 — Automated suites (local)
| Suite | Covers |
|-------|--------|
| `tests/phase1-retest.mjs` | bulk of §4, §5, §7 + regressions |
| `tests/ai-conversation-test.mjs` | 2.1, 2.2, 2.7–2.10 partial |
| `tests/webhook-security-test.mjs` | 6.7 |
| `tests/prompt-injection-test.mjs` | 2.9 safety edge |
| `tests/post-release-test.mjs` | 2.3 locks, 2.8 location/address, Jev chain |
| `tests/prelaunch-audit.mjs` | scale/security under §3–§6 |
| `tests/live-campaign-test.mjs --auto-confirm --local-only` | §4 + 8.4 end-to-end; real sends to `27832763116` only |

New `tests/scope-compliance-test.mjs` for uncovered items:
- S1: `products` catalog contains LTE/Wireless/Starlink (1.2/2.1) — expected
  FAIL/PARTIAL, document.
- S2: Google Sheets integration presence (1.3/2.6) — expected deviation, document.
- S3: Objection scenarios B10a–e webhook tests incl. persistence checks (2.10).
- S4: Chatwoot reachability + handover node config (2.5/6.4).
- S5: Brevo hot-lead + escalation send evidence (1.4/2.4/6.5).
- S6: Broadcast segment fields + group send dry-run (3.1/3.3).
- S7: Follow-up flag → scheduled send round-trip (2.11/3.8).
- S8: D5-style info-capture completeness vs leads fields (2.2/8.4).
- S9: Settings statuses match reality (5.4).
- S10: Final-status coverage audit — no enrolment left without outcome (8.4/D6).

### Phase 3 — Production smoke
- `TEST_TARGET=https://dashboard.horizonafrica.co.za node --env-file=.env.local tests/campaign-response-test.mjs`.
- Signature-enforcement status (6.7): confirm `META_APP_SECRET` in Vercel; note
  whether `META_WEBHOOK_ENFORCE_SIGNATURE=true` is live.
- `/api/health` auth; follow-ups + scheduler n8n executions fresh; login visual pass.

### Phase 4 — Manual sign-off list
1.5, 6.8, 7.2 (restore drill), 8.1, 8.3 + open questions in the scope doc
(Google Sheets substitution, product-line scope, follow-up add-on purchase,
backup interpretation, 1,719-lead pilot).

---

## 4. Deliverables

1. `tests/scope-compliance-test.mjs` — targeted checks above.
2. `tests/scope-compliance-report.md` — every matrix row filled with
   `PASS/FAIL/PARTIAL/MANUAL/N/A`, evidence pointer, gap severity
   (blocker / should-fix / cosmetic / deviation), and GO/NO-GO per section.
3. `horizon-africa/Scope-Freeze-Reconstructed.md` kept as the comparison source
   until the real document replaces it.

## 5. Rules

- Real WhatsApp sends only to `27832763116`; never enroll real lead segments.
- Fibre campaign `febe1cac-…` stays paused; test data marked `[SCOPE-AUDIT]` and cleaned.
- Every FAIL gets root cause + recommended fix. Suspected gaps are verified, never assumed.
