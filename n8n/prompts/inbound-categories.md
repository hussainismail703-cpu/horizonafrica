# Eastern Wear — Inbound Message Categories & Routing

Classification spec for the n8n "Inbound AI Lead Qualification" workflow.
Every inbound WhatsApp message is tagged with exactly one `message_category`,
written to `conversations.message_category` (column added in the M1
migration). This drives routing, staff alerts and reporting.

## Categories

| Category | Meaning | Examples |
|----------|---------|----------|
| `sales` | Buying intent or product/price/stock questions | "Do you have this in size 34?", "How much is the black abaya?", "I want to order" |
| `orders` | Existing-order status, changes or confirmations | "Where is my order?", "Can I change the size I ordered?", "I paid yesterday, did you get it?" |
| `payments` | Payment links, failed payments, proof of payment, refunds | "The payment link isn't working", "I sent a POP", "When will I be refunded?" |
| `delivery` | Shipping, tracking, collection or courier issues | "Has my parcel shipped?", "Courier never arrived", "Can I collect instead?" |
| `general` | Greetings, opening messages, small talk, store info | "Hi", "Salaam", "What are your hours?" |
| `complaints` | Unhappiness with product, service or process | "This is unacceptable", "Your service is terrible" |
| `uncertain` | Cannot be confidently assigned to any category | Gibberish, ambiguous fragments, media with no context |

## Classification rules

- Choose the **single best** category — do not hedge by splitting.
- **Specific beats generic**: a message about a problem with a paid order is
  `orders` or `delivery`, not `general`. A refund complaint is `payments`
  (or `complaints` if the dominant signal is unhappiness).
- **Buying questions are `sales`**, even when phrased as objections
  ("that's too expensive" → `sales`, then handle the objection).
- **Order-track is orthogonal**: whether an enquiry is `stock_on_hand` or
  `imported` is recorded on `order_track`, not on `message_category`.
- **Empty/no-content messages** → `uncertain`.
- **When in doubt → `uncertain`** and route to human review. This is the
  retained safeguard: never force a confident-sounding guess.

## Staff alerts

| Category | Alert staff? | Rationale |
|----------|:---:|-----------|
| `sales` | No | Layla handles the full sales flow |
| `orders` | Conditional | Alert when the order issue can't be resolved in chat (missing order, change after dispatch) |
| `payments` | **Yes** | Money issues always need a human eye |
| `delivery` | **Yes** | Courier/tracking failures need intervention |
| `general` | No | Layla answers directly |
| `complaints` | **Yes** | Reputation risk — human responds personally |
| `uncertain` | **Yes** | Human review safeguard |

Staff alerts go through the existing escalation path
(`leads.needs_escalation` → notification email + handover). `payments`,
`delivery`, `complaints` and `uncertain` always alert; `orders` alerts when
unresolved in chat.

## Write points

- Set `message_category` on the `conversations` row when it is inserted.
- Set `order_track` (`stock_on_hand` | `imported`) on the conversation and the
  lead once the sales track is known; leave `null` until determined.
