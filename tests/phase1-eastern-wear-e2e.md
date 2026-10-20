# Phase 1 Eastern Wear — Manual E2E Checklist

**Project:** Layla repurposed for Eastern Wear by Kersh — Phase 1 (M9)
**Scope source:** `repurpose/Layla-EasternWear-Phase1-Scope-Freeze-DEV.md` §4 (deliverables), §8 (metrics), §10.2–10.3 (acceptance + controlled pilot)
**Purpose:** Manual end-to-end acceptance checklist — every §4 deliverable exercised on the live system with steps, expected results, and a pass checkbox. Log defects in `tests/pilot-issues.md`.

**Test number (customer-side):** `____________________` (a WhatsApp number controlled by the tester, NOT a real customer)
**Dashboard:** `https://dashboard.horizonafrica.co.za` (or rebranded domain post-M8)
**Business WhatsApp line:** `+27 75 777 4389`

> ⚠️ Prerequisites — do not start until all are true:
> - [ ] `n8n/prompts/business-rules.md` has **zero `TODO:` placeholders** (all client inputs received)
> - [ ] Eastern Wear persona + business rules + inbound-categories spec are imported into the live n8n inbound workflow
> - [ ] ~15 rewritten WhatsApp templates are **APPROVED** in Meta (check WABA template list)
> - [ ] M8 cutover runbook (`docs/eastern-wear-m8-cutover-runbook.md`) completed OR explicitly deferred — if the live number still serves Horizon Africa, run this checklist on a **test WABA/test number** instead
> - [ ] Payment gateway confirmed live (PayFast or Yoco per business rules)
> - [ ] Pilot scope agreed in writing with client (§10.3)

---

## 1. Inbound classification — §4.2

Send each message from the test number to the business line. After each reply, check `conversations` in Supabase (or the Conversations page): `message_category` must match the expected value.

| # | Customer sends | Expected category | Pass |
|---|----------------|-------------------|------|
| 1.1 | "Do you have this abaya in size 34?" | `sales` | [ ] |
| 1.2 | "How much is the black dress?" | `sales` | [ ] |
| 1.3 | "That's too expensive" | `sales` (objection handled by Layla, not classified as complaint) | [ ] |
| 1.4 | "Where is my order?" | `orders` | [ ] |
| 1.5 | "Can I change the size I ordered?" | `orders` | [ ] |
| 1.6 | "The payment link isn't working" | `payments` | [ ] |
| 1.7 | "When will I get my refund?" | `payments` | [ ] |
| 1.8 | "Has my parcel shipped?" | `delivery` | [ ] |
| 1.9 | "Can I collect instead?" | `delivery` | [ ] |
| 1.10 | "Salaam, what are your hours?" | `general` | [ ] |
| 1.11 | "This is unacceptable, your service is terrible" | `complaints` | [ ] |
| 1.12 | Gibberish: "asdkfj qwer zzz" | `uncertain` → routed to human review (escalation flag / staff alert) | [ ] |
| 1.13 | Voice note / image with no text context | `uncertain` → human review | [ ] |

**Staff alerts (§4.2):**
- [ ] 1.14 A `payments` message triggers a staff alert (email/handover flag — check `leads.needs_escalation` or staff_alerts/notification path)
- [ ] 1.15 A `delivery` message triggers a staff alert
- [ ] 1.16 A `complaints` message triggers a staff alert
- [ ] 1.17 A `general` or `sales` message does **not** alert staff
- [ ] 1.18 Every inbound message has `message_category` set — no NULL categories on processed conversations

---

## 2. Stock-on-hand sale end-to-end — §4.3

**Setup:** pick an in-stock Shopify product with >1 unit (note variant ID and stock level from Products page).

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 2.1 | Customer asks about the product via WhatsApp | Layla replies with correct product name, price, and confirms stock (live Shopify check, not stale data) | [ ] |
| 2.2 | Customer says they want to buy it | Layla collects delivery details (name, address, delivery method) | [ ] |
| 2.3 | Order created | `POST /api/orders/create` succeeds; Shopify **draft order** exists; inventory reserved; order row in `orders` table with `order_track = stock_on_hand`, status `pending_payment` | [ ] |
| 2.4 | Payment link | Customer receives a secure payment link in WhatsApp (Shopify invoice URL); Layla never asks for card numbers/bank details | [ ] |
| 2.5 | Dashboard — Orders page | New order visible with items, total, customer phone, `pending_payment` badge | [ ] |
| 2.6 | Staff alert | Staff notified of the new order (alert email / staff_alerts) | [ ] |
| 2.7 | Pay the order (real payment per pilot, or simulated `orders/paid` webhook for dry-run) | Signed Shopify webhook marks order `paid`; `order_events` records the transition | [ ] |
| 2.8 | Confirmation + receipt | Customer receives order confirmation **and invoice/receipt in WhatsApp** after payment | [ ] |
| 2.9 | Dashboard | Order detail page shows paid status, Shopify IDs, event timeline | [ ] |
| 2.10 | Follow-ups | No unpaid-order follow-ups scheduled for a paid order (see §5) | [ ] |

**Out-of-stock revalidation:**
- [ ] 2.11 Set the test variant's Shopify stock to 0 (or pick an out-of-stock item), attempt the order → API returns conflict/`out_of_stock`, Layla tells the customer honestly, **no order/payment link created**
- [ ] 2.12 Restore stock.

**Single-unit race (two buyers, one unit):**
- [ ] 2.13 Set stock to exactly 1. Create order A (payment link issued, unit reserved). Attempt order B for the same variant → B is told it's unavailable. Complete payment for A → succeeds; B still blocked.
- [ ] 2.14 If A's draft expires unpaid, the reserved unit releases and becomes purchasable again (stale-order expiry path).

---

## 3. Imported orders track — §4.4

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 3.1 | Customer asks for an item Layla identifies as imported/online-order | Layla explains terms: **6-week lead time**, **50% deposit up front**, balance before dispatch — states lead time honestly, does not promise earlier | [ ] |
| 3.2 | Customer wants to proceed | Enquiry recorded via `/api/orders/imported` → order row with `order_track = imported`, status `handed_to_orders`; **no Shopify draft order created** | [ ] |
| 3.3 | Handover | Enquiry handed to `orders@easternwearbykersh.com` (n8n/Brevo email) with customer + item details | [ ] |
| 3.4 | Dashboard — Orders | Imported order visible, filterable by track; shows `handed_to_orders` status | [ ] |
| 3.5 | Separate reporting | Reports page splits order counts by track (`stock_on_hand` vs `imported`) | [ ] |
| 3.6 | `order_track` set on the conversation and lead for the imported enquiry | [ ] |

---

## 4. Human takeover — §4.6

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 4.1 | Start a normal conversation; confirm Layla replies automatically | [ ] |
| 4.2 | Team member takes over in Chatwoot (or via dashboard "Take over" button) | `leads.human_takeover = true`; Conversations page shows "Human in control"; `handover_events` row logged | [ ] |
| 4.3 | Customer sends another message while takeover active | **Layla does not reply**; message still logged in `conversations` (sentinel `ai_response`, no AI call, no WhatsApp send) | [ ] |
| 4.4 | Missed-message recovery does NOT resubmit takeover messages to the AI | [ ] |
| 4.5 | Release (Chatwoot resolve or "Release to Layla") | `human_takeover` cleared; release event logged; next customer message gets a normal Layla reply | [ ] |

---

## 5. Unpaid-order follow-ups — §4.5

**Setup:** create a pending-payment order (stock-on-hand flow through step 2.4, do not pay).

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 5.1 | On order creation | 3 follow-up rows scheduled at **+4h, +24h, +72h** (from `FOLLOWUP_HOURS`, configurable), status `pending` | [ ] |
| 5.2 | Follow-Ups page | "Order Payment Reminders" section lists the scheduled nudges with order link | [ ] |
| 5.3 | Fast-forward `scheduled_for` to now; run follow-ups cron | Due nudge sends a WhatsApp template message; status → `sent`; next step remains scheduled | [ ] |
| 5.4 | Pay the order | All remaining `pending` follow-ups cancel (`cancelled`); no further messages | [ ] |
| 5.5 | New unpaid order; customer replies declining ("no thanks, cancel it") | Pending follow-ups cancel; declined stop condition honoured | [ ] |
| 5.6 | New unpaid order; customer sends `STOP` | Added to `opt_out_list`; pending follow-ups cancel; no further sends — verified | [ ] |
| 5.7 | Order expires unpaid | Pending follow-ups cancel on expiry | [ ] |
| 5.8 | Report | "Follow-up conversion" metric counts an order paid **after** entering the sequence (§8 definition) | [ ] |

---

## 6. Shopify customer sync → broadcast — §4.7

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 6.1 | Broadcasts page → "Sync Shopify" | `/api/broadcasts/sync-shopify` runs: customers synced, "Eastern Wear Customers" group created/reused, contacts upserted with `source` | [ ] |
| 6.2 | Consent respected | Only `accepts_marketing` customers imported; customers without marketing consent excluded | [ ] |
| 6.3 | Global opt-out respected | Any phone in `opt_out_list` is excluded even if `accepts_marketing` is true | [ ] |
| 6.4 | Re-run sync | No duplicate contacts (dedupe on `group_id + phone_number`); manual opt-out choices preserved | [ ] |
| 6.5 | Send a test broadcast to the group (test numbers only) | Sends only to eligible contacts; opted-out numbers skipped | [ ] |
| 6.6 | Recipient replies `STOP` to the broadcast | Added to opt-out list; excluded from next send | [ ] |

---

## 7. Website WhatsApp button — §4.1

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 7.1 | Open a product page on easternwearbykersh.com | Floating WhatsApp button visible (per `docs/shopify-button-install.md`) | [ ] |
| 7.2 | Click the button | WhatsApp opens to the business number with a **prefilled message containing the product title + /products/<handle> URL** | [ ] |
| 7.3 | Send the prefilled message | Layla replies **knowing which garment** the customer was viewing — correct name, price, stock status (product-context lookup against `shopify_products`) | [ ] |
| 7.4 | Click from the home page (no product context) | Button still works; message has no product context; Layla handles as a general enquiry | [ ] |
| 7.5 | Product-context flow does not break if the handle matches no synced product | Graceful fallback — Layla asks which item they mean | [ ] |

---

## 8. Dashboard & reporting — §8 metrics + §4.3 tracking

| # | Check | Expected result | Pass |
|---|-------|-----------------|------|
| 8.1 | Orders list page | Both tracks listed; status badges correct; search/filter works | [ ] |
| 8.2 | Order detail | Items, totals, delivery, payment status, Shopify IDs, event timeline | [ ] |
| 8.3 | Reports — **Order created** count | Matches §8 definition (link issued), split by track | [ ] |
| 8.4 | Reports — **Order paid** count | Matches §8 definition (paid webhook), split by track | [ ] |
| 8.5 | Reports — **Follow-up conversion** | Unpaid→paid after entering sequence, split by track | [ ] |
| 8.6 | Reports — **Handover** count | Matches `handover_events`; active takeovers shown | [ ] |
| 8.7 | Reports — **Opt-out** count | Period + total opt-outs | [ ] |
| 8.8 | Customer journey view | Lead profile shows conversation thread, orders, handover state | [ ] |
| 8.9 | Branding | No "Horizon Africa"/fibre/Telkom strings anywhere in the UI; Eastern Wear branding throughout | [ ] |

---

## 9. Number cutover & automation — §4.9 (M8 gate)

| # | Check | Expected result | Pass |
|---|-------|-----------------|------|
| 9.1 | Full Horizon Africa backup verified | `backups/horizon-pre-repurpose-2026-10-16/` — 24 table exports + manifest row counts + n8n exports + Supabase native backup downloaded by Mo | [ ] |
| 9.2 | Old telecoms automation OFF | Telecoms campaign processing/inbound paths disabled; no Horizon-branded replies can fire on the line | [ ] |
| 9.3 | WABA display name / business assets updated to Eastern Wear (Meta review done) | [ ] |
| 9.4 | Webhook/callback URLs point at the correct deployment; Meta GET verification passes on `/api/whatsapp-webhook` | [ ] |
| 9.5 | End-to-end test message on the live number post-cutover | Inbound → classification → reply, logged correctly | [ ] |
| 9.6 | n8n error alerts, missed-message recovery, webhook health monitor all still fire (post-cutover verification) | [ ] |

---

## 10. Controlled pilot — §10.3

- [ ] Pilot scope agreed in writing with client (test customers/orders list)
- [ ] **At least one REAL paid order end-to-end** — stock-on-hand flow with a real payment through the live gateway: order → link → payment → webhook → WhatsApp confirmation + receipt → dashboard paid status
- [ ] All findings logged in `tests/pilot-issues.md`; defects (warranty-class) vs change requests logged separately per §13.3
- [ ] Defects fixed and re-tested; change requests quoted separately

---

## Phase 1 acceptance checklist (contract gate — §4)

| § | Deliverable | Pass |
|---|---|-----|
| 4.1 | Website WhatsApp button with product context | [ ] |
| 4.2 | 6-category classification + routing + staff alerts + uncertain→review | [ ] |
| 4.3 | Stock check → order → payment link → revalidate → paid webhook → confirmation + receipt in WhatsApp → dashboard tracking + staff alert | [ ] |
| 4.4 | Imported track: 6-week/50% terms → Orders@ handover → separate classification | [ ] |
| 4.5 | Unpaid-order follow-ups: configurable, auto-stop on paid/decline/opt-out | [ ] |
| 4.6 | Human takeover pauses Layla | [ ] |
| 4.7 | Shopify customer sync → broadcast lists, opt-outs respected | [ ] |
| 4.8 | Business rules/KB loaded, persona live, ~15 templates approved by Meta | [ ] |
| 4.9 | Full Horizon Africa backup verified; automation off; number live for Eastern Wear | [ ] |
| §8 | Metrics reporting: created/paid/follow-up conversion/handover/opt-out | [ ] |
| §10.3 | Controlled pilot incl. ≥1 live paid order | [ ] |

**Sign-off:** all boxes ticked → Mo reviews → client written acceptance → final 50% (R7,500) invoiced → `git tag phase1-eastern-wear-delivered`

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Tester | | | |
| Reviewed by (Mo) | | | |
| Client acceptance | | | |
