# Eastern Wear by Kersh — Status Report

**Date:** 20 October 2026
**Branch:** `eastern-wear/phase1` (all work committed locally; nothing pushed)

---

## 1. Where we are

Phase 1 build is **code-complete** (M1–M7 delivered and merged). The
repurpose work — business rules, separate Layla workflow, client decisions —
is done. What remains is client approval, Meta template approval, and the
joint cutover + pilot (M8/M9).

```
M1 Persona/classification/knowledge base ... DONE
M2 Shopify connection (products + customers) DONE
M3 Stock-on-hand order flow ............... DONE (no-reservation applied)
M4 Imported orders + human handover ....... DONE
M5 Website WhatsApp button ................ DONE
M6 Order follow-ups + broadcast sync ...... DONE
M7 Reporting + dashboard rebrand .......... DONE
M8 Number cutover ......................... PENDING (runbook ready)
M9 Controlled pilot ....................... PENDING (acceptance checklist ready)
```

## 2. Horizon Africa data — preserved

- All data stays in Supabase (nothing deleted).
- Portable export: `backups/horizon-africa-data-export-2026-10-20.zip`
  (734 KB — send to the client via WeTransfer).
- Contents: 58 leads, 2,500 conversations, 44 campaigns, 1,741 webhook
  messages, 2,203 delivery-failure records, products, users + manifest/README.
  No secrets included.
- Supabase native backup still to download (Dashboard → Database → Backups).

## 3. Client decisions applied (Asif, 20 Oct)

| Decision | Status |
|---|---|
| Separate Eastern Wear workflow (telecoms kept as rollback) | Done — `XrSnS0xF2bKZPSq1`, inactive |
| Contact email `orders@easternwearbykersh.com` | Done |
| Collection hours Mon–Fri 09:00–17:00 | Done |
| Stock NOT reserved before payment | Done — reservation removed from order flow |
| Payment via Shopify checkout links (Payflex available) | Done |
| Layla never gives out the shop number — handover in chat | Done — prompt + verifier |
| Shop number confirmed: 068 247 7199 | Done — website Contact page typo is a site fix |
| Alert emails unchanged (to Sif) | Done |

## 4. WhatsApp template report

### 4a. What exists today (telecoms — in Meta account / in use)

| Template | Used by | Status |
|---|---|---|
| `telkom_fibre_packages` | Campaign step 1 (4 price params) | Retire at cutover |
| `telkom_reengagement` | Campaign step 2 (contact name) | Retire at cutover |
| `horizon_followup_v6` | Follow-up sender + order nudges (name, item) | Retire at cutover |
| `hello_world` | Meta default test | Keep — testing only |

> The full account may hold more `horizon_*`/`telkom_*` templates — the
> dashboard pulls the live list from Meta, so check Meta Business Manager for
> the complete inventory before cutover. Nothing in the database, workflows
> or codebase references any others.

### 4b. Eastern Wear templates — drafted, awaiting Asif's approval

File: `repurpose/ew-meta-templates-draft.md` (written in the client's voice
from business-doc Templates 1 & 2). Replaces the telecoms set above.

| Template | Category | Purpose | Params |
|---|---|---|---|
| `ew_order_confirmation` | UTILITY | Invoice/payment link sent; warns stock not held | name, item, link |
| `ew_payment_reminder_1` | UTILITY | Nudge +4h | name, item |
| `ew_payment_reminder_2` | UTILITY | Nudge +24h — confirm availability first | name, item |
| `ew_payment_reminder_3` | UTILITY | Final nudge +72h | name, item |
| `ew_collection_reminder` | UTILITY | Day-before appointment reminder | name, window |
| `ew_imported_order_update` | UTILITY | Arrived / balance-due notice | name, item, status |
| `ew_campaign_intro` | MARKETING | New-stock campaign step 1 | name, collection |
| `ew_reengagement` | MARKETING | Campaign step 2 | name |
| `ew_followup_nudge` | MARKETING | Lead follow-up — drop-in for `horizon_followup_v6` | name, item |
| `ew_imported_terms` | MARKETING | Imported-order terms for out-of-window sends | name |

Deliberately excluded: no discount/promo template (§5.1), no phone numbers,
no Bluff street address in any template.

### 4c. What each side still needs to do

- **Asif:** approved the 10 drafts (2 Nov).
- **Meta:** all 10 **APPROVED** (2 Nov). Ready to wire in at cutover.
- **At cutover:** set `ORDER_FOLLOWUP_TEMPLATES=ew_payment_reminder_1,…,2,…,3`,
  retarget the follow-up sender at `ew_followup_nudge`, verify no active
  workflow references `telkom_*`/`horizon_*`.

## 5. Outstanding items

**Waiting on client:**
- Template draft approval (above)
- Eastern Wear logo + colours for the dashboard
- WABA display name + business assets → submit to Meta
- Pilot plan + cutover window in writing
- Fix website Contact page number (`+276824771999` → 068 247 7199)
- WeTransfer the backup zip

**Our side:**
- Top up OpenRouter credits (all AI calls currently fail 402)
- Re-run `tests/order-flow-test.mjs` post no-reservation change
- Build EW version of the follow-up sender workflow (offered; pending)
- Download Supabase native backup
- Rotate the Chatwoot token sitting in old git history **before pushing**
- Push branch + open PR once history is clean

**Cutover (joint session — runbook `docs/eastern-wear-m8-cutover-runbook.md`):**
- Set Meta env vars + signature enforcement
- Activate EW workflow, repoint `N8N_WEBHOOK_URL`
- Deactivate telecoms scheduler/follow-ups
- Post-cutover checks → pilot → written client acceptance

## 6. Risks

| Risk | Mitigation |
|---|---|
| Meta template rejection/delay (24–48h each) | Submit as soon as Asif approves; wording kept non-promotional for UTILITY |
| Two customers pay for the same one-of item (no reservation) | Shopify must be set to not oversell — verify at pilot; second payment is refused at checkout |
| Old telecoms workflow still live until cutover | Intentional — it is the rollback path; EW workflow stays inactive |
| Chatwoot token in local git history | Rotate before any push |
