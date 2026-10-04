# Horizon Africa — Scope Freeze (Reconstructed)

> **⚠️ RECONSTRUCTION — NOT THE ORIGINAL DOCUMENT**
> The original Scope Freeze document referenced by `Phase1-Implementation-Plan.md`
> (M9: "acceptance checklist from the Scope Freeze document, Section 4 + Section 7")
> was not found in the repository, git history, GitHub, or the local filesystem.
> This file reconstructs it from the sources below so scope compliance can be audited
> until the original is provided.
>
> **Provenance markers:**
> - `[V]` **Verbatim** — quoted word-for-word in `Phase1-Implementation-Plan.md`
> - `[Q]` **From signed quote** — `Signed Chatbot quote.pdf` (Q-2026-0619-HC-Rev2)
> - `[Q2]` **From add-on quote** — `Quote - Objection Handling Module.pdf` (Q-2026-0714-HC-OBJ)
> - `[G]` **From user guides** — `docs-dashboard.html`, `docs-chatwoot.html` (31 Jul 2026)
> - `[A]` **From architecture doc** — `workflow-overview.html` (v2.0, 05 Aug 2026)
> - `[I]` **Inferred** — section structure guessed to match known item numbering;
>   must be confirmed against the real document
>
> Reconstructed: 2026-10-04. Replace with the original when available and remap
> item IDs in `tests/scope-compliance-plan.md`.

---

## Section 1 — Purpose & Platform Overview `[I]`

- **1.1** `[Q]` AI-powered WhatsApp sales and customer engagement platform for telecom
  lead qualification: inbound AI chatbot, broadcast capability for marketing
  campaigns, automated staff alerts for hot leads.
- **1.2** `[Q]` Products supported: **Fibre, LTE, Wireless, Starlink**.
- **1.3** `[Q]` Lead data store: Google Sheets for CRM tracking (per quote).
  *Known evolution:* leads are persisted in Supabase and managed via the dashboard
  CRM instead — Google Sheets shows "Not Configured" in Settings. Confirm client
  acceptance of the substitution.
- **1.4** `[Q]` Staff alerts via Brevo email integration.
- **1.5** `[A]` All platform accounts (Meta, DigitalOcean, Supabase, AI provider,
  Brevo) registered in Shavs Telecommunications 24 PTY Ltd T/a Horizon Africa's
  name; OWD Solutions handles setup/admin and transfers admin access at handover.

## Section 2 — Inbound AI Lead Qualification ("Layla") `[I]`

- **2.1** `[Q]` AI-powered WhatsApp chatbot that answers product enquiries
  (Fibre, LTE, Wireless, Starlink).
  *Note:* `workflow-overview.html` states prompt scope is "Fibre packages only" —
  verify whether other product lines exist in the catalog.
- **2.2** `[Q][A]` Automatic lead qualification — collects name, contact number,
  address, product interest, and service requirements (household size, internet
  usage patterns; qualification flow: household → usage → package → details).
- **2.3** `[Q]` Lead scoring (Hot/Warm/Cold) based on readiness to buy.
- **2.4** `[Q][A]` Instant email alerts to the sales team when a hot lead is detected (Brevo).
- **2.5** `[Q][A][G]` Optional "speak to a human" handover via Chatwoot live chat
  (`chat.horizonafrica.co.za`), including a private handover note containing
  customer name, phone, product interest, recommended package, email/address,
  escalation reason, and conversation summary.
- **2.6** `[Q]` Automatic lead logging for CRM tracking (Google Sheets per quote;
  Supabase per implementation — see 1.3).
- **2.7** `[Q]` 24/7 automated response — no staff required for initial enquiries.
- **2.8** `[G]` Escalation triggers: fibre availability checks at a specific
  address, discount/better-pricing requests, callback requests, "speak to a
  human" requests, and complex queries the AI cannot resolve.
- **2.9** `[A]` Persona constraints: warm/concise (3–4 sentences), never breaks
  character, max 1 emoji, no pushy sales, South African English, JSON structured
  output, last-10-messages context window.
- **2.10** `[Q2]` Objection handling module — 5 objection types:
  - **2.10a** Price Too High — empathy + mobile-data comparison + budget options
  - **2.10b** Comparing Providers — compare speed, price, installation, contract
  - **2.10c** Need to Think About It — save recommended package for follow-up
  - **2.10d** Already Have Fibre — upgrades, better value, migration assistance
  - **2.10e** Relocating — collect new address, escalate to sales for coverage check
- **2.11** `[Q2]` Optional add-on: Automated Follow-Up Reminders (+R2,000) —
  scheduled WhatsApp reminders for undecided customers incl. Meta template.
  *Confirm whether purchased* — implemented as the Follow-Ups feature.

## Section 3 — Broadcast & Follow-Up Platform `[I]`

- **3.1** `[Q]` Simple web interface to send broadcast messages to Group A, B, or C.
- **3.2** `[Q]` Minimum 5 pre-approved marketing templates submitted to Meta
  (approval 24–72h). *Actual:* 16 approved templates observed.
- **3.3** `[Q]` Group segmentation by product, location, or customer type.
- **3.4** `[Q]` Full broadcast history and delivery tracking
  (sent / delivered / read / failed per campaign).
- **3.5** `[G]` Contacts manager — add/remove contacts in broadcast groups;
  bulk import supported.
- **3.6** `[G]` Test send to a single phone number before group send.
- **3.7** `[Q]` Opt-in consent and unsubscribe (STOP) handling required for Meta
  compliance — opted-out numbers excluded from all sends.
- **3.8** `[G][A]` Follow-up reminders: pending/overdue/sent tracking, manual
  "Send Now" per lead or bulk, daily 09:00 SAST automated sender
  (`horizon_followup` template, params: name + package).
- **3.9** `[G]` Template manager: create templates (name, language, category,
  header/footer, body variables, examples), submit to Meta, track
  Approved/Pending/Rejected with auto-refresh.

## Section 4 — Campaign Engine Features `[V]`

*(Verbatim from the Scope Freeze via `Phase1-Implementation-Plan.md` M9)*

- **4.1** `[V]` Campaign Creator — create, name, configure campaigns from dashboard
- **4.2** `[V]` Multi-Step Sequences — configurable sequence of steps with
  different templates per step
- **4.3** `[V]` Auto Progression — system sends next step at configured interval
- **4.4** `[V]` Response Detection — customer response stops sequence, routes to
  sales flow
- **4.5** `[V]` Not-Interested Capture — reason identified and stored on profile
- **4.6** `[V]` Intent Classification — every response classified; uncertain →
  human review
- **4.7** `[V]` Interaction Tracking — every message tracked: who, when, delivery,
  response, outcome
- **4.7a** `[V]` Failed Message Visibility — failures logged, identifiable,
  visible to admin
- **4.8** `[V]` Campaign Dashboard — active campaigns, contacts per step, progress
- **4.9** `[V]` Performance Report — per-campaign: sent, delivery rate, response
  rate, entered sales flow, converted
- **4.10** `[V]` Contact List Targeting — select contacts/groups via broadcast system
- **4.11** `[V]` Customer Profile Extension — profile shows campaign history, last
  contact, last response, rejection reason
- **4.12** `[V]` No-Response Flagging — non-responders flagged after final step

## Section 5 — Dashboard & Administration `[I][G]`

- **5.1** `[G]` Overview page: Total Leads, Hot Leads, Active Conversations,
  Broadcasts Sent, Pending/Overdue Follow-Ups, Recent Leads (5), Lead Score
  Breakdown (HOT/WARM/COLD with bars).
- **5.2** `[G]` Leads management: search by name/phone, filter by score and
  status, CSV export, pagination, detail drawer (view all fields, edit
  score/status/notes, schedule follow-up, escalation flag).
- **5.3** `[G]` Conversations: full WhatsApp history grouped by phone number,
  score badges, read-only view (human replies go through Chatwoot).
- **5.4** `[G]` Settings: integration status cards (OpenRouter, Brevo, Google
  Sheets, Chatwoot, Meta), staff alert email configuration, platform info.
- **5.5** `[G]` Notifications bell: Hot Lead / New Lead / Escalation / Follow-Up
  Due alerts, unread badge, deep-link to lead, 30s auto-refresh.
- **5.6** `[G]` Authentication: email+password login, remember me, forgot
  password, sign out, protected routes.
- **5.7** `[G]` Sidebar navigation: Overview, Leads, Conversations, Broadcasts,
  Follow-Ups, Templates, Settings + "New Broadcast" quick action.
  *Extensions delivered:* Campaigns, Calling Queue, Products, Reports, Health.
- **5.8** `[A]` Error monitoring: global n8n error trigger → HTML email report to
  mohamed@owdsolutions.co.za and keshlan@horizonafrica.co.za with workflow,
  execution link, failed node, message, stack.
- **5.9** `[I]` Health monitoring page (`/health`) for integration status.
  *Delivered beyond scope — included because it exists in production.*

## Section 6 — Integrations & Infrastructure `[I][A]`

- **6.1** `[A]` Meta Cloud API v21.0 — WABA + verified phone number
  (ID `1257101724147822`).
- **6.2** `[A]` OpenRouter `openai/gpt-5.6-sol` for AI responses
  (quote says "Gemini 3.1 Flash" — substitution noted).
- **6.3** `[A]` Supabase PostgreSQL — conversations, leads, products + campaign
  tables.
- **6.4** `[A]` Chatwoot — `chat.horizonafrica.co.za`, Account 1, Inbox 1
  (WhatsApp Cloud).
- **6.5** `[A]` Brevo — hot-lead, escalation, and error alert emails.
- **6.6** `[A]` Self-hosted n8n (`n8n.horizonafrica.co.za`) behind Caddy w/ TLS;
  dashboard on Vercel (`dashboard.horizonafrica.co.za`).
- **6.7** `[A]` Webhook verification handshake (Meta GET challenge) + signature
  security on inbound webhooks.
- **6.8** `[G]` Chatwoot handover includes agent workflow: Open/Resolved tabs,
  filters (All/Mine/Unassigned), private notes, resolve/reopen.

## Section 7 — Manual Controls & Operations `[V]`

*(Verbatim from the Scope Freeze via `Phase1-Implementation-Plan.md` M9)*

- **7.1** `[V]` Manual Controls — status override, classification correction
  (stored), campaign removal
- **7.1a** `[V]` Audit Trail — original value, amended value, user, date/time on
  manual changes
- **7.2** `[V]` Basic Backups — daily automated backups + documented restore path
- **7.3** `[V]` Customer Journey View — campaign → customer → what happened flat
  record

## Section 8 — Delivery, Handover & Acceptance `[I][Q]`

- **8.1** `[Q]` 1-hour handover and training session; workflow documentation and
  configuration overview; admin access transfer to all platform accounts.
- **8.2** `[Q]` Testing and go-live included in setup fees.
- **8.3** `[V]` M9 controlled pilot with limited test contacts; all acceptance
  items passed; `phase1-delivered` tag; sign-off by Mo/Keshlan.
- **8.4** `[I]` Fibre Re-Engagement campaign rules per
  `Fibre-Lead-Re-Engagement-Campaign.md` (max 2 messages, 6 response paths,
  calling queue, opt-out, nurture pool, final statuses, funnel) — treated as an
  operational spec layered on the scope-freeze platform.

## Open Questions for the Original Document

1. Actual contents of Sections 1–3, 5, 6 and any Section 8+ — reconstructed here.
2. Whether Google Sheets logging (1.3/2.6) was formally replaced by Supabase CRM.
3. Whether LTE/Wireless/Starlink catalogs were descoped to Fibre-only (2.1).
4. Whether the Follow-Up Reminders add-on (2.11) was purchased.
5. Whether "daily automated backups" (7.2) means Supabase-managed backups or the
   manual backup protocol in `BACKUP-RECOVERY.md`.
