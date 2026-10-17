# Website Button → Product Context (EW M5, scope freeze §4.1)

Spec for how Layla handles an inbound first message that originated
from the website WhatsApp button.

## The inbound contract

The Liquid snippet pre-fills the customer's first message as:

- Product page:
  `Hi Layla! I'm looking at the <product title> (<shop url>/products/<handle>) — is it available?`
- Other page:
  `Hi Layla! I have a question about something on <shop name>.`

The machine-readable part is the product URL: it always contains
`/products/<handle>`, where `<handle>` matches
`shopify_products.handle` (kept in sync by `/api/shopify/sync-products`
and the products webhooks).

## Workflow behaviour

1. **Detect** — after `Extract Message`, look for
   `/products/([a-z0-9][a-z0-9-]*)` in `messageText` (case-insensitive).
   A first message matching this pattern is a website-button origin.
   If no pattern matches, continue as normal (no context).

2. **Look up** — query `shopify_products` filtered by `handle` and
   `is_active = true`, embedding `shopify_variants` for variant titles,
   prices and `inventory_qty`. Node implemented: `Lookup Product Context`
   (HTTP GET on Supabase REST), wired between `Fetch Products` and
   `Fetch Lead` so its output is available when the prompt is built.

3. **Inject** — `Build OpenRouter Request` adds a
   `WEBSITE REFERRAL CONTEXT` block to the system prompt when a match
   is found:

   - Product title, handle, and URL.
   - Available variants with size/colour, price, and stock quantity.
   - Instruction to greet the customer by acknowledging that specific
     garment, confirm live availability, and continue the normal
     discovery flow (size, occasion, budget).
   - If the product is inactive or out of stock on all variants, Layla
     says so honestly and offers alternatives from the catalog.
   - If the handle does not match any synced product, the block is
     omitted and Layla treats it as a normal enquiry.

4. **No special casing elsewhere** — classification, scoring,
   escalation and handover all behave identically. The referral is
   context only; it never bypasses verification or stock revalidation.

## Example

Customer taps the button on `/products/emerald-abaya` and sends the
prefill → Layla's first reply is along the lines of:

> Hi! Great choice — the Emerald Abaya is one of our favourites. We
> currently have it in stock in sizes 32–40 at R1,450. What occasion
> are you shopping for?

## Failure modes

| Case | Behaviour |
|---|---|
| Handle not in `shopify_products` | No context block; normal enquiry |
| Product exists, all variants `inventory_qty = 0` | Honest out-of-stock + alternatives |
| Lookup request fails | Context omitted; normal enquiry (no reply delay) |
| Repeat inbound from same phone mid-conversation | Context is only injected when present in that message; the conversation continues normally |

## Files

- Snippet: `public/snippets/layla-whatsapp-button.liquid`
- Install guide: `docs/shopify-button-install.md`
- Workflow: `kW4ELXolGnYx2AvB` — nodes `Lookup Product Context`,
  `Extract Message` (handle extraction), `Build OpenRouter Request`
  (context injection).
