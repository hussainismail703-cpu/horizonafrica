# Installing the Layla WhatsApp Button on easternwearbykersh.com

**Audience:** whoever has theme-editing access on the Shopify store
(client developer, or the client themselves with collaborator access).
**Time:** ~10 minutes. **Risk:** very low — one snippet file + one
`{% render %}` line. Nothing else in the theme is modified.

---

## What this does

Adds a floating WhatsApp button to the store. On a **product page** it
opens a WhatsApp chat pre-filled with the garment's name and URL, e.g.:

> Hi Layla! I'm looking at the Emerald Abaya
> (https://easternwearbykersh.com/products/emerald-abaya) — is it
> available?

Layla reads that message, looks the product up in the synced catalog,
and replies already knowing which garment the customer is asking about
— including live stock.

On all other pages it sends a generic greeting.

---

## Step 1 — Add the snippet file

1. Shopify admin → **Online Store → Themes**.
2. On the live theme, click **⋯ → Edit code**.
3. In the left panel under **Snippets**, click **Add a new snippet**.
4. Name it exactly: `layla-whatsapp-button` (Shopify appends `.liquid`).
5. Paste the full contents of
   `public/snippets/layla-whatsapp-button.liquid` (in this repo) into
   the file and **Save**.

## Step 2 — Render it in the theme

The button can go in one of two places depending on how widely you
want it to appear:

### Option A — Every page (recommended)

1. Open `layout/theme.liquid`.
2. Just before the closing `</body>` tag, add:

   ```liquid
   {% render 'layla-whatsapp-button' %}
   ```

3. **Save.**

### Option B — Product pages only

1. Open the product template — usually `sections/main-product.liquid`
   (older themes: `templates/product.liquid`).
2. Near the end of the file, add:

   ```liquid
   {% render 'layla-whatsapp-button', product_only: true %}
   ```

   (`product_only: true` makes the snippet render nothing on
   non-product templates, so it's also safe to place this call in
   `theme.liquid` if preferred.)

3. **Save.**

## Step 3 — Optional parameters

```liquid
{% render 'layla-whatsapp-button',
   whatsapp_number: '27757774389',
   button_color: '#25D366',
   position: 'bottom-left'
%}
```

| Parameter | Default | Notes |
|---|---|---|
| `whatsapp_number` | `27757774389` | International digits only — no `+`, spaces or leading `0`. Only change if the business number changes. |
| `button_color` | `#25D366` | Any hex colour, e.g. the brand colour once confirmed. |
| `position` | `bottom-right` | Or `bottom-left`. |
| `product_only` | `false` | `true` = button only appears on product pages. |

## Step 4 — Verify

1. Open any product page on the storefront.
2. Click the button → WhatsApp should open (app or web) with the
   pre-filled message containing the product name and URL.
3. Send it → Layla should reply referencing that garment and its
   availability.

**Important:** do not edit the pre-filled message format — the product
URL inside it is what lets Layla identify the garment.

## Rollback

Remove the `{% render 'layla-whatsapp-button' %}` line and save. The
snippet file can stay in the theme harmlessly, or be deleted from
**Snippets**.
