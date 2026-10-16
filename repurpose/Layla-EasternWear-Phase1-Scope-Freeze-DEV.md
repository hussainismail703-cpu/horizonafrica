# Phase 1 Scope Freeze Document — Developer Copy

> **Internal/developer copy.** All commercial and payment terms have been removed. This document defines *what* is being built; see the signed client document for contractual/financial terms. Section numbering is unchanged so milestone references elsewhere (e.g. §4.x, §10.1) still match.

**Project:** Layla for Eastern Wear — WhatsApp Sales Engine & Automation, Phase 1
**Client:** Eastern Wear by Kersh (Keshlan Naidoo — Orders@easternwearbykersh.co.za)
**Provider:** OWD Solutions (Mohamed Osman)
**Proposal ref:** Phased proposal dated 12 October 2026, accepted by client; deposit paid
**Document status:** Accepted — development in progress

---

## 1. Purpose

This document defines the complete and final scope of **Phase 1** of the Layla platform repurposing for Eastern Wear. It converts the accepted Phase 1 feature list into concrete, testable deliverables and acceptance criteria.

Phase 1 scope is **frozen**. Development proceeds against this document only. Any feature, modification, or addition outside this scope is treated as a **change request** (see Section 11).

Phase 2 (website virtual try-on & credit system) is outlined in Section 5 but is **not contracted**, and is scoped in detail after Phase 1 is delivered.

---

## 2. Commercial Terms

*Removed from this developer copy — see the signed client document.*

What is relevant to development:

- WhatsApp template rewrites and Meta submissions are **part of Phase 1 scope** (see 4.8).
- **Payment gateway fees** (PayFast/Yoco) are settled directly between the client and the gateway provider — we never handle money.
- **OpenRouter AI usage** is billed through the client's OpenRouter account.
- **Supabase / Vercel / n8n** — existing infrastructure continues on current tiers.

---

## 3. Platform Foundation (Already Built — Reused)

The following capabilities are **live and deployed today** on the Layla platform (see the accompanying *Layla Platform — Capability Document*). Phase 1 re-customises them for Eastern Wear and adds the new builds in Section 4:

- WhatsApp Business API integration (send/receive) — **same verified number reused**
- AI assistant (Layla) with OpenRouter — persona and rules reconfigured for Eastern Wear
- Dashboard (Next.js, Supabase Auth) — rebranded for Eastern Wear
- Lead/customer management, scoring, statuses, CSV export, bulk upload
- Conversation history viewer
- Broadcast system with delivery/read tracking
- Template management (create, submit to Meta, track approval)
- Follow-up reminder system (scheduled, automated)
- Campaign engine: multi-step sequences, auto-progression, response detection, interaction tracking, audit trail, campaign dashboard and reports
- Intent classification engine with human-review fallback
- Escalation detection + human handover (Chatwoot)
- Hot lead & escalation email alerts (Brevo)
- Missed message recovery system
- Scheduled database backups with a documented, tested restore path
- Customer journey view and manual controls (status override, classification correction, campaign removal) with audit trail
- System health monitoring and error alerting
- Calling queue for staffed follow-up

*These features exist as proven machinery but are all telecoms-specific today — every prompt, category, rule, template and product record is reworked for Eastern Wear under the Phase 1 deliverables below.*

---

## 4. Phase 1 Deliverables

The following features are delivered, tested, and accepted under Phase 1. Each is tagged **[New build]** (does not exist on the platform today) or **[Existing — re-customised]** (engine exists; reworked for Eastern Wear).

### 4.1 WhatsApp Chat Button on Website — **[New build]**
- A WhatsApp chat entry point on easternwearbykersh.com carrying the **product/page context** into the conversation (Layla knows which garment the customer was viewing).

### 4.2 Message Classification, Routing & Staff Alerts — **[Existing — re-customised]**
- Every inbound message classified into Eastern Wear categories: **sales, orders, payments, delivery, general, complaints.**
- Category-based routing with **staff alerts** for anything needing human attention.
- Uncertain classifications default to human review (existing safeguard retained).

### 4.3 Stock-on-Hand Sales Workflow — **[New build]**
- Layla checks **live Shopify stock** for the requested item/size.
- Collects customer details, **creates the order**, and sends a **secure payment link** (PayFast/Yoco).
- Stock is **revalidated before payment**; on payment the webhook marks the order **paid** and sends order confirmation — with invoice/receipt delivered in WhatsApp.
- Orders and customers are tracked in the dashboard (items, total, payment status) with an instant staff alert on each new order.

### 4.4 Online / Imported Orders Track — **[New build]**
- A separate conversation track for items ordered online/imported: the **6-week lead time** and **50% deposit** terms are explained by Layla, then the enquiry is handed to **Orders@easternwearbykersh.co.za**.
- Stock-on-hand and imported orders are **classified separately** for reporting.

### 4.5 Automated Follow-Ups for Unpaid Orders — **[Existing — re-customised]**
- Customers who show interest but don't complete payment enter an automated follow-up sequence — **configurable timing and templates**, auto-stopping on payment, decline or opt-out.

### 4.6 Human Handover — **[Existing — re-customised]**
- Once a team member takes over a conversation (Chatwoot), **Layla pauses automated replies**.

### 4.7 Customer Database Sync for Broadcasts — **[New build]**
- Customer records **synced from Shopify** into the platform for segmented marketing broadcasts (opt-outs respected; broadcast engine itself already exists).

### 4.8 Business Rules, Knowledge Base & Templates — **[Existing — re-customised]**
- All business rules loaded into Layla's knowledge base: **shipping rates, collection details, no unauthorised discounts**, plus the client's two templates and FAQ/business documents.
- Eastern Wear persona rewrite (eastern-wear consultant: size/occasion/budget discovery, clothing objection handling, closing behaviour).
- ~15 WhatsApp template rewrites for the clothing business **resubmitted to Meta** (content direction supplied by client; Meta approval 24–48h per template).

### 4.9 Data Preservation & Number Cutover — **[Included]**
- A **full backup of all Horizon Africa data** (conversation history, leads/customers, campaign data, workflows) is taken **before** the verified number is repurposed, so the telecoms data can be restored if that line of business is reactivated in future.
- The Horizon Africa automation on the number is switched off at cutover; the same verified WABA number then serves Eastern Wear.

---

## 5. Phase 2 (Outlined — Not Contracted)

**Phase 2 — Website Virtual Try-On & Credit System (scoped in detail after Phase 1):**
- "Try it on" on the website: customers upload a photo and see themselves in the garment — **website only, not offered via WhatsApp**
- Credit system: 3 free credits per customer; one credit deducted per successful generation only
- Paid top-up bundles through the existing Shopify checkout, allocated automatically after payment verification
- Bonus credits per qualifying purchase (stacking) plus a once-off credit entitlement for existing subscribers (~400)
- Visible balance and transaction history, with controls against multiple-account abuse
- Image generation via the client's OpenRouter account, billed at cost

---

## 6. Multiple Sales Tracks

- Stock-on-hand and imported/online orders run as **separate tracks** with separate handling (4.3 vs 4.4) and separate reporting.
- Within Phase 1, targeting is managed via contact lists/groups; automatic rules-based segmentation is **not included**.

---

## 7. Data & Privacy

- Customer photos and data are handled per POPIA; no Phase 2 photo processing occurs in Phase 1.
- Payment card/banking data is never handled by Layla — all payments go through the payment gateway's secure page.
- All business and customer data remains the **client's property**.

---

## 8. Metric Definitions (Agreed)

| Metric | Definition |
|---|---|
| **Order created** | Layla assembles a confirmed item list + delivery and issues a payment link. |
| **Order paid** | Payment gateway webhook confirms settlement; order marked paid. |
| **Follow-up conversion** | An unpaid order marked paid after entering the follow-up sequence. |
| **Handover** | A conversation taken over by a team member in Chatwoot. |
| **Opt-out** | A customer who asks not to be contacted; excluded from all future sends. |

---

## 9. Out of Scope (Phase 1)

1. Website virtual try-on and the credit system (**Phase 2**).
2. WhatsApp-based try-on (explicitly excluded by the client — try-on is website-only).
3. Courier booking or fulfilment handling (delivery is charged per the client's fee structure; fulfilment is the client's process).
4. Stock management / inventory beyond reading live Shopify stock.
5. Automatic rules-based segmentation / dynamic campaign assignment.
6. SMS / email channels (WhatsApp + email notifications to staff only).
7. Mobile application (dashboard is web-based, responsive).
8. Integration with third-party CRMs beyond Shopify.
9. Custom AI model training or fine-tuning.
10. Changes to the Shopify store itself (theme, checkout configuration).
11. Migration of historical Shopify orders into the dashboard (sync covers customers and new orders going forward).

---

## 10. Milestones & Acceptance

### 10.1 Milestones (indicative, for progress tracking)

| Milestone | Content |
|---|---|
| M1 | Persona, classification categories, knowledge base & business rules reworked for Eastern Wear; template rewrites submitted to Meta |
| M2 | Shopify connection: live product/stock feed + customer sync |
| M3 | Stock-on-hand order flow: order creation → payment link → paid webhook → invoice in WhatsApp → dashboard order tracking + staff alert |
| M4 | Imported-orders track + Orders@ handover |
| M5 | Website WhatsApp chat button with product context |
| M6 | Unpaid-order follow-up sequences + broadcast readiness |
| M7 | Dashboard rebrand + journey/reporting checks |
| M8 | Horizon data backup + number cutover |
| M9 | Testing, QA & controlled pilot |

**Estimated duration: approximately 8 weeks to go-live** from receipt of Shopify collaborator access and payment-gateway details. Meta template approvals (24–48h each) run in parallel and are not counted against development time.

### 10.2 Acceptance
- Phase 1 is **delivered** when every feature in Section 4 passes its acceptance criterion.
- Each Section 4 item constitutes a checklist item; the full list is the **Phase 1 acceptance checklist**.
- Acceptance includes a **controlled pilot** (Section 10.3) before final sign-off.
- Final payment is due on completion of the pilot and written acceptance.

### 10.3 Controlled Pilot
- Before final acceptance, a controlled pilot is run against a limited set of test customers/orders (including at least one live paid order end-to-end).
- Pilot scope is agreed in writing before it begins.
- Acceptance (including the pilot) and the final payment are the same gate.

---

## 11. Change Requests

Any feature, modification, or addition **outside this frozen scope** is a change request:

1. The client requests a change (verbally or in writing).
2. OWD Solutions responds in writing **within 3 business days**, stating whether it is in scope or a change request, the estimated additional cost, and timeline impact.
3. If accepted, the change is added to scope in writing and development proceeds.
4. If not accepted, the change is deferred or dropped.
5. **No change request work begins until approved in writing.**

### Included without a change request
- Bug fixes for features delivered in Phase 1 (within the 1-month warranty).
- Minor adjustments (label changes, default values, reordering).
- Configuration changes (follow-up timing, templates on an existing flow).
- Reasonable refinement of AI prompts and classification to improve accuracy.
- WhatsApp template submission to Meta (technical submission; content direction is the client's responsibility).

---

## 12. Client Responsibilities & Inputs

- **Shopify collaborator access** + Admin API scopes (products, orders, customers, inventory) for the store connection.
- **PayFast or Yoco merchant account** — funds settle directly to the client; OWD never handles money.
- **Delivery/collection fee structure** and rules to load into the order flow.
- **Template content direction** — the two existing templates plus guidance for the clothing rewrites.
- **Business documents** — FAQ and business overview documents (already received).
- **Existing subscriber list** (~400 customers) for broadcast sync and Phase 2 credit entitlement.
- **Metric validation** — confirmation of Section 8 definitions.

---

## 13. Ownership, Access & Warranty

### 13.1 Ownership
- **Customer and business data: owned by the client, fully and unconditionally.**
- **Custom source code** developed specifically for and paid for under this project is **assigned to the client in full** on receipt of final payment — perpetual, irrevocable, royalty-free, including the unrestricted right to use, modify, reproduce and further develop it.
- The client has the **unrestricted right to appoint another developer** in future to maintain, modify and further develop the system.
- The assignment covers custom code developed for this project. It does not extend to OWD Solutions' pre-existing proprietary code, libraries, templates, or third-party/open-source services (Supabase, n8n, OpenRouter, WhatsApp Business API, Shopify), for which the client receives a perpetual right to use as integrated in the delivered solution.
- Full **administrative access** to all relevant systems is provided at delivery, including credentials.

### 13.2 Warranty (1 month)
- The warranty covers **bug fixes related to the agreed Phase 1 scope** for one month from delivery/acceptance.
- **Covered:** defects where delivered Phase 1 functionality does not behave as specified — workflow failures, incorrect order/status transitions, implementation-caused classification errors, WhatsApp/Shopify integration failures caused by our implementation, reporting discrepancies, and regressions of delivered functionality.
- **Not covered:** third-party service failures outside OWD control (Meta/WhatsApp, OpenRouter, Shopify, PayFast/Yoco, n8n platform), changes made by the client, and anything outside this scope.

### 13.3 Defect vs change-request
- A **defect** is a Phase 1 feature behaving contrary to this document → corrected at no cost within warranty.
- A **change request** is new or different functionality beyond this document → quoted separately.
- The test is this document: if the built system doesn't match Section 4 as written, it's a defect; if the client wants behaviour beyond Section 4, it's a change request.

---

## 14. Signature

*Signed copy on file — acceptance of the client document froze the Phase 1 scope and authorised commencement of development.*
