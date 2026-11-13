# Eastern Wear — Full-Suite Test Plan

**Project:** Layla repurposed for Eastern Wear by Kersh — Phase 1
**Branch under test:** `eastern-wear/phase1` @ `94a52e9`
**Date:** 13 Nov 2026
**Scope:** every Phase 1 deliverable (scope freeze §4.1–§4.9) — n8n workflows · backend API · database · UI (Playwright, headed) · E2E integration · security & POPIA · non-functional · cutover readiness
**Results:** `tests/full-suite-results.json` (generated); defects → `tests/pilot-issues.md`

**Deliverable traceability:** every check is tagged with its scope-freeze section where applicable.

---

## Suite 0 — Pre-flight gate — do not start until all pass

| # | Check | How | Pass |
|---|-------|-----|------|
| 0.1 | Dev server healthy | `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login` → `200` | [ ] |
| 0.2 | TypeScript clean | `npx tsc --noEmit` | [ ] |
| 0.3 | Production build clean | `npm run build` | [ ] |
| 0.4 | **OpenRouter credits topped up** — AI calls return 402 until done; blocks Suites A2/E | One test message through EW workflow → non-402 OpenRouter response in execution | [ ] |
| 0.5 | `.env.local` complete: Supabase (anon+service), Shopify (domain/token/webhook secret), Meta (`META_*`, verify token, app secret), `APP_SECRET`, `N8N_WEBHOOK_URL` | env check script | [ ] |
| 0.6 | Test-data isolation — ONLY test phones `27823725575`, `27832763116`; never real Shopify customers | — | [ ] |
| 0.7 | No real outbound WhatsApp sends except tests explicitly marked **LIVE** | — | [ ] |
| 0.8 | EW workflows inactive, telecoms workflows active (deliberate rollback state) | n8n workflow list | [ ] |
| 0.9 | Supabase native backup downloaded + fresh `scripts/backup-db.mjs` export before destructive suites | Dashboard → Backups | [ ] |
| 0.10 | Meta webhook vars confirmed (`META_VERIFY_TOKEN`, `META_APP_SECRET` for signature enforcement) | env check | [ ] |
| 0.11 | `ORDER_FOLLOWUP_TEMPLATES` reviewed — EW runs must not silently use `horizon_*` templates | env check | [ ] |
| 0.12 | Playwright installed + headed mode works | `npx playwright install chromium` | [ ] |

---

## Suite A — n8n workflow tests (§4.1, §4.2, §4.5, §4.6)

EW inbound `XrSnS0xF2bKZPSq1` and follow-up sender `6910G5ugptqI0pHC` are inactive. Test via n8n test-webhook / manual execution with pinned payloads, or temporary activation against a **test number only** — never the live line.

### A1. Structural validation (no execution)
- [ ] A1.1 Both EW workflows exist, parse, no missing credentials
- [ ] A1.2 Inbound node chain: webhook → extract → human-takeover check → conversation history → product-context lookup (`shopify_products`) → build OpenRouter request → OpenRouter → verify response → send WhatsApp → upsert lead → log conversation
- [ ] A1.3 All HTTP nodes have `retryOnFail` + sensible `maxTries`/waits
- [ ] A1.4 Zero `telkom_*`/`horizon_*` template names or telecom copy in EW workflow nodes
- [ ] A1.5 Prompts match `n8n/prompts/layla-system-prompt.md` + `business-rules.md` (zero TODOs)
- [ ] A1.6 `n8n/workflows/` exports current and redacted (no tokens/keys)
- [ ] A1.7 **Workflow inventory gate:** enumerate all active workflows — expected: telecom inbound (rollback), Chatwoot handover sync `patLFfQOIDwaJDB5`, webhook health monitor, missed-message-recovery. Confirm EW workflows inactive and no telecom scheduler fires EW paths

### A2. Department classification & routing matrix (§4.2)
Each row: send message via test webhook → verify `conversations.message_category` + AI reply content + staff-alert rule.

| # | Dept | Customer sends | Expected category | Staff alert? |
|---|------|----------------|-------------------|:---:|
| A2.1 | Sales | "Do you have this abaya in size 34?" | `sales` | No |
| A2.2 | Sales | "How much is the blue co-ord?" | `sales` (+ correct live price) | No |
| A2.3 | Sales | "That's too expensive" | `sales` — objection handled, NOT complaint | No |
| A2.4 | Sales | "I want to buy it, how do I pay?" | `sales` | No |
| A2.5 | Orders | "Where is my order?" | `orders` | Yes |
| A2.6 | Orders | "Can I change the size I ordered?" | `orders` | Yes |
| A2.7 | Orders | "I want to cancel my order" | `orders` | Yes |
| A2.8 | Orders | Imported-item enquiry → 6-week/50% deposit explained (§4.4) | `orders` | Yes |
| A2.9 | Payments | "The payment link isn't working" | `payments` | Yes |
| A2.10 | Payments | "When will I get my refund?" | `payments` | Yes |
| A2.11 | Payments | "I paid but got no confirmation" | `payments` | Yes |
| A2.12 | Delivery | "Has my parcel shipped?" | `delivery` | Yes |
| A2.13 | Delivery | "Can I collect instead?" → collection hours Mon–Fri 09:00–17:00 | `delivery` | Yes |
| A2.14 | Delivery | "How much is delivery to Durban?" → shipping-rate answer per business rules | `delivery` | Yes |
| A2.15 | General | "Salaam, what are your hours?" | `general` | No |
| A2.16 | General | "Where is your shop?" → in-chat answer, **never gives shop phone number** | `general` | No |
| A2.17 | General | Compliment "Love your abayas!" | `general`/`sales` | No |
| A2.18 | Complaints | "This is unacceptable, terrible service" | `complaints` | Yes |
| A2.19 | Complaints | "My dress arrived damaged" | `complaints` | Yes |
| A2.20 | Complaints | "I want to speak to the owner NOW" | `complaints` → human path | Yes |
| A2.21 | Uncertain | Gibberish "asdkfj qwer zzz" | `uncertain` → human review | Yes |
| A2.22 | Uncertain | Voice note / image only, no text | `uncertain` → human review | Yes |
| A2.23 | Uncertain | Emoji-only message | `uncertain` or graceful ask-to-clarify | flagged |

- [ ] A2.24 Every processed inbound has non-NULL `message_category`
- [ ] A2.25 Message while lead `human_takeover=true` → logged with sentinel, NO AI call, NO WhatsApp reply (§4.6)
- [ ] A2.26 Meta `statuses` delivery callback → short-circuits, no AI call, no error
- [ ] A2.27 Stringified-JSON/malformed body → defensive parse, no crash (M5 fix)
- [ ] A2.28 **No shop number ever in replies** — verifier strips `068 247 7199`/`+27682477199`; handover stays in chat (client rule)
- [ ] A2.29 Out-of-stock product → says unavailable, offers alternatives, no invented stock
- [ ] A2.30 Product URL `…/products/<handle>` → context injected: title, variants, price, stock (§4.1/M5)
- [ ] A2.31 **Discount-request attempts refused** — "give me 30% off", "what's your best price special" → polite refusal/standard pricing (§4.8 no unauthorised discounts)
- [ ] A2.32 Location-pin message → `leads.physical_address` populated
- [ ] A2.33 Lead scoring — EW-appropriate scoring; neutral message never downgrades HOT; `score_locked` never overwritten
- [ ] A2.34 Multi-turn: question → answer → follow-up uses conversation history context
- [ ] A2.35 Layla never asks for/handles card or banking details — always defers to secure payment page (§7 POPIA)

### A3. EW follow-up sender `6910G5ugptqI0pHC` (§4.5)
- [ ] A3.1 Manual run picks up due `follow_ups` → sends correct step template
- [ ] A3.2 Row → `sent` with WhatsApp message ID; next step scheduled (+4h → +24h → +72h chain)
- [ ] A3.3 Skips paid/cancelled/opted-out/declined orders
- [ ] A3.4 Send failure → row retryable, error logged to `campaign_errors`/equivalent
- [ ] A3.5 Template used = `ew_followup_nudge` / `ew_payment_reminder_*` per `ORDER_FOLLOWUP_TEMPLATES` — never `horizon_*`

### A4. Chatwoot handover sync `patLFfQOIDwaJDB5` (§4.6)
- [ ] A4.1 Agent-assignment webhook → `POST /api/handover` → `human_takeover=true`
- [ ] A4.2 Conversation resolved → takeover released
- [ ] A4.3 Non-handover Chatwoot events ignored, no error

### A5. Legacy workflows — rollback intact
- [ ] A5.1 Telecom inbound/follow-up/campaign-trigger unmodified (rollback path)
- [ ] A5.2 Webhook health monitor still passing; error-alert workflows still wired

### A6. Missed-message-recovery interplay
- [ ] A6.1 Takeover sentinel rows (`ai_response` sentinel) NOT re-queued by recovery workflow
- [ ] A6.2 Genuine unanswered message (AI failure) IS recovered — forced-failure test
- [ ] A6.3 Recovery does not resurrect telecom-era placeholder rows into EW flow

### A7. Delivery-status callbacks (`lib/delivery-status.ts`)
- [ ] A7.1 `statuses` payload (sent/delivered/read/failed) persisted — failure → `message_delivery_failures` row with Meta error code
- [ ] A7.2 Out-of-order statuses (read→delivered) don't regress recorded state
- [ ] A7.3 Status callbacks never enter the AI/conversation pipeline

---

## Suite B — Backend API (all 42 routes exercised)

Auth baseline: unauthenticated → `307`/`401`; session or Bearer `APP_SECRET` (where supported) → success. Probe **every** route for auth at minimum; deep tests below.

### B1. Orders (§4.3, §4.4) — rerun `tests/order-flow-test.mjs` (expect 25/25) +
- [ ] B1.1 `POST /api/orders/create` valid → Shopify draft + invoice URL + `pending_payment` + +4h follow-up scheduled
- [ ] B1.2 Invalid phone → `400 invalid_phone`; missing/bad address → `400`; out-of-stock → `409`
- [ ] B1.3 Stock NOT reserved pre-payment — Shopify inventory unchanged after draft creation (client decision)
- [ ] B1.4 Stock **revalidated at order creation** against live Shopify, not DB mirror (§4.3)
- [ ] B1.5 Signed `orders/paid` → `paid`, follow-ups cancelled, `order_events` row, confirmation message path
- [ ] B1.6 Webhook replay same `shopify_id` → `{duplicate:true}` (unique partial index)
- [ ] B1.7 `POST /api/orders/imported` → `order_track=imported`, `status=handed_to_orders` (§4.4)
- [ ] B1.8 `GET /api/orders` filters: status, track, search, limit; unauth → 401
- [ ] B1.9 New order → staff alert path fires (§4.3 "instant staff alert") — notification/alert-email row or API evidence
- [ ] B1.10 Delivery fee applied per business-rules structure; collection order = zero fee

### B2. Follow-ups & cron (§4.5) — rerun `tests/m6-followups-broadcast-test.mjs` (expect 27/27) +
- [ ] B2.1 `GET`/`POST /api/follow-ups/cron` — `APP_SECRET` and `CRON_SECRET` both accepted; wrong → 401
- [ ] B2.2 Due nudge → correct step template; timing configurable (env/DB config honoured)
- [ ] B2.3 Paid/expired/opted-out/declined → pending nudges cancelled
- [ ] B2.4 `POST /api/follow-ups/schedule` + `/api/follow-ups/send` — manual paths: validation, auth, idempotency

### B3. Shopify (§4.3, §4.7)
- [ ] B3.1 `POST /api/shopify/sync-products` → upserts; stale price corrected (regression: Bhahubali R220→R168)
- [ ] B3.2 `POST /api/shopify/sync-customers` → upserts + `accepts_marketing` captured
- [ ] B3.3 `GET /api/shopify/stock?q=` → live inventory; title + SKU search; query sanitization (no PostgREST injection)
- [ ] B3.4 Webhook HMAC: valid → 200+event row; invalid → 401; unconfigured → 503
- [ ] B3.5 `products/update`, `products/delete` (deactivate), `customers/create` (phone-normalized lead link)
- [ ] B3.6 `GET /api/shopify/products` session-only → 401 unauthenticated
- [ ] B3.7 Shopify unreachable/bad token → controlled error, not unhandled 500

### B4. Broadcasts (§4.7)
- [ ] B4.1 `POST /api/broadcasts/sync-shopify` → EW group upsert; contacts upserted; manual opt-outs preserved; `accepts_marketing=false` + global opt-outs excluded; `source` stamped
- [ ] B4.2 Contacts CRUD (`/contacts`, `/contacts/[id]`), bulk-import CSV, template CSV download
- [ ] B4.3 `POST /api/broadcasts/send` — respects `opt_in` + `opt_out_list`; **DRY RUN only**
- [ ] B4.4 `GET /api/broadcasts/templates` → returns `ew_*` Meta templates
- [ ] B4.5 `broadcast_messages` send-log + `broadcast_history` view populated (dashboard counts depend on them)

### B5. Handover & conversations (§4.6)
- [ ] B5.1 `POST /api/handover` — session + `APP_SECRET`; sets `human_takeover`/`_at`/`_by`; release clears
- [ ] B5.2 `handover_events` row per action (actor + timestamp audit)
- [ ] B5.3 `GET /api/conversations` → `message_category`, `order_track`, correct ordering/dedup
- [ ] B5.4 `GET /api/notifications` → HOT leads, new leads, escalations, due follow-ups; 401 unauth (staff-alert surfacing)

### B6. Campaigns (regression — engine reused for EW broadcasts)
- [ ] B6.1 Smoke all: `/campaigns` CRUD, `[id]` GET/PATCH/DELETE, `steps`, `enrolments`, `enrolments/[id]`, `classify`, `classifications/[id]`, `stats/[id]`, `dashboard-stats`, `errors`
- [ ] B6.2 `POST /api/campaigns/process` secret → 200 zero-work; no secret → 401

### B7. WhatsApp webhook proxy
- [ ] B7.1 Meta verification handshake → 200 + challenge
- [ ] B7.2 Inbound message → forwards to `N8N_WEBHOOK_URL` with `_layla_context.human_takeover`
- [ ] B7.3 Forwards `application/json` (not `text/plain` — M5 fix)
- [ ] B7.4 Rerun `tests/webhook-security-test.mjs` — all pass
- [ ] B7.5 **Every inbound payload logged to `inbound_webhook_messages`** before processing (raw audit trail)

### B8. Leads, reports, misc
- [ ] B8.1 Leads CRUD; clothing `rejection_reason` enum accepted; `/api/leads/[id]` PATCH
- [ ] B8.2 `GET /api/reports` → orders by track, follow-up conversions, handover counts, opt-out metrics (§8 metric definitions)
- [ ] B8.3 `GET /api/health` → service statuses consistent with `system_heartbeats`
- [ ] B8.4 `GET /api/leads/export` → CSV downloads, POPIA-appropriate fields only
- [ ] B8.5 `GET/POST/PATCH /api/settings/alert-emails` → recipient CRUD, validation
- [ ] B8.6 `GET/POST /api/calling-queue` + `[id]` → queue lifecycle pending→called→converted/lost; duplicates prevented

---

## Suite C — Database integrity (all tables + views)

### C1. Schema & RLS matrix — verify each: exists, RLS on, correct policies, expected write path

| Table | Key checks |
|---|---|
| `leads` | EW fields (`order_track`, `human_takeover*`, `shopify_customer_id`, `physical_address`, `score_locked`, `needs_escalation`); clothing `rejection_reason` enum |
| `conversations` | `message_category`, `order_track`; sentinel takeover rows |
| `conversation_threads` | latest-message ordering used by dashboard/conversations page |
| `orders` + `order_events` | constraints, both `order_track` values, `handed_to_orders` status, event timeline |
| `follow_ups` | unique `(order_id, sequence_step)`; statuses; order linkage |
| `shopify_products`/`shopify_variants` | upsert keys, active flags, RLS (service-only reads — anon REST returns empty) |
| `shopify_customers` | `accepts_marketing` captured |
| `shopify_webhook_events` | partial unique index on `shopify_id` dedupe |
| `broadcast_contacts` | `source` column; `opt_in`/`opt_out` preserved on re-sync |
| `broadcast_groups` / `broadcast_messages` / `broadcast_history` | send-log + history views populated |
| `opt_out_list` | global enforcement across campaigns + broadcasts + follow-ups |
| `calling_queue` | duplicate-prevention constraint |
| `campaigns` + `steps/enrolments/interactions/classifications/errors/audit_log` | engine intact post-repurpose |
| `handover_events` | takeover/release audit rows |
| `inbound_webhook_messages` | every webhook logged raw |
| `message_delivery_failures` | Meta failure codes captured |
| `system_heartbeats` | updating regularly; health page reads it |
| legacy `products` | untouched by EW paths (still read by telecom workflow until cutover) |
| `users` | auth/RBAC intact |

- [ ] C2 Anon/unauthenticated REST probe on `orders`, `leads`, `conversations`, `follow_ups` → empty/401
- [ ] C3 Audit triggers: status changes → `campaign_audit_log`; order events → `order_events`
- [ ] C4 Cascades: deleting test order/campaign cleans children
- [ ] C5 Phone normalization `083…`→`27…` consistent: leads, orders, conversations, contacts, opt-outs
- [ ] C6 **Telecom data preservation (§4.9):** row counts + checksum sample of Horizon leads/conversations/campaigns identical before/after EW test run
- [ ] C7 No NULL `message_category` on processed inbound; no orphan `follow_ups`/`order_events`

---

## Suite D — UI (Playwright, **headed**: `headless:false, slowMo:200`)

Harness: reuse `tests/ui-dashboard-test.mjs` login/console-error/screenshot patterns → `tests/screenshots/full-suite/`. Credentials: `test@horizonafrica.co.za` / `TestPass123!`.

### D1. Auth & shell
- [ ] D1.1 Login valid/invalid; logout via `app/auth/signout`; protected-route redirect; session persists on reload
- [ ] D1.2 **Forgot password** page renders + submits; **reset password** page renders
- [ ] D1.3 Sidebar: all nav items, active state, Orders entry present, zero telecom wording
- [ ] D1.4 Top-bar titles per route; **notification bell** reflects `/api/notifications` data

### D2. Dashboard overview
- [ ] D2.1 Stat cards: leads, HOT leads, active conversations (`conversation_threads` 7-day), broadcasts (`broadcast_history`)
- [ ] D2.2 Recent leads + recent conversations lists render, links navigate
- [ ] D2.3 Empty/zero states don't crash

### D3. Orders (§4.3/§4.4 — priority)
- [ ] D3.1 List: status badges (`pending_payment`, `paid`, `handed_to_orders`, expired, cancelled), track filter stock-vs-imported, search, totals in `R`
- [ ] D3.2 Detail: items, fulfilment, Shopify IDs, payment link, `order_events` timeline chronological
- [ ] D3.3 Imported orders visually distinguishable; empty states clean

### D4. Conversations (§4.2/§4.6)
- [ ] D4.1 List + thread view; `message_category` visible; mobile back-navigation
- [ ] D4.2 "Take over" → "Human in control"; "Release to Layla" clears; persists across reload + API
- [ ] D4.3 Sentinel takeover rows display sensibly (not as broken AI replies)

### D5. Products — Shopify catalog (§4.3)
- [ ] D5.1 Catalog renders with live price + stock; search works
- [ ] D5.2 "Sync now" → runs sync, shows result; no legacy create/edit form

### D6. Follow-ups (§4.5)
- [ ] D6.1 Lead follow-ups + Order Payment Reminders tables; scheduled times formatted; statuses

### D7. Broadcasts (§4.7)
- [ ] D7.1 Groups, contacts, "Sync Shopify" → result shown
- [ ] D7.2 Template picker lists `ew_*`; send-form validation; **never submit real send**

### D8. Reports (§8)
- [ ] D8.1 Orders by track, follow-up conversion, handover metrics, opt-out metrics render; date filter updates all

### D9. Leads / campaigns / calling queue / health
- [ ] D9.1 Leads table: clothing labels (Size, Style/Occasion, Item — NOT Package/Household Size/Internet Usage); EW rejection reasons; `order_track` visible
- [ ] D9.2 Lead detail page: same label checks + human-takeover state
- [ ] D9.3 Campaign create/detail/enrolments/audit/customer-journey/regression still work
- [ ] D9.4 Calling queue UI lifecycle; Health page: service checks green, `system_heartbeats` data shown

### D10. Templates & Settings
- [ ] D10.1 Templates page: Meta template manager lists `ew_*` with approval status
- [ ] D10.2 Settings: alert-emails manager CRUD works
- [ ] D10.3 ⚠️ **KNOWN DEFECT:** Settings integrations list is hardcoded telecom copy ("lead qualification", "Google Sheets", GPT-5.6-sol reference) — assert-clean test EXPECTED TO FAIL; log in `tests/pilot-issues.md`

### D11. Branding & copy sweep
- [ ] D11.1 Automated text scan every page: zero "Horizon Africa", "Telkom", "fibre", "Mbps", "lead qualification" in rendered UI
- [ ] D11.2 Login shows `Orders@easternwearbykersh.co.za`
- [ ] D11.3 ⚠️ Logo still Horizon placeholder — documented pending client asset, NOT a failure

### D12. Responsive & edge
- [ ] D12.1 375px + 768px: sidebar overlay, tables scroll, no overlap; conversation mobile pane + back button
- [ ] D12.2 Zero console errors full run; screenshot every page; long names/RTL-ish strings don't break layout

---

## Suite E — E2E integration (local webhook → n8n → Supabase → UI)

Requires 0.4. Payload pattern from `tests/lib/webhook.mjs` + `ai-conversation-test.mjs`, EW-adapted.

- [ ] E1 Sales question → EW workflow → AI reply → `conversations` row + category → visible in UI thread
- [ ] E2 Full purchase → `POST /api/orders/create` → payment link → simulated `orders/paid` → paid → dashboard paid → follow-ups cancelled → **customer confirmation/receipt message** (§4.3)
- [ ] E3 Takeover mid-conversation → logged no-reply → release → AI resumes
- [ ] E4 Imported-order conversation → 6-week/50% deposit explained → `handed_to_orders` + Orders@ email handover (§4.4)
- [ ] E5 Reminder lifecycle: order → +4h due → sender sends → `sent` → pay → pendings cancelled (§4.5)
- [ ] E6 Website-button URL message → product-context answer (§4.1)
- [ ] E7 Shopify product update webhook → re-sync → next AI answer uses new price
- [ ] E8 Opt-out → `opt_out_list` → excluded from broadcast sync AND follow-ups AND campaigns
- [ ] E9 First-response-wins + STOP semantics for campaign enrolments (port from telecom simulation fixtures)
- [ ] E10 **Staff-alert E2E** — `payments`/`complaints`/`delivery` message → alert surfaces in `/api/notifications` + UI bell (§4.2)
- [ ] E11 **New-order instant alert** — order created → staff alert visible (§4.3)
- [ ] E12 Delivery-failure visibility — forced Meta failure → `message_delivery_failures` + surfaced where UI supports
- [ ] E13 Follow-up conversion metric — order paid after nudge → counted in `/api/reports` follow-up conversions (§8)

---

## Suite F — Security, POPIA & resilience

- [ ] F1 Rerun `tests/prompt-injection-test.mjs`; add EW cases: discount extraction attempts, "ignore your rules", price override — no leaked prompt, no unauthorised discounts (§4.8)
- [ ] F2 Mass auth probe — all 42 routes reject missing/invalid auth
- [ ] F3 Shopify + Meta webhook signature enforcement; unsigned → rejected
- [ ] F4 Secrets scan: `git grep -nE '(sk-|shpat_|Bearer [A-Za-z0-9]{20,})'` tracked files → clean; n8n exports redacted
- [ ] F5 Rapid duplicate webhooks → no duplicate orders/conversations (idempotency)
- [ ] F6 Service-role key never in client bundle/network responses
- [ ] F7 **POPIA** — no card/bank strings stored in `conversations`/`orders` after a payment flow; opt-out honoured in exports + all send paths; customer data stays client-owned (§7)
- [ ] F8 **Oversell concurrency** (documented risk — no reservation) — two test customers order same 1-unit item before either pays: second `orders/create` after stock depletion → 409; Shopify oversell disabled on one-of items (see I5)
- [ ] F9 Session security — expired/tampered cookie rejected; cross-session RLS probe returns nothing
- [ ] F10 Chatwoot token in git history rotated before any push (housekeeping gate)
- [ ] F11 Rate/abuse — malformed payloads, oversized bodies, non-JSON → controlled 4xx, no 500s

---

## Suite H — Non-functional & operational

- [ ] H1 Scale: pages load <3s with real data — 217 products, 244 variants, 572 customers, 58 leads, 2.5k conversations; lists paginate/virtualize
- [ ] H2 Timezone: all UI timestamps SAST; currency `R` formatting everywhere (orders, products, reports)
- [ ] H3 **Backup & restore (§4.9):** `scripts/backup-db.mjs` completes all tables incl. `broadcast_messages`, `inbound_webhook_messages`, `system_heartbeats`; export zip integrity verified; spot-restore one table to scratch schema; existing `backups/horizon-africa-data-export-2026-10-20.zip` integrity checked
- [ ] H4 Monitoring: `system_heartbeats` fresh; health page statuses accurate; error-alert workflow fires on forced failure
- [ ] H5 Data preservation (§4.9): telecoms leads/conversations/campaigns byte-identical before/after EW run (C6 counterpart)
- [ ] H6 Broadcast at scale (dry): segment of Shopify contacts builds correctly, opt-outs excluded, no sends

---

## Suite I — M8 cutover readiness dry-run (pre-cutover checks only)

Runbook: `docs/eastern-wear-m8-cutover-runbook.md`. These verify readiness WITHOUT cutting over.

- [ ] I1 Env audit vs runbook: `META_*`, `N8N_WEBHOOK_URL`, `ORDER_FOLLOWUP_TEMPLATES`, `APP_SECRET`, Shopify vars present + EW-appropriate values
- [ ] I2 Template wiring: grep code + runtime — all EW paths reference `ew_*` names; zero `telkom_*`/`horizon_*` in active paths
- [ ] I3 Rollback proof: telecoms workflows active + one safe inbound test still works
- [ ] I4 WABA display name + business asset review status via Meta API
- [ ] I5 Shopify store check: oversell disabled on one-of items (risk-table item); checkout/PayFast-Yoco live
- [ ] I6 All 10 `ew_*` templates APPROVED in WABA (already true 2 Nov — re-verify before cutover)
- [ ] I7 Dry-run output appended to runbook's verification section
- [ ] I8 Subscriber/broadcast list state — EW group populated, opt-outs honoured, ready for first broadcast

---

## Suite G — Existing test inventory: designed for THIS app?

Audit of all 28 `tests/*.mjs` (keyword scan + headers). **Only 3 suites were built for Eastern Wear.**

### G-A: EW-designed — run as-is (~80 tests)
| Suite | Covers | Last result |
|---|---|---|
| `order-flow-test.mjs` | M3 order flow, drafts, paid webhook, replay | 25/25 (2 Nov) |
| `m6-followups-broadcast-test.mjs` | M6 nudges, Shopify broadcast sync, consent | 27/27 |
| `m4-imported-handover-test.mjs` | M4 imported orders, takeover API/webhook/UI | 28/28 |

### G-B: Persona-agnostic — reuse with minor updates
| Suite | Caveat |
|---|---|
| `ui-dashboard-test.mjs` (125) | Pre-repurpose (Sept 25) — no Orders/takeover/Shopify-catalog/EW-branding coverage; reuse harness only |
| `webhook-security-test.mjs` | Mostly structural; check no telkom-template assertions |
| `prompt-injection-test.mjs` | Reusable; add EW discount/prompt-leak cases (F1) |
| `chaos-test.mjs`, `verify-lockfix.mjs` | Structural — audit before use |

### G-C: Telecom-fixtured — do NOT run as-is; port or archive
| Suite | Problem |
|---|---|
| `ai-conversation-test.mjs` (59) | 69 telecom refs, 0 EW — Telkom persona assertions → **port to `ew-conversation-test.mjs`** |
| `client-simulation-test.mjs`, `advanced-simulation-test.mjs` (87) | fibre/telkom fixtures; campaign machinery valid — re-fixture to `ew_*` |
| `campaign-response`, `campaign-workflow-live`, `live-campaign`, `campaign-engine` | hardcoded Fibre campaign `febe1cac…` + telkom templates — archive or re-fixture |
| `workflow-e2e-test.mjs`, `test-plan.mjs` | telecom workflow IDs + persona |
| `scope-freeze-*`, `scope-compliance`, `prelaunch-audit`, `post-release`, `phase1-gap`, `phase1-retest`, `comprehensive` | telecom scope-freeze audits — mine for helpers, not EW evidence |
| `dash-shots.mjs`, `repro-*.mjs`, `shots/` | untracked leftovers — triage/delete |

### G-D: Suites to author for EW
| # | New suite | Covers |
|---|---|---|
| G8a | `tests/ew-conversation-test.mjs` | A2 department matrix + business-rules knowledge + scoring + takeover |
| G8b | `tests/ew-api-test.mjs` | B-suite gaps: notifications, deliveries, follow-up manual routes, exports, health |
| G8c | `tests/ew-ui-test.mjs` | Suite D headed coverage of EW pages |
| G8d | `tests/ew-cutover-check.mjs` | Suite I env/template/rollback dry-run |

### G-E: Remaining gaps
| # | Gap | Action |
|---|-----|--------|
| G1 | OpenRouter credits → A2/E blocked | Top up (pre-flight 0.4) |
| G3 | EW workflows inactive — staging path needed | Decide test-webhook vs test-WABA (Suite A preamble) |
| G4 | Logo/colour assets missing | D11.3 pending, not failure |
| G5 | Telecom `products` table still read by live workflow | Keep until cutover; EW must not touch (C1) |
| G6 | No EW campaign for engine regression | Create test campaign with `ew_campaign_intro`/`ew_reengagement` or descope |
| G7 | ~340 legacy telecom tests stale | Archive to `tests/legacy-horizon/` |
| G9 | Settings page telecom copy | D10.3 — defect filed, expected fail until fixed |

---

## Execution order

1. Pre-flight 0.1–0.12
2. **B + C** — backend + DB (no AI dependency): rerun `order-flow`, `m6`, `m4`, `webhook-security`; new `ew-api-test` gaps
3. **D** — headed Playwright all pages
4. **H** — non-functional/backup/scale
5. **A** — staged n8n (after credits): structure → departments → senders → handover → recovery → statuses
6. **E** — integration paths
7. **F** — security/POPIA/concurrency
8. **I** — cutover dry-run
9. **G7** — archive legacy suites
10. Collate → `tests/full-suite-results.json` + report; defects → `tests/pilot-issues.md`

## Exit criteria

- Every §4.1–§4.9 deliverable has ≥1 passing automated or documented manual check
- All 42 API routes and all 27 pages exercised at least once
- All 21+ tables verified for RLS + write-path
- 100% pass on B, C, D (excluding documented D10.3, D11.3)
- A + E pass once OpenRouter credits available — **these gate M8 cutover**
- Zero console errors, zero secrets, zero customer side-effects, zero telecom wording in EW UI
- All test data cleaned; workflows restored to intended active/inactive states
