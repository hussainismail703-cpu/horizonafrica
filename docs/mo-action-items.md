# Mo — Action Items for Eastern Wear Go-Live

**Status:** M1–M7 of Phase 1 are built and tested. M8 (cutover) and M9 (pilot +
acceptance) are blocked on the items below — almost all need your input or a
joint session, not more coding.

Items are roughly in priority order. #1 unblocks the most downstream work.

---

## 1. Client business rules — fill in the blanks ⚠️ top blocker

The client's Business Overview + FAQ documents were never provided, so
`n8n/prompts/business-rules.md` still has **14 unanswered TODOs**. Layla cannot
go live while these are blank — she is forbidden from inventing fees/policies.

Send the client's docs, or answer directly:

- [ ] Shipping fee (national flat rate / free-over-amount?)
- [ ] Courier / delivery partner used
- [ ] Stock-on-hand delivery time (e.g. 2–4 working days)
- [ ] Areas served / exclusions
- [ ] Tracking: provided? how is it sent to the customer?
- [ ] Collection available? Address + hours + what the customer brings
- [ ] Imported items: cancellation/refund policy once ordered
- [ ] Returns/exchanges: window, conditions, excluded items, who pays shipping,
      how a return is initiated
- [ ] Payment gateway: **PayFast or Yoco — which merchant account is live?**
- [ ] Size guide (link or table)
- [ ] Business hours + after-hours handling preference

## 2. WhatsApp template copy — ~15 rewrites

- [ ] Get client's approved content direction for the ~15 template rewrites
      (order updates, payment reminders, follow-ups, notifications)
- [ ] Confirm which of the existing `horizon_*`/Layla templates to retire vs
      rewrite
- [ ] Submit to Meta early — approval is 24–48h **each** and runs in parallel;
      it's a long-lead item that shouldn't wait for cutover

## 3. Branding assets

- [ ] Eastern Wear logo + colour palette (M7 rebrand is code-ready but has no
      client assets — still showing the old logo)

## 4. Decisions needed in writing

- [ ] **Telecoms data**: keep the Horizon Africa leads/conversations/campaigns
      or wipe them? Wiping needs your written go-ahead (backups already exist)
- [ ] **Pilot scope**: agree the controlled-pilot plan in writing per §10.3 —
      test customers/orders, must include ≥1 real paid order
- [ ] **Cutover window**: pick a quiet date/time for the number cutover (with
      you + Hoosen)

## 5. Meta / account tasks (with Hoosen, at cutover)

- [ ] WABA display name + business assets updated to Eastern Wear — **submit
      now**, Meta review takes time
- [ ] Download the Supabase native backup (Dashboard → Database → Backups) —
      the only backup step the tooling can't do
- [ ] Confirm `META_APP_SECRET`, `META_VERIFY_TOKEN`, and
      `META_WEBHOOK_ENFORCE_SIGNATURE` in Vercel at cutover (guide is in the
      runbook)

## 6. n8n prompt import (at cutover, with Hoosen)

- [ ] Import `layla-system-prompt.md` + filled `business-rules.md` +
      `inbound-categories.md` into the live inbound workflow
- [ ] Confirm `Fetch Products` reads `shopify_products` and telecoms copy is
      fully out of the live prompt
- [ ] Retire/retarget telecoms flows: campaign scheduler, fibre follow-ups,
      `telkom_*` templates

## 7. Joint cutover + pilot (M8 → M9)

- [ ] Run `docs/eastern-wear-m8-cutover-runbook.md` together — freeze telecoms
      automation, switch persona, verify alerts/recovery/health monitor
- [ ] Run `tests/phase1-eastern-wear-e2e.md` — every §4 deliverable ticked
- [ ] Pilot: log issues in `tests/pilot-issues.md`, ≥1 live paid order
- [ ] Client written acceptance → final 50% (R7,500) → tag
      `phase1-eastern-wear-delivered`

---

**Fastest path:** send the business-rules answers (#1) and the template copy
direction (#2) — those two items unblock almost everything else.
