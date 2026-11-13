# Eastern Wear — Progress Update for Asif

**Date:** 13 November 2026
**Branch:** `eastern-wear/phase1` (pushed to the review fork — latest commit `4d80b45`)
**Since:** status report of 20 October 2026

Phase 1 remains code-complete (M1–M7). Everything below is new work since the
last report — mostly hardening, verification and cutover preparation. M8
(cutover) and M9 (pilot) are still the only open milestones, and they are
blocked on the items in §3, not on code.

---

## 1. What has been done since 20 October

### Templates & workflows
- **All 10 Eastern Wear WhatsApp templates are APPROVED by Meta** (2 Nov):
  `ew_order_confirmation`, `ew_payment_reminder_1/2/3`,
  `ew_collection_reminder`, `ew_imported_order_update`, `ew_campaign_intro`,
  `ew_reengagement`, `ew_followup_nudge`, `ew_imported_terms`.
- **Eastern Wear follow-up sender workflow built** in n8n (inactive until
  cutover) — uses `ew_followup_nudge`, no telecoms content.
- **Layla's model switched to `deepseek/deepseek-v3.2`** (reasoning off) in the
  EW workflow.

### Security hardening (pre-launch)
- **18 permissive anonymous/public RLS policies removed** across 9 Supabase
  tables. Anonymous API access now returns zero rows on every sensitive table
  (leads, conversations, orders, follow_ups, etc.) — verified by the test
  suite.
- **All n8n workflows migrated from the Supabase anon key to the
  service-role key** and re-published.
- **Meta webhook signature verification** implemented (`META_APP_SECRET` /
  `META_WEBHOOK_ENFORCE_SIGNATURE`), soft-launch capable.
- Webhook now forwards bodies as `application/json` and **acks delivery
  status callbacks locally** instead of forwarding every receipt to n8n —
  removes wasted workflow executions.

### Cutover preparation
- `N8N_WEBHOOK_URL` configured for the Eastern Wear webhook path.
- Follow-up env vars identified as **safe to pre-set in Vercel today** (see §2).
- Cutover runbook updated (`docs/eastern-wear-m8-cutover-runbook.md`).

### Testing — all green
| Suite | Result |
|---|---|
| EW API & DB integrity (incl. live Shopify sync) | **101 pass / 0 fail** |
| EW UI suite | **50 pass / 0 fail** |
| Order flow (live draft order + paid webhook) | **26 pass / 0 fail** |
| Cutover readiness check | **39 pass / 0 fail / 0 warn** |

---

## 2. One quick thing you can do today — Vercel env vars

These two variables only take effect once the Eastern Wear branch deploys —
the live telecom build ignores them completely (`order-follow-ups.ts` doesn't
exist there, and telecom `follow-ups.ts` hardcodes `horizon_followup_v6`).
Safe to set now, one less task inside the cutover window:

```
ORDER_FOLLOWUP_TEMPLATES=ew_payment_reminder_1,ew_payment_reminder_2,ew_payment_reminder_3
LEAD_FOLLOWUP_TEMPLATE=ew_followup_nudge
```

Set on the production environment of the Vercel project that serves the
dashboard. Code defaults already match; this just guarantees no stale
`horizon_*` value can ever take effect.

---

## 3. Still open — needs you / the client (unchanged)

- [ ] **OpenRouter credits** — every AI call still fails 402; the EW workflows
      can't produce real replies until topped up
- [ ] **Branding assets** — Eastern Wear logo + colour palette (dashboard is
      rebrand-ready, still on the old logo)
- [ ] **WeTransfer the Horizon data export** to the client —
      `backups/horizon-africa-data-export-2026-10-20.zip` (734 KB, ready)
- [ ] **Pilot scope in writing** — test customers/orders, must include ≥1
      real paid order
- [ ] **Cutover window** — pick a quiet date/time (joint session)
- [ ] **WABA display name + business assets → Eastern Wear** — submit via
      Meta Business Manager early; review takes time
- [ ] **Supabase native backup** — Dashboard → Database → Backups (only step
      the tooling can't do)
- [ ] **Rotate the Chatwoot token** — one was committed to local git history;
      revoke + regenerate before the repo goes anywhere public
- [ ] **Review the branch** — `eastern-wear/phase1` on the fork
      (`hussainismail703-cpu/horizonafrica`); no PR opened yet

---

**Bottom line:** code, templates, workflows, security and tests are done and
green. The remaining work is account-side: the two Vercel vars above whenever
convenient, then the joint cutover session.
