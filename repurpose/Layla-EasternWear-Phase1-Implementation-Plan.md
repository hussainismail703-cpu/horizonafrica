# Layla → Eastern Wear: Phase 1 Implementation Plan — Developer Handoff

**Project:** Layla for Eastern Wear — WhatsApp Sales Engine & Automation, Phase 1
**Developer:** Hoosen
**Reviewer/Merger:** Mo
**Generated:** 15 October 2026
**Repo:** `https://github.com/sifosman/horizonafrica` (the Next.js dashboard app is at the **repo root** — `app/`, `components/`, `lib/`, `supabase/migrations/`, `tests/`)
**Contract reference:** `Layla-EasternWear-Phase1-Scope-Freeze.md` (accepted, deposit paid) — this plan implements exactly that document, nothing more.
**Estimated duration:** ~8 weeks to go-live (M1–M9 below mirror the scope freeze milestones).

---

## How To Use This Document With Devin

This plan is written so each milestone can be handed to Devin (or any AI coding tool) **one at a time**:

1. Give Devin access to the cloned repo.
2. Paste the milestone's **AI Prompt** block (in the fenced code block) into Devin, plus the context paragraph above it.
3. Let Devin implement on the milestone branch.
4. You run the **Testing** steps yourself — do not skip these; Devin's claims of success are not verification.
5. When all checks pass, commit, merge to the feature branch, tag, and move to the next milestone.

**Do not start a milestone until the previous one's testing checklist passes.**

---

## ⚠️ READ FIRST: Pre-Flight Checklist

Complete **in order** before ANY code change. This protects the production app currently serving Horizon Africa.

### Step 0: Backup Everything (DO NOT SKIP)

This satisfies scope freeze §4.9 (full Horizon Africa data backup before repurposing). Do it now, not at M8 — M1 already overwrites telecoms prompts and product data.

```bash
# 0.1 Full database backup
#    Supabase Dashboard → https://supabase.com/dashboard/project/gbchhzipbbxpvgtaheze
#    → Database → Backups → "Download backup"
#    Save as: ~/backups/eastern-wear/horizon-db-pre-repurpose-YYYYMMDD.sql

# 0.2 Export every public table to CSV as well (belt & braces):
#    leads, conversations, products, broadcast_groups, broadcast_contacts,
#    broadcast_history, staff_alerts, campaigns, campaign_steps,
#    campaign_enrolments, campaign_interactions, campaign_classifications,
#    campaign_audit_log, campaign_errors, follow_ups
#    (Supabase → Table Editor → each table → Export to CSV)

# 0.3 Export the n8n workflow JSON:
#    n8n.horizonafrica.co.za → "Horizon Africa - Inbound AI Lead Qualification"
#    → ··· menu → Download. Save as ~/backups/eastern-wear/n8n-inbound-ai-pre-repurpose.json
#    (An older copy exists at horizon-africa/workflow-inbound-ai-v2.json for reference —
#     the live workflow on the n8n server is the source of truth.)

# 0.4 Verify the dashboard builds before you touch it:
cd <repo-root>
npm install
npm run build   # must succeed with zero errors
```

### Step 1: Get Access & Inputs (chase Mo for anything missing)

| # | Item | From | Needed by |
|---|------|------|-----------|
| 1 | Repo access to `sifosman/horizonafrica` + `.env.local` values | Mo | M1 |
| 2 | Supabase dashboard access (project `gbchhzipbbxpvgtaheze`) | Mo | M1 |
| 3 | n8n access (`n8n.horizonafrica.co.za`) | Mo | M1 |
| 4 | Vercel project access | Mo | M3 |
| 5 | **Shopify collaborator access** to easternwearbykersh.com + Admin API access token with scopes: `read_products`, `read_inventory`, `write_draft_orders`, `read_orders`, `read_customers`, `write_customers` | Client via Mo | M2 |
| 6 | Payment gateway confirmation (PayFast or Yoco — whichever is live on the store) | Client via Mo | M3 |
| 7 | Delivery/collection fee structure + rules | Client via Mo | M3 |
| 8 | WhatsApp template copy direction (~15 rewrites + the 2 existing templates) | Client via Mo | M1 |
| 9 | Existing subscriber list (~400 customers, CSV) | Client via Mo | M6 |
| 10 | Branding: confirmed business display name, logo, colour palette | Client via Mo | M7 |
| 11 | Business docs (Business overview + FAQ — already in repo folder `horizon-africa/Layla-Eastern-Wear-/`) | Done | M1 |
| 12 | Chatwoot + Brevo credentials are inside n8n already | — | — |

### Step 2: New environment variables to add

```bash
# .env.local + Vercel env — existing vars stay as-is, ADD:
SHOPIFY_STORE_DOMAIN=rvadvz-kk.myshopify.com           # permanent .myshopify domain
SHOPIFY_CLIENT_ID=...                                # Dev Dashboard app Overview page
SHOPIFY_CLIENT_SECRET=shpss_...                      # Dev Dashboard app Overview page
SHOPIFY_API_VERSION=2026-10                          # latest stable at time of work
SHOPIFY_WEBHOOK_SECRET=...                           # key that signs the webhooks: the
                                                     # Notifications→Webhooks page key for
                                                     # admin-registered hooks, or the client
                                                     # secret for app-registered hooks
# No SHOPIFY_ADMIN_ACCESS_TOKEN: this is a Dev Dashboard app — lib/shopify.ts
# fetches a token via client_credentials grant and refreshes it (~24h expiry).
```

---

## 1. Architecture — What Actually Exists Today

```
Customer WhatsApp
      │
      ▼
Meta WhatsApp Business API (verified number — currently "Horizon Africa")
      │
      ▼
Vercel: app/api/whatsapp-webhook/route.ts
  • verifies Meta signature, dedupes, records delivery statuses
  • detects campaign responses (lib/campaign-detection.ts)
  • classifies responses (lib/classification.ts — telecoms rules)
      │
      ▼ forwards to
n8n.horizonafrica.co.za  ← "Inbound AI Lead Qualification" workflow
  • fetch conversation history (Supabase) → fetch products (Supabase)
  • build OpenRouter prompt (Layla persona — Telkom agent today)
  • call OpenRouter → send WhatsApp reply → log conversation → upsert lead
  • hot-lead check → Brevo email alert
  • escalation check → Chatwoot handover + escalation email
  • error trigger → error alert email
      │
      ▼
Supabase Postgres (gbchhzipbbxpvgtaheze) — all tables + migrations
      │
      ▼
Next.js dashboard (Vercel) — leads, conversations, broadcasts, campaigns,
follow-ups, products, templates, reports, health, calling-queue, settings
```

**Key point:** the AI "brain" (persona, product injection, routing, handover) lives in the **n8n workflow**, not in the Next.js code. Milestones below say explicitly whether work is in `repo`, `n8n`, `Supabase`, or `Shopify`.

### Key files to know (repo root paths)

| File | Purpose |
|---|---|
| `app/api/whatsapp-webhook/route.ts` | Meta webhook entry — verify/dedupe/classify → forwards to n8n |
| `lib/classification.ts` | Keyword + OpenRouter classification (fibre rules today) |
| `lib/campaign-detection.ts` | Detects inbound replies from campaign enrolments |
| `lib/campaign-engine.ts` / `lib/campaign-stats.ts` | Campaign sequence engine + stats |
| `lib/follow-ups.ts` | Scheduled follow-up sends (reuse for unpaid orders) |
| `lib/delivery-status.ts`, `lib/phone-utils.ts`, `lib/format.ts` | Helpers |
| `lib/types.ts` | All TypeScript types |
| `app/(app)/products/` + `components/product-manager.tsx` | Products UI (fibre packages today) |
| `app/(app)/campaigns/` | Campaign engine UI (exists, works) |
| `app/(app)/templates/` + `components/template-manager.tsx` | Meta template create/submit/track |
| `app/(app)/broadcasts/` | Broadcast groups, sends, delivery tracking |
| `app/(app)/leads/` + `components/lead-table.tsx` | CRM (telecoms field labels today) |
| `app/(app)/reports/` | Reporting |
| `supabase/migrations/*.sql` | All schema changes — new work goes in new dated migration files |
| `tests/*.mjs` | Existing test scripts — extend, don't delete |

---

## 2. Git & Branching Strategy

```
main                          ← PRODUCTION (only Mo merges, after review)
  └── eastern-wear/phase1     ← Phase 1 integration branch (Hoosen works here)
       ├── ew/m1-persona-classification
       ├── ew/m2-shopify-connection
       ├── ew/m3-order-flow
       ├── ew/m4-imported-orders
       ├── ew/m5-website-button
       ├── ew/m6-followups-broadcasts
       ├── ew/m7-rebrand-reporting
       ├── ew/m8-backup-cutover
       └── ew/m9-testing-pilot
```

Per milestone: `git checkout eastern-wear/phase1 && git checkout -b ew/mX-...` → work → commit often → merge back → `git tag ew-mX-complete` → PR to `main` for Mo.

n8n has no git — **export the workflow JSON after every n8n change** and save it into the repo at `n8n/workflows/` (create this directory in M1) so changes are versioned.

---

## 3. Database Backup & Recovery Protocol

Same rules as the Horizon Africa build (see `BACKUP-RECOVERY.md` in repo):

1. **Manual backup before every milestone** — Supabase → Database → Backups → Download. Non-negotiable.
2. Save row counts (`pg_stat_user_tables`) alongside each backup.
3. Keep last 3 backups outside the repo; Mo keeps a copy too.
4. Recovery: Supabase → Database → Backups → Restore; verify against saved row counts.

---

## 4. Decisions Locked (don't re-litigate mid-build)

1. **Payment link approach:** Layla creates a **Shopify Draft Order** (Admin API) → uses its `invoice_url` as the secure payment link → customer pays on the client's existing Shopify checkout (PayFast/Yoco already configured there — we never touch card data or gateway config) → Shopify `orders/paid` webhook marks our order record paid. This keeps stock, orders and fulfilment inside the client's existing Shopify dashboard, which the scope freeze requires ("no changes to the Shopify store itself", "fulfilment is the client's process"). *Fallback if the client can't grant draft-order scope: direct PayFast/Yoco link + gateway ITN webhook — flag to Mo before switching.*
2. **Data wipe vs retain:** scope freeze requires a **backup** before repurposing (Step 0). Whether to wipe Horizon leads/conversations for a fresh start is **Mo's call with the client** — do not delete anything; flag in M7 if undecided.
3. **Classification categories (inbound routing)** are the scope freeze set: `sales`, `orders`, `payments`, `delivery`, `general`, `complaints`, `uncertain` — this is separate from campaign-response classification (`interested` / `not_interested` / etc.) which stays but gets clothing reasons.
4. **Two sales tracks** are stored as `orders.order_track = 'stock_on_hand' | 'imported'` and `leads`/conversations carry the track for reporting.
5. **Human handover pause (§4.6):** no pause mechanism exists today — it is built in M4 (flag on the conversation/lead that n8n checks before replying; Chatwoot assignment sets it; manual release in dashboard).
6. **Website chat button (§4.1):** a small Liquid snippet + `wa.me` deep link with pre-filled product context. Adding one snippet to the client's theme is the deliverable — coordinate with client via Mo (collaborator access); do not modify anything else in the theme.

---

## 5. Milestone-by-Milestone Implementation

*(Mirrors scope freeze §10.1 so client progress reporting matches the contract.)*

---

### M1: Persona, Classification, Knowledge Base & Templates — `[repo + n8n + Supabase]`

**Scope freeze refs:** §4.2, §4.8 · delivers milestone M1.

**Context for Devin:** The Layla AI lives in the n8n "Inbound AI Lead Qualification" workflow (prompt in the "Build OpenRouter Request" code node; products fetched via "Fetch Products"). The dashboard repo is a Next.js 15 + Supabase app; classification of campaign replies is in `lib/classification.ts` with telecoms-specific rules; inbound intent routing categories live in the n8n prompt.

#### AI Prompt (paste into Devin):

```
I'm repurposing a WhatsApp AI sales platform ("Layla") from a telecoms business (Horizon Africa) to a women's eastern clothing business (Eastern Wear by Kersh). Do the M1 slice only.

REPO CHANGES:

1. Migration supabase/migrations/20261015XXXXXX_eastern_wear_m1.sql:
   - ALTER TABLE conversations ADD COLUMN IF NOT EXISTS message_category text
     CHECK (message_category IN ('sales','orders','payments','delivery','general','complaints','uncertain'));
   - ALTER TABLE conversations ADD COLUMN IF NOT EXISTS order_track text
     CHECK (order_track IN ('stock_on_hand','imported'));
   - ALTER TABLE leads ADD COLUMN IF NOT EXISTS order_track text
     CHECK (order_track IN ('stock_on_hand','imported'));
   - Widen the campaign_classifications.rejection_reason CHECK constraint to also allow
     clothing reasons: 'price','sizing_fit','delivery_time','style_design','competitor',
     'not_now','needs_more_info','not_needed','other' (keep existing values valid too —
     drop and recreate the check with the union).
   - CREATE INDEX on conversations(phone_number, created_at) if not present.

2. lib/classification.ts — retune for clothing (same function signatures, same
   keyword-first-then-OpenRouter structure, same uncertain<0.5→human-review fallback):
   - Remove telco keyword rules (fibre, telkom, vodacom, mtn, etc.).
   - Clothing keyword rules: price objections ("too expensive","can't afford"),
     sizing/fit ("will it fit","size not available"), delivery time ("how long",
     "take too long"), style/design, competitor/already-bought, "not interested",
     interested/buy intent, callback requested.
   - Update the OpenRouter prompt text inside classifyResponse to describe the
     Eastern Wear context and the new rejection reasons.
   - Update Classification/RejectionReason types in lib/types.ts to match.

3. Lead field relabels (schema unchanged — labels only):
   - household_size → shown as "Size" in UI
   - internet_usage → shown as "Style / Occasion"
   - recommended_package → shown as "Recommended Garment"
   Update components/lead-table.tsx, app/(app)/leads/page.tsx, and any export headers.

4. Replace all "Horizon Africa" / fibre wording in UI copy, email alert subjects,
   and the lead upload template with Eastern Wear equivalents (grep for it).
   Leave branding proper (logo/colours) for M7 — wording only now.

N8N WORKFLOW (I will do this part myself after you finish the repo side — just
write me the exact artefacts):
   - Write the new Layla system prompt to n8n/prompts/layla-system-prompt.md:
     eastern-wear sales consultant. Discovery: size, occasion (Eid, wedding,
     formal, everyday), budget, style preference. Objection handling for
     clothing: price, fit anxiety, delivery times, returns/exchanges, fabric
     quality, "need to think/ask husband". Close-oriented + tasteful upsell
     (matching scarf, second colourway). Never authorises discounts.
   - Write the knowledge-base file n8n/prompts/business-rules.md seeded with
     placeholders for: shipping rates, collection details, returns policy,
     no-unauthorised-discounts rule (I will fill values from the client's
     Business overview + FAQ docs).
   - Write the inbound classification spec n8n/prompts/inbound-categories.md:
     every inbound message tagged sales|orders|payments|delivery|general|
     complaints|uncertain + which categories trigger a staff alert
     (payments, delivery, complaints, uncertain → alert).

TESTING: npm run build must pass. I'll apply the migration in Supabase myself.
```

**Then Hoosen does (n8n, manual):**
- Import the new system prompt + business rules into the workflow's prompt node. Keep the telecoms prompt in a comment/sticky note inside the workflow until cutover (M8).
- Update the classification node/prompt to output the new inbound categories and write `message_category` to the conversations insert.
- Draft the ~15 template rewrites with client's copy direction and submit via the dashboard template manager — Meta approval is 24–48h each; **start these in week 1**, they gate nothing but the pilot.

#### Testing M1:
- [ ] Migration applies cleanly; new columns + CHECKs present.
- [ ] `npm run build` passes.
- [ ] classifyResponse("too expensive for a dress") → `not_interested`/`price`; ("what sizes do you have") → appropriate class, no telco rules firing.
- [ ] Leads UI shows Size / Style-Occasion / Recommended Garment labels.
- [ ] New system prompt file exists; n8n workflow updated and replying as the Eastern Wear persona on a test chat.

---

### M2: Shopify Connection — Products Feed + Customer Sync — `[repo + Supabase + Shopify]`

**Scope freeze refs:** §4.3 (stock read), §4.7 (customer sync) · milestone M2.

#### AI Prompt (paste into Devin):

```
Add a Shopify integration to this Next.js 15 + Supabase app. Store:
easternwearbykersh.com (Shopify). Env: SHOPIFY_STORE_DOMAIN,
SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_API_VERSION,
SHOPIFY_WEBHOOK_SECRET. The app is a Dev Dashboard app with no static
token — fetch Admin API tokens via the client_credentials grant and
refresh them (~24h expiry); retry once on 401.

1. Migration supabase/migrations/202610XX_eastern_wear_m2.sql:
   - CREATE TABLE shopify_products (id uuid pk default gen_random_uuid(),
     shopify_product_id bigint unique, handle text, title text, category text,
     image_url text, description text, is_active boolean default true,
     last_synced_at timestamptz, created_at, updated_at);
   - CREATE TABLE shopify_variants (id uuid pk, product_id uuid fk→shopify_products
     on delete cascade, shopify_variant_id bigint unique, title text (size/colour),
     sku text, price_cents int, inventory_qty int, inventory_item_id bigint,
     available boolean, updated_at);
   - CREATE TABLE shopify_customers (id uuid pk, shopify_customer_id bigint unique,
     phone text, email text, full_name text, orders_count int, total_spent_cents bigint,
     tags text[], synced_to_broadcast boolean default false, last_synced_at, created_at);
   - ALTER TABLE leads ADD COLUMN IF NOT EXISTS shopify_customer_id bigint;
   - RLS: authenticated full access on all three.
   - Keep the old telecoms `products` table untouched for now (removed in M7 once
     nothing references it); add a comment noting deprecation.

2. lib/shopify.ts — server-side Shopify Admin API client (fetch, no SDK):
   - listProducts() — paginated /admin/api/{ver}/products.json
   - listCustomers() — paginated customers.json
   - getVariantInventory() — inventory_levels for availability checks
   - createDraftOrder(line_items, customer, note) → returns draft order + invoice_url
   - verifyShopifyWebhook(rawBody, hmacHeader) — HMAC-SHA256; tries
     SHOPIFY_WEBHOOK_SECRET then SHOPIFY_CLIENT_SECRET so either
     webhook-registration path verifies

3. app/api/shopify/sync-products/route.ts (POST, APP_SECRET header):
   pull all products+variants → upsert into shopify_products/shopify_variants;
   deactivate rows no longer in Shopify. Return counts.

4. app/api/shopify/sync-customers/route.ts (POST, APP_SECRET header):
   pull customers → upsert shopify_customers; normalise phones with
   lib/phone-utils.ts; match to leads by phone → set leads.shopify_customer_id.

5. app/api/shopify/stock/route.ts (GET ?variant_id=|?query=):
   live availability check — used by n8n. Returns variant, price, qty, available.

6. app/api/shopify/webhooks/route.ts (POST): verify HMAC, route by topic:
   orders/paid → stub for M3; products/update + products/delete → incremental
   product sync; customers/create + customers/update → upsert shopify_customers.
   Return 200 fast, process async (log to a webhook_events table or console).

7. Update the products dashboard page (app/(app)/products + product-manager.tsx):
   read from shopify_products/variants; show title, variant/size, price, stock qty,
   synced time; "Sync now" button calling the sync route; read-only otherwise.

TESTING: seed with the client's real store once I have the token — write it so a
sync with zero products doesn't crash; all routes require auth/secret.
```

**Hoosen does after Devin:**
- In Shopify admin: register webhooks → `orders/paid`, `products/update`, `products/delete`, `customers/create`, `customers/update` → `https://<vercel-domain>/api/shopify/webhooks`.
- Schedule product sync every 15 min via n8n cron → POST `/api/shopify/sync-products` with APP_SECRET (same pattern as follow-ups cron).
- Update the n8n "Fetch Products" node to query `shopify_products`/`shopify_variants` (title, size/variant, price, stock, image) instead of the old `products` table — or call `/api/shopify/stock` for live checks.

#### Testing M2:
- [ ] Both sync routes run → tables populated from the real store; variants carry size/price/stock.
- [ ] Shopify webhook registration returns 200 + HMAC verified (test from Shopify "send test notification").
- [ ] `/api/shopify/stock?query=<garment>` returns live stock.
- [ ] n8n product fetch returns garments in AI replies (test message: "what dresses do you have in size 34?").
- [ ] Products page shows Shopify data + Sync now works.

---

### M3: Stock-on-Hand Order Flow — `[repo + n8n + Supabase + Shopify]`

**Scope freeze refs:** §4.3, §8 metrics · milestone M3. The flagship deliverable: Layla checks live stock → collects details → creates order → sends payment link → paid webhook → confirmation + invoice in WhatsApp → dashboard tracking + staff alert.

#### AI Prompt (paste into Devin):

```
Build the WhatsApp order flow on top of M2's Shopify client.

1. Migration supabase/migrations/202610XX_eastern_wear_m3.sql:
   - CREATE TABLE orders (id uuid pk, order_number serial unique,
     phone_number text not null, lead_id int fk→leads, shopify_draft_order_id bigint,
     shopify_order_id bigint, order_track text not null
       CHECK (order_track IN ('stock_on_hand','imported')) default 'stock_on_hand',
     items jsonb not null,            -- [{variant_id,title,size,qty,price_cents}]
     subtotal_cents int, delivery_fee_cents int, total_cents int, currency text default 'ZAR',
     delivery_method text CHECK (delivery_method IN ('delivery','collection')),
     delivery_address jsonb, payment_link text, status text not null default 'pending_payment'
       CHECK (status IN ('pending_payment','paid','payment_failed','cancelled','expired')),
     paid_at timestamptz, created_at, updated_at);
   - CREATE TABLE order_events (id uuid pk, order_id uuid fk→orders cascade,
     event text, detail jsonb, created_at);   -- audit: created/link_sent/revalidated/paid/alerted
   - RLS authenticated full access both.

2. lib/orders.ts:
   - createOrder(phone, items, deliveryMethod, address?, feeCents):
       revalidate every variant's live inventory via lib/shopify.ts → if any
       unavailable return {error:'out_of_stock', unavailable:[...]};
       create Shopify draft order → persist orders row (status pending_payment,
       payment_link = draft.invoice_url) → order_events 'created'.
   - markOrderPaid(shopifyOrderId or draftOrderId): set paid, paid_at, order_events 'paid'.
   - expireStaleOrders(): pending_payment older than N hours (default 24, env
     ORDER_LINK_TTL_HOURS) → status 'expired' (draft order stays but link nudged
     by follow-ups in M6).

3. app/api/orders/create/route.ts (POST, APP_SECRET): called BY N8N when Layla has
   assembled a confirmed order. Body: {phone, items:[{variant_id,qty}],
   delivery_method, delivery_address?, customer:{name,email?}}. Returns
   {order_number, payment_link, total_cents} — n8n puts the link in the WhatsApp reply.

4. Extend app/api/shopify/webhooks/route.ts orders/paid handler:
   match draft order → markOrderPaid → order_events → then POST to the n8n
   "order-paid" webhook (env N8N_ORDER_PAID_URL) so n8n sends the WhatsApp
   confirmation + invoice/receipt and the staff alert.

5. app/(app)/orders/page.tsx + sidebar entry ("Orders", ShoppingBag icon):
   table of orders — number, customer phone/name, items, track badge
   (stock_on_hand/imported), total, status badge, created, paid; filter by
   status/track; click-through detail showing items + order_events timeline.

6. app/api/orders/route.ts (GET) feeding that page.

TESTING: include a manual test script tests/order-flow-test.mjs that creates a
test draft order against the real store (small/cheap item), logs the invoice_url.
```

**Hoosen does after Devin:**
- n8n: extend the inbound workflow — when Layla has a confirmed item list + delivery choice + customer name, call `POST /api/orders/create` and reply with the payment link. Add an "order-paid" webhook workflow: send WhatsApp confirmation + receipt text/invoice details, staff alert email (Brevo), calling-queue entry.
- Confirm delivery fee rules with client → bake into `createOrder` call or config table (document the chosen approach in the milestone notes).

#### Testing M3:
- [ ] Full loop on a test item: WhatsApp enquiry → Layla confirms item/size → payment link received → pay (or Shopify "mark as paid" on the draft) → `orders/paid` webhook → order status `paid` → WhatsApp confirmation + receipt → staff alert email → order visible on /orders.
- [ ] Out-of-stock item → Layla says unavailable, no order created, `order_events` shows revalidation failure.
- [ ] Two customers on a single-unit item: first paid wins; second gets a polite out-of-stock on revalidation.
- [ ] Expiry: aged pending orders flip to `expired`.

---

### M4: Imported Orders Track + Human-Handover Pause — `[repo + n8n + Supabase]`

**Scope freeze refs:** §4.4, §4.6 · milestone M4.

#### AI Prompt (paste into Devin):

```
1. Imported-orders track:
   - orders table already has order_track ('imported') — use it.
   - app/api/orders/imported/route.ts (POST, APP_SECRET): n8n calls this when a
     customer wants an imported/online-order item. Body: {phone, item_description,
     notes}. Creates orders row (track='imported', status 'pending_payment' is NOT
     used — add status 'handed_to_orders' to the CHECK via this migration if needed),
     fires order_events 'handed_to_orders', returns ok.
   - The handover email goes via n8n/Brevo — expose no email code here.
   - Reporting: orders page + reports count the two tracks separately.

2. Human-handover pause (scope freeze §4.6 — build it, it doesn't exist):
   - ALTER TABLE leads ADD COLUMN human_takeover boolean default false,
     human_takeover_at timestamptz;
   - app/api/handover/route.ts: POST {phone, take_over:boolean, by:string} —
     sets/clears the flag (Chatwoot agent assignment calls this via n8n;
     dashboard button too).
   - lib guard: export isHumanTakeover(phone) from lib/orders.ts or lib/handover.ts.
   - conversations page: show "Human in control" badge when flagged; add
     release button.
   - app/api/whatsapp-webhook/route.ts: skip nothing (classification still runs),
     but include takeover status in the payload forwarded to n8n.
```

**Hoosen does after Devin:**
- n8n: add a check node before the AI call — if `human_takeover` (from webhook payload or Supabase lookup) is true, skip Layla's reply entirely (log but don't send). Wire a Chatwoot webhook/trigger: on agent assignment → POST `/api/handover` take_over=true; on conversation resolved → take_over=false.
- n8n imported-orders flow: Layla explains 6-week lead time + 50% deposit terms, confirms intent, calls `/api/orders/imported`, sends handover email to **Orders@easternwearbykersh.co.za** (Brevo), Chatwoot alert.

#### Testing M4:
- [ ] "I want to order the imported abaya" → Layla explains terms → orders row (track=imported) → email lands at Orders@ → Chatwoot alert.
- [ ] Agent takes over in Chatwoot → further customer messages get NO Layla reply → release → Layla resumes.
- [ ] Orders page filters both tracks correctly.

---

### M5: Website WhatsApp Chat Button with Product Context — `[Shopify theme + n8n]`

**Scope freeze ref:** §4.1 · milestone M5.

#### AI Prompt (paste into Devin):

```
Create the deliverables for a WhatsApp chat button on the client's Shopify store
that carries product context:

1. public/snippets/layla-whatsapp-button.liquid — a self-contained Shopify
   snippet: floating WhatsApp button on product pages that opens
   https://wa.me/<NUMBER>?text=<prefilled>. Prefill: "Hi Layla! I'm looking at
   the {{ product.title }} ({{ shop.url }}{{ product.url }}) — is it available?"
   Use theme settings defaults; no external JS dependencies; accessible
   (aria-label), brand colour via a snippet parameter.

2. docs/shopify-button-install.md — step-by-step for the client/dev:
   where to paste {% render 'layla-whatsapp-button' %} in the theme
   (product template / theme.liquid), how to set the number.

3. n8n side spec doc (n8n/prompts/website-context.md): how Layla should parse
   an inbound first message containing a product URL/name — look up the product
   in shopify_products by handle/title, greet with that garment's context.
```

**Hoosen does:**
- Coordinate install with client (collaborator access) or send the client `docs/shopify-button-install.md` + the snippet.
- n8n: product-context parsing on inbound (handle lookup → greeting mentions the garment + live stock).

#### Testing M5:
- [ ] Click button on a product page → WhatsApp opens with prefilled product context.
- [ ] Layla replies knowing which garment (test: click → send → reply references the right product + stock).

---

### M6: Unpaid-Order Follow-Ups + Broadcast Readiness — `[repo + n8n + Supabase]`

**Scope freeze refs:** §4.5, §4.7 · milestone M6.

#### AI Prompt (paste into Devin):

```
1. Unpaid-order follow-ups — reuse the existing follow_ups machinery
   (lib/follow-ups.ts, app/api/follow-ups/*):
   - ALTER TABLE follow_ups ADD COLUMN order_id uuid fk→orders null,
     ADD COLUMN sequence_step int default 1; (keep existing columns working.)
   - When an order stays pending_payment, schedule a configurable sequence
     (defaults env: FOLLOWUP_HOURS='4,24,72' → 3 nudges), using approved
     templates (template names configurable in a settings row or env).
   - app/api/follow-ups/cron already runs on a schedule — extend it to process
     order follow-ups: send next nudge, then STOP automatically when the order
     is paid/cancelled/expired, the customer declines, or opts out.
   - follow_ups UI: show order-linked follow-ups with order number + status.

2. Broadcast readiness (scope §4.7):
   - Synced Shopify customers → importable into broadcast_contacts: add a
     "Sync Shopify customers" action on the broadcasts page → upserts
     broadcast_contacts (source='shopify', opt_in default true where Shopify
     marketing consent allows — respect accepts_marketing + our opt-outs).
   - Import client's ~400-subscriber CSV via existing bulk import; create
     "Eastern Wear Customers" group.
   - Opt-out: existing broadcast opt-out logic must exclude opted-out numbers —
     verify with a test broadcast of 2 contacts.

TESTING: create pending order → cron → nudge 1 sends → mark paid → cron → no
further nudges. Opt-out → excluded from order nudges AND broadcasts.
```

#### Testing M6:
- [ ] 3-step nudge sequence fires on schedule, stops on payment/decline/opt-out.
- [ ] Shopify customers appear in broadcast contacts, marketing-consent respected.
- [ ] ~400 subscriber list imported into a group; test broadcast delivers + tracks read status.

---

### M7: Dashboard Rebrand + Reporting — `[repo + Supabase]`

**Scope freeze refs:** §3 (platform foundation), §8 metrics · milestone M7.

#### AI Prompt (paste into Devin):

```
Rebrand and final reporting polish for Eastern Wear:

1. Branding (assets provided in /branding or attached):
   - Replace logo (app/assets/logo.png → client's), login page, sidebar, top bar,
     email/Brevo alert templates wording, browser title, theme colours to the
     client palette (tailwind.config.ts + globals.css).
   - Business name everywhere: "Eastern Wear by Kersh" (confirm exact display
     name with Mo first).

2. Reporting — metrics per scope freeze §8:
   - /reports page: add cards/table for Order created, Order paid, Follow-up
     conversion (unpaid order → paid after entering sequence), Handover count,
     Opt-out count — split by order_track (stock_on_hand vs imported).
   - app/api/reports/route.ts: add these aggregates (date-range filterable).

3. Cleanup:
   - Remove the legacy telecoms `products` table + product-manager fibre fields
     IF nothing references them (grep first — n8n must be fully on
     shopify_products); drop via migration only after confirming.
   - Hide/rename telecoms-only UI (speeds, uncapped, monthly billing labels).
   - If client chose fresh start: wipe telecoms rows (leads/conversations/
     campaign data) — ONLY with Mo's written go-ahead and confirmed backups.

TESTING: npm run build; visual pass login→dashboard→reports; report numbers
correct on seeded test data.
```

#### Testing M7:
- [ ] Rebrand visible everywhere; no "Horizon Africa"/fibre strings left in UI.
- [ ] Reports show the five §8 metrics correctly, split by track.
- [ ] No dead UI; build clean.

---

### M8: Number Cutover + Go-Live — `[ops — n8n + Meta + Vercel]`

**Scope freeze ref:** §4.9 · milestone M8. **Mostly manual, Hoosen + Mo together.**

- [ ] Confirm Step-0 backups exist + verified restore path (spot-restore one table to a scratch schema or row-count compare).
- [ ] Switch OFF Horizon Africa automation: disable the old inbound workflow paths / telecoms campaign processing that must not fire under the new brand.
- [ ] Meta: update the WABA display name / business assets to Eastern Wear (Meta review may take time — submit early in the project, not at M8).
- [ ] Point webhook/callback URLs at the new deployment domain if rebranded; verify Meta verification still passes (`/api/whatsapp-webhook` GET).
- [ ] Cutover checklist run on a quiet window; test message end-to-end on the live number.
- [ ] Confirm n8n error alerts, missed-message recovery, health monitor all still fire.

---

### M9: Testing, QA & Controlled Pilot — `[all]`

**Scope freeze refs:** §10.2, §10.3 · milestone M9.

#### AI Prompt (paste into Devin):

```
Write tests/phase1-eastern-wear-e2e.md — a manual E2E checklist covering every
scope freeze §4 deliverable with steps + expected result + pass checkbox:

- Inbound classification into the 6 categories (+uncertain→review).
- Stock-on-hand sale end-to-end incl. out-of-stock revalidation and single-unit
  race.
- Imported order: terms message → Orders@ handover → separate reporting.
- Human takeover pause + release.
- Unpaid-order follow-up start/stop rules.
- Shopify customer sync → broadcast → opt-out honoured.
- Website button → product-context conversation.
- Staff alerts for payments/delivery/complaints.
- Order/receipt in WhatsApp after payment.
- Dashboard: orders page, reports metrics (§8), journey view.
Format: markdown checkboxes like the existing tests/*.md docs.
```

**Controlled pilot (per scope freeze §10.3 — agree scope in writing with client first):**
- Limited set of test customers/orders; **must include at least one real paid order end-to-end**.
- Log findings in `pilot-issues.md`; fix defects (warranty-class) vs log change requests separately.

#### Phase 1 acceptance checklist (scope freeze §4 — the contract gate):

| § | Deliverable | Pass? |
|---|---|---|
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

**Sign-off:** all boxes ticked → Mo reviews → client written acceptance → final 50% (R7,500) invoiced → `git tag phase1-eastern-wear-delivered`.

---

## 6. Escalation & Questions

- Scope ambiguity → **stop and check `Layla-EasternWear-Phase1-Scope-Freeze.md` first**; if it's genuinely outside scope (e.g., courier booking, inventory management, SMS), log as a change request — don't build it.
- Client input delays (Shopify access, template copy, fees) → flag to Mo immediately; they gate M2/M3.
- Anything that risks production WhatsApp (Meta app changes, webhook URL changes) → do it with Mo, not solo.
