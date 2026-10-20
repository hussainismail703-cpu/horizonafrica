# Mo — Action Items for Eastern Wear Go-Live

**Status:** M1–M7 of Phase 1 are built and tested. M8 (cutover) and M9 (pilot +
acceptance) are blocked on the items below — almost all need your input or a
joint session, not more coding.

Items are roughly in priority order. #1 unblocks the most downstream work.

---

## 1. Client business rules — ✅ mostly done (20 Oct 2026)

Filled from the client's business-rules email (§5–6) and the
easternwearbykersh.com policy pages. Collection is free on the Bluff, standard
delivery is R120 (3–5 days) and express is R150 (1–3 days). The imported-order
and stock-on-hand terms come from Templates 1 and 2. The returns and contact
details come from the website. Still to confirm:

- [x] Collection hours: **09:00–17:00** per the email (Asif, 20 Oct)
- [x] Stock: **not reserved** before payment, as in Template 2 (Asif, 20 Oct).
      The M3 reservation has been removed
- [x] Payment gateway: payment links open the website's Shopify checkout, so
      they use the same gateway as the website (Payflex shown)
- [ ] Website Contact page shows `+276824771999` (one digit too many). It
      should probably be 068 247 7199. Asif will confirm
- [x] Layla never gives out the shop number (or any other number). Handovers
      stay in the WhatsApp chat (option a, 20 Oct)
- [x] Alert emails: keep as is, going to Sif from the existing sender
      (Asif, 20 Oct)
- Note: no size guide is published. Layla quotes the size from each product
  description (e.g. "India XL = SA 36") and offers the team for measurements

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

- [x] **Telecoms data**: KEEP (Asif, 19 Oct). Stays in Supabase; client export
      zip ready at `backups/horizon-africa-data-export-2026-10-20.zip`
- [ ] WeTransfer the export zip to the client
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

## 6. n8n — Eastern Wear workflow (built, inactive)

- [x] Separate workflow **"Eastern Wear - Layla Inbound AI"** (`XrSnS0xF2bKZPSq1`)
      with the EW persona, business rules, live Shopify catalogue and no telecoms
      content. The telecoms workflow is untouched until cutover
- [ ] **Top up OpenRouter credits.** Every AI call currently fails with 402, so
      neither workflow can produce real replies
- [ ] At cutover: activate it, point `N8N_WEBHOOK_URL` at
      `/webhook/eastern-wear-webhook`, deactivate the telecoms workflow (runbook
      Phase 1)
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
