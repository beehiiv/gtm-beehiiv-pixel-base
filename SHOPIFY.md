# beehiiv Pixel V2 — Shopify Integration

## Overview

Shopify integration uses **two coordinated halves** that share storefront cookies for attribution:

1. **`pixel-v2.js` in `theme.liquid`** — runs in the real storefront context. Captures `?bhcl_id=...` on landing, writes the `_bhc` / `_bhp` cookies to the storefront cookie jar, and tracks non-checkout events (pageviews, signups, custom events).
2. **`pixel-shopify.js` as a Shopify Custom Pixel** — runs in Shopify's checkout sandbox. Reads `_bhc` / `_bhp` via Shopify's `browser.cookie` API and fires the `purchase` event with full attribution on `checkout_completed`.

> **Why two halves?** Shopify's Custom Pixel sandbox is an isolated iframe — it can't read or write the storefront's cookie jar synchronously, and `window.location` reflects the sandbox URL rather than the storefront URL. So click capture (`bhcl_id` → `_bhc` cookie) has to happen on the storefront itself, in `theme.liquid`. The Custom Pixel then reads what `theme.liquid` wrote, and fires the conversion event with the attribution intact.

## Part 1 — Install `pixel-v2.js` in `theme.liquid`

This half captures the click and handles non-checkout events on the storefront.

1. From the Shopify Admin, go to **Online Store → Themes → Edit code**
2. Open `layout/theme.liquid`
3. Paste the following snippet just before the closing `</head>` tag. Replace `PIXEL_ID` with the value from your beehiiv Advertiser Portal:

```html
<!-- beehiiv Pixel V2 — storefront -->
<script>
(function(){try{
  !function (f, b, e, h, i, v) {
    if (f.bhpx) return;
    i = f.bhpx = function () {
      i.callMethod ?
        i.callMethod.apply(i, arguments) : i.queue.push(arguments);
    };
    if (!f._bhpx) f._bhpx = i;
    i.push = i; i.loaded = !0; i.version = '1.0';
    i.queue = [];
    v = b.createElement(e); v.async = !0;
    v.type = 'module';
    v.src = 'https://beehiiv-adnetwork-production.s3.amazonaws.com/pixel-v2.js';
    h = b.getElementsByTagName(e)[0];
    h.parentNode.insertBefore(v, h);
  }(window, document, 'script');

  bhpx('init', 'PIXEL_ID', { trackClientNavigation: true });
}catch{/*swallow*/}})();
</script>
```

4. Save the theme.

**What this does:**
- On any storefront page load, parses `?bhcl_id=...` from the URL if present, validates it, and writes `_bhc` to the storefront cookie jar.
- Generates a `_bhp` profile cookie on first visit so anonymous activity can be stitched together later.
- Fires a `pageview` event on every navigation.

You can also fire custom events from the storefront (e.g., signup completion, add-to-cart) by calling `bhpx('track', 'lead', { ... })`. See the main [README](./README.md) for the supported event list.

## Part 2 — Install `pixel-shopify.js` as a Custom Pixel

This half handles checkout `purchase` attribution.

1. From the Shopify Admin, go to **Settings → Customer events**
2. Click **Add custom pixel** and name it `beehiiv Pixel V2 conversion`
3. Copy the entire contents of [`dist/pixel-shopify.js`](./dist/pixel-shopify.js) into the **Code** field
4. Find the line `const PIXEL_ID = 'PIXEL_ID';` near the top and replace `PIXEL_ID` with your beehiiv pixel ID
5. Set **Permission** to `Not required` (the pixel only reads cookies it sets itself; no PII is collected without the standard checkout email field)
6. Set **Data sale** to whatever your store policy requires
7. Click **Save**, then **Connect**

**What this does:**
- Subscribes to Shopify's `page_viewed` event to ensure `_bhp` exists and to capture any `bhcl_id` query param that arrives in checkout (e.g., direct-to-checkout deep links)
- Subscribes to `checkout_completed` and fires a `purchase` event with `order_id`, hashed `email`, `currency`, and `value_cents`
- Reads the `_bhc` / `_bhp` cookies written by Part 1 via Shopify's `browser.cookie` API, so attribution flows through to the conversion event

## Testing

1. In the Custom Pixel UI, click **Preview** and complete a test checkout
2. Open your browser's Network tab and filter for `ingestion.prod.apiarydata.net`
3. Verify a POST is sent with the expected payload — in particular that `ad_network_placement_id`, `subscriber_id`, and `email_address_id` are populated when you arrived from a beehiiv ad link

If those attribution fields are empty:
- Confirm Part 1 is installed in `theme.liquid` and the storefront has been visited recently from a beehiiv ad URL (containing `?bhcl_id=...`)
- Check that the `_bhc` cookie exists on the storefront domain in your browser's DevTools
- Confirm the Custom Pixel's `Permission` setting isn't blocking cookie reads

## Why the Old "Custom-Pixel-Only" Approach Doesn't Work

Earlier versions of this guide instructed advertisers to load `pixel-v2.js` *inside* the Custom Pixel sandbox. That pattern fires the `purchase` event but **silently fails on attribution** — `pixel-v2.js`'s synchronous cookie reads target the sandbox iframe's cookie jar, not the storefront's, so `_bhc` and `_bhp` are always empty. The event reaches our endpoint but can't be linked to the originating ad click.

The two-halves architecture above is the only reliable path because click capture must happen in the storefront context (where `document.cookie` and `window.location` reflect the real page) and conversion firing must happen in the sandbox (which is the only context with access to Shopify's checkout event stream).

## Field Reference

Both halves send the same `PixelPayload` shape to `https://ingestion.prod.apiarydata.net/api/v2/ingestion/pixel`. The fields most relevant to Shopify advertisers:

| Field | Source | Notes |
|---|---|---|
| `pixel_id` | Hardcoded in snippet | Your beehiiv pixel ID |
| `event` | `'pageview'` / `'purchase'` / etc. | Lowercase |
| `event_id` | Generated UUID | Used for deduplication |
| `url` | Storefront URL | From `window.location` or `event.context.document.location.href` |
| `ad_network_placement_id` | `_bhc` cookie | Empty if user didn't arrive from a beehiiv ad |
| `subscriber_id` | `_bhc` cookie | Same |
| `email_address_id` | `_bhc` cookie | Same |
| `profile_id` | `_bhp` cookie | Anonymous user identifier |
| `order_id` | `event.data.checkout.order.id` | Purchase only |
| `value_cents` | `event.data.checkout.totalPrice.amount * 100` | Purchase only |
| `currency` | `event.data.checkout.currencyCode` | Purchase only |
| `email_hash_sha256` | SHA-256 of checkout email | Purchase only |
| `email_hash_sha1` | SHA-1 of checkout email | Purchase only |
