# Pre-Launch "Break the App" Audit Checklist

Companion checklist for `tests/prelaunch-audit.mjs`. Covers gaps outside the
existing ~990-test suite: verified live defects, failure injection, launch-scale
behaviour, ops readiness, session/UX edge cases, and security extras.

Legend: **FIXED** = code fix applied + automated check · **AUTO** = covered by
automated suite · **MANUAL** = requires human/ops verification · **ACCEPTED** =
risk reviewed and consciously accepted · **DOC** = documented, no code change.

---

## A. Suspected live defects — verified & dispositioned

| # | Defect | Status | Evidence / Fix |
|---|--------|--------|----------------|
| A1 | `/api/follow-ups/cron` dead code — middleware 307 + cookie client | **FIXED** | n8n "Follow-ups Daily Trigger" (`YcEUNe5qVam06kps`, daily 09:00) was posting to a route absent from `isPublicApi` → 307→/login→success-no-op. Added middleware exemption + `lib/follow-ups.ts` now uses `createServiceClient()` + n8n URL updated to `dashboard.horizonafrica.co.za`. |
| A2 | Bulk enrolment `.in()` URL overflow at 1,719 phones | **FIXED** | All `.in()` lookups chunked at 200 in `app/api/campaigns/enrolments/route.ts`; inserts batched at 500. |
| A3 | Sequential campaign process vs 60s `maxDuration` | **FIXED** | Worker pool (concurrency 8) + 45s wall-clock budget in `lib/campaign-engine.ts`; remainder defers cleanly to next cycle instead of being killed mid-write. |
| A4 | Duplicate-send race (non-atomic check-then-send) | **FIXED** | Unique partial index `uq_campaign_interactions_outbound_step` + claim-before-send (`delivery_status='pending'`); stale claims >15min reclaimed. |
| A5 | `/api/broadcasts/send` no `maxDuration`, stuck `sending` | **FIXED** | `maxDuration=60`, 45s budget, concurrency 8, progress flushed every 25 sends, `partial` status on deferral. |
| A6 | Delivered/read receipts discarded | **FIXED** | `lib/delivery-status.ts` `recordDeliveryStatuses()` updates `campaign_interactions.delivery_status` (monotonic) + new `broadcast_messages` table drives `broadcast_history` delivered/read counters via trigger. |
| A7 | CSV formula injection in leads export | **FIXED** | Cells starting `= + - @ \t \r` prefixed with `'`. |
| A8 | Settings hardcoded wrong statuses | **FIXED** | Brevo + Chatwoot now "connected" (both live via n8n). Google Sheets stays "not-configured" (no integration exists). |
| A9 | Unbounded queries | **FIXED (conversations)** · **ACCEPTED (leads/reports)** | Conversations page now uses `conversation_threads` view + lazy per-thread load via `/api/conversations`. Leads page (1,719 rows client-side) and `/api/reports` 5,000-row cap documented for post-launch pagination. |
| A10 | `xlsx@0.18.5` CVEs | **FIXED** | Upgraded to SheetJS 0.20.3 via official CDN tarball. Also upgraded `next` 15.4.11→15.5.27 (critical advisory) — remaining 7 audit findings need Next 16 / dev-only deps, documented. |
| A11 | Bulk import no dedupe | **FIXED** | In-payload Map dedupe + `uq_broadcast_contacts_group_phone` unique index + `ignoreDuplicates` upsert. |
| A12 | Middleware 307 for unauth API calls | **DOC** | APIs return login redirect instead of 401 JSON; tests treat both as unauthenticated. Low risk, accepted. |

## B. Failure injection / resilience

| Check | Status |
|-------|--------|
| Webhook burst (15 rapid signed messages, one phone) | AUTO |
| Duplicate wamid ×3 concurrent → processed once | AUTO |
| Status-only payload storm → all acked, no processing | AUTO |
| Malformed/absurd webhook payloads → no 500s | AUTO |
| Meta send failure → failed interaction + `campaign_errors.send_failed` | AUTO |
| Paused campaign → process sends nothing | AUTO |
| `end_date` past → campaign completed + no_response_final | AUTO |
| Step due exactly at fireAt boundary → sent | AUTO |
| Stale `pending` claim (>15min) reclaimed | AUTO |
| `failed` outbound row is not retried (documented semantics) | AUTO |
| n8n down → webhook forward failure (at-least-once via wamid check-then-mark) | MANUAL — kill n8n webhook route or DNS and observe Meta retry reprocessing |
| OpenRouter credits/JEV outage → safe fallback + escalation | MANUAL — verified historically (402 observed); can't force on demand |
| Supabase transient failure → `withRetry` + `campaign_errors` | AUTO (code path exists); live injection MANUAL |
| Cold start + timeout mid-batch → partial state correct | MANUAL — Vercel-side; mitigated by claim rows + budgets |

## C. Launch scale (the 1,719)

| Check | Status |
|-------|--------|
| Enrol 1,719 phones in one API call (chunked queries + batched insert) | AUTO |
| Opt-out exclusion inside a large batch | AUTO |
| Re-enrol idempotency (existing actives skipped) | AUTO |
| Process throughput on fake numbers (drain rate measured, <60s/cycle) | AUTO |
| Reply flood (15 inbound) — proxy holds up under burst | AUTO |
| Dashboard + campaign stats load time with data | AUTO |
| Meta TIER_2K headroom (campaign + follow-ups + broadcasts) | MANUAL — count expected business-initiated conversations/24h |
| `131049` marketing-cap drops visible to staff | AUTO (failures table) + MANUAL (staff runbook) |
| 100+ reply flood / 20k conversation perf | MANUAL — needs prod-grade load harness |

## D. Operational readiness — MANUAL checklist

- [ ] Backup/restore drill per `BACKUP-RECOVERY.md` — restore one table into a test schema.
- [ ] Scheduler heartbeat → `/api/health` degraded → n8n health monitor → email: verify full chain once.
- [ ] Vercel env checklist: `APP_SECRET`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `META_APP_SECRET`, `META_WABA_ID`, `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`, `META_VERIFY_TOKEN`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`.
- [ ] Signature rollout: review soft-mode alerts → set `META_WEBHOOK_ENFORCE_SIGNATURE=true` → confirm Meta traffic unaffected.
- [ ] Meta token revocation/expiry alerting path.
- [ ] Error-alert email noise (722 executions/2 days) — dedupe/digest decision.
- [ ] Deploy/rollback + migration rollback drill.
- [ ] POPIA: opt-out retention, lead deletion path, export format sign-off.
- [ ] n8n follow-ups workflow: after middleware fix deploys, trigger once and confirm a real follow-up attempt lands in logs.

## E. Multi-user / session / UX edge

| Check | Status |
|-------|--------|
| Concurrent campaign step edits → consistent final state | AUTO |
| Session expired mid-form → no silent write | AUTO |
| Forgot/reset password pages render | AUTO (page-level); email link MANUAL |
| Deep links: bad UUID, deleted ID, non-enrolled phone | AUTO |
| `?search=` deep link into leads | AUTO |
| Reload mid-form → no crash, clean reset | AUTO |
| Keyboard-only nav on leads page (Tab reaches controls) | AUTO (basic) |
| Screen-reader pass | MANUAL |
| Multi-tab logout | MANUAL |
| Hydration-mismatch sweep | AUTO (console capture) |

## F. Security extras

| Check | Status |
|-------|--------|
| `x-middleware-subrequest` bypass attempt | AUTO |
| Forged status callback can't corrupt unrelated records | AUTO |
| Verify-token brute force (10 bad tokens → 403s) | AUTO |
| Open-redirect via `?next=`/`?redirect=` params | AUTO |
| Secrets-in-client-bundle audit (service key, Meta token, OpenRouter key, APP_SECRET) | AUTO |
| Error responses leaking Supabase internals | AUTO (spot inventory) |
| IDOR spot-check | AUTO |
| Rate limiting on authenticated write endpoints | **ACCEPTED** — single-tenant internal tool behind auth; documented risk |
| Bearer `===` compare (non-timing-safe) | **DOC** — low risk; note for hardening backlog |

## Go/No-Go criteria

- **GO** requires: all A-row FIXED items green, no AUTO failures that touch
  real customer data or WhatsApp sends, and the D checklist signed off.
- Any SECURITY result is a No-Go until triaged.
