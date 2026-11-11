# Eastern Wear — WhatsApp message templates (DRAFT for Asif approval)

These are the outbound Meta templates the system needs for Eastern Wear.
Meta templates are only used when the system messages a customer *first* or
outside the 24-hour reply window — Layla's normal chat replies don't need them.

Replace the telecoms templates currently in Meta (`telkom_fibre_packages`,
`telkom_reengagement`, `horizon_followup_v6`, …). Drafted in the client's voice
(Templates 1 & 2 from the business document). **Asif approved the copy; all 10 submitted and APPROVED by Meta (2 Nov).**

Meta rules applied: lowercase names, `{{n}}` variables, body under 1024
characters, UTILITY category for order/payment notices, MARKETING for
promotional outreach.

---

## Order & payment (UTILITY)

### `ew_order_confirmation`
Sent when a stock-on-hand order is placed and the Shopify invoice/payment
link is ready. Params: `{{1}}` name, `{{2}}` item, `{{3}}` invoice link.

> Dear {{1}}, thank you for your order with Eastern Wear by Kersh.
> Please find your invoice for {{2}} here: {{3}}
> Please note: we typically hold only one of each item, and stock cannot be
> reserved before payment. Full payment confirms your order.
> Collection on the Bluff (Mon–Fri, 09:00–17:00) is free by appointment, or
> choose delivery at checkout.

### `ew_payment_reminder_1` — nudge at +4h (ORDER_FOLLOWUP_TEMPLATES step 1)
Params: `{{1}}` name, `{{2}}` item.

> Hi {{1}}, a gentle reminder that your invoice for {{2}} is still open. The
> item stays available while you decide, but it can't be held — the first
> completed payment secures it. Reply here if you'd like any help.

### `ew_payment_reminder_2` — nudge at +24h (step 2)
Params: `{{1}}` name, `{{2}}` item.

> Hi {{1}}, just checking in on {{2}}. If you're still interested, please
> confirm availability with us before paying, as stock can sell out. Reply to
> this message and we'll confirm straight away.

### `ew_payment_reminder_3` — final nudge at +72h (step 3)
Params: `{{1}}` name, `{{2}}` item.

> Hi {{1}}, this is our last note about {{2}}. If your plans have changed,
> no problem at all — reply and let us know. If you'd still like it, we're
> happy to check availability and help you complete payment.

### `ew_collection_reminder`
Day before a confirmed collection appointment. Params: `{{1}}` name,
`{{2}}` date/time window.

> Dear {{1}}, a reminder of your collection appointment tomorrow ({{2}}).
> Please bring your order confirmation, printed or on your phone. Reply here
> if you need to reschedule.

### `ew_imported_order_update`
Imported-order status notice (arrived / balance due). Params: `{{1}}` name,
`{{2}}` item, `{{3}}` status.

> Dear {{1}}, an update on your order for {{2}}: {{3}}.
> Thank you for your patience and for supporting our small business. Reply
> here with any questions.

---

## Outreach & follow-up (MARKETING)

### `ew_campaign_intro` — campaign step 1 (replaces `telkom_fibre_packages`)
Params: `{{1}}` name, `{{2}}` collection/category name.

> Dear {{1}}, we hope you are well. New pieces have just arrived in our
> {{2}} at Eastern Wear by Kersh — each one from current stock, and most are
> one of a kind. Reply to browse or ask us anything.

### `ew_reengagement` — campaign step 2 (replaces `telkom_reengagement`)
Params: `{{1}}` name.

> Hi {{1}}, just a gentle nudge in case our last note got buried. The new
> pieces are still available while stock lasts — reply here and we'll happily
> show you.

### `ew_followup_nudge` — lead follow-up (replaces `horizon_followup_v6`)
Params: `{{1}}` name, `{{2}}` item — **same 2-param shape as
`horizon_followup_v6` so the follow-up sender needs no code change.**

> Hi {{1}}, we're still keeping an eye on {{2}} for you. Would you like us to
> check availability, or shall we take it off your list? Either is perfectly
> fine — just reply.

### `ew_imported_terms` — enquiry outside the 24h window
Template 1, condensed to fit. Params: `{{1}}` name.

> Dear {{1}}, thank you for your enquiry. Orders to India are placed every
> Friday and typically take about six weeks to arrive. A minimum 50% deposit
> confirms your order, with the balance payable once we receive your item.
> Reply with your name, contact number and delivery address (or collection on
> the Bluff) and we'll arrange an invoice.

---

## Deliberately left out

- **No discount/promo template** — Eastern Wear does not run WhatsApp-only
  discounts (§5.1); promotional sends use `ew_campaign_intro`.
- **No phone-number/address in any template** — per Asif's decision, contact
  stays inside the chat; the Bluff street address is shared only after an
  appointment is confirmed.
- `hello_world` stays for webhook testing only.

## Open questions for Asif

1. Happy with this set (10 templates) or want anything added — e.g. a
   "payment received / order shipped" utility template?
2. Campaign intro: should {{2}} be a collection name ("festive sarees",
   "kiddies range") or something else?
3. Any wording changes before we submit to Meta?
