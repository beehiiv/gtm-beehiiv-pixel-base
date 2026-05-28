# Troubleshooting: "The pixel isn't sending events"

This is the runbook for the most common advertiser report: *"I installed the pixel,
the tag fires in GTM, but beehiiv isn't receiving events."*

The script loading and the event **POST** are two separate things. A green checkmark
in GTM Preview only means the tag *ran* — it says nothing about whether the payload
reached Apiary. Almost every "not sending" report is a failure *after* the tag fires.

## Step 0 — Split the problem in one look (do this first)

Open DevTools on the page where events should fire and check **two tabs**:

1. **Console** — look for a `Content-Security-Policy` violation mentioning our
   ingestion host (see the Lindy case below). A CSP block is silent in GTM but loud
   in the console.
2. **Network** — filter for `ingestion` or `apiarydata`.
   - **Request appears, but is `(blocked)` / `failed` / red** → CSP or network policy
     on the advertiser's site. Go to §1.
   - **Request appears with status `200`/`204`** → we *are* receiving it. The problem
     is downstream (payload rejected at Apiary, or a reporting/attribution question).
     Go to §4.
   - **No request at all** → the pixel code never reached `sendToApiary`. Go to §2/§3.

This single check (console vs. network) tells you which half of the system to dig into.

## The endpoint (know this cold)

The deployed pixel POSTs events to:

```
https://ingestion.prod.apiarydata.net/api/v2/ingestion/pixel
```

The real endpoint is baked into the S3 build at compile time from
`VITE_PIXEL_V2_APIARY_ENDPOINT` (Doppler) — **not** from any constant in `template.tpl`.
Verify what the live build actually targets:

```bash
curl -s "https://s3.amazonaws.com/beehiiv-adnetwork-production/pixel-v2.js" \
  | grep -oE "https://[a-zA-Z0-9.]*apiarydata[a-zA-Z0-9./]*" | sort -u
```

> ⚠️ Historical gotcha: `ingestion.apiary.beehiiv.net` is a stale host that appeared in
> old docs and a dead `template.tpl` constant. The pixel does **not** send there.
> If an advertiser whitelisted that host, they whitelisted the wrong one.

## §1 — CSP blocks the POST (the Lindy case, 2026-05)

**Symptom:** Pixel works on the marketing site (`www.example.com`) but not on an app
subdomain (`chat.example.com`). The script loads (200), GTM shows the tag firing, but
no events arrive. App subdomains commonly ship a strict CSP that the marketing site
doesn't.

**Console shows:**
```
Connecting to 'https://ingestion.prod.apiarydata.net/api/v2/ingestion/pixel'
violates the following Content Security Policy directive: "connect-src 'self' ..."
The action has been blocked.
```

**Fix (advertiser side):** add our ingestion host to their CSP `connect-src`:
```
connect-src ... https://ingestion.prod.apiarydata.net;
```
`script-src` is usually already fine — the pixel script loads via S3/GTM; it's the
event POST (`connect-src`) that gets blocked. Confirm *which* host their CSP allows —
allowing the stale `beehiiv.net` host does nothing.

## §2 — Pixel never initialized

`track()` awaits `init()` before sending (see `isInitialized()` in `src/pixel-v2.ts`).
If `init` never ran or threw, every `track()` call rejects silently and logs
`Tracking failed` to the console.

Common cause: the **`pixel_id` is missing on the firing tag**. Each GTM tag carries its
own `pixel_id` — it is not global. If the conversion tag's Pixel ID field is empty (or a
variable that resolves empty at fire time), `init(undefined)` throws and nothing sends,
even though the pageview tag (which had a valid ID) worked.

**Check:** console for `Pixel not initialized` / `Tracking failed`. Confirm every tag
has a valid UUID in its Pixel ID field.

## §3 — Event dropped client-side before the POST

Things that make `track()` return without ever calling the network:

- **Unsupported event name.** Must be one of `SUPPORTED_EVENTS` (`src/lib/events.ts`):
  `pageview, conversion, lead, complete_registration, purchase, initiate_checkout,
  start_trial, subscribe`. Anything else logs
  `[bhpx] unsupported event "..."` and is dropped.
- **Dedupe.** Identical payloads are suppressed for **15 minutes**
  (`src/lib/dedupe.ts`, localStorage key `bhpx_processed_events`). The hash covers
  everything *except* timestamps and `event_id` — so repeated conversions on the same
  URL with the same data (e.g. reloading a thank-you page during testing) only send the
  first time. **To re-test:** use incognito, clear localStorage, or vary the data
  (e.g. a unique `order_id`). This is by design, not a bug.
- **Crawler/bot.** `isCrawler()` (`src/lib/utils.ts`) short-circuits `track()` for
  bot user-agents. Rare, but headless test tooling can trip it.

## §4 — POST is sent and accepted (200) but data looks wrong

If the request reaches Apiary with a 2xx, the pixel did its job. From here it's a
payload/attribution question:

- **Missing attribution** (`subscriber_id` / `ad_network_placement_id` empty): the
  `_bhc` click cookie wasn't set or didn't carry. Cookies are scoped to the registrable
  domain (`domain=.example.com`, see `src/lib/cookies.ts`), so they *do* share across
  subdomains — but only if the pixel ran on the page that captured the `bhcl_id` first.
- **Payload rejected at Apiary (4xx in Network tab):** the event shape failed Apiary's
  strict validation and lands in the DLQ. Field coercion lives in
  `src/lib/payload.ts` ("lenient in, strict out"). See the BEE-20086 history for the
  `status` / `content_ids` / `order_id` field-shape saga.

## Redirect timing (conversions specifically)

If a conversion is expected to fire at the moment the user clicks a link that navigates
to another page/subdomain, the async `init → track → sendBeacon` chain may not flush
before the page unloads. **Fire the pixel before the redirect**, not on the destination
page expecting it to pick up the event.

## Quick reference

| Symptom | Likely cause | Section |
|---|---|---|
| Works on `www`, not on app subdomain | CSP `connect-src` block | §1 |
| Tag fires, no network request at all | init failed / event dropped | §2, §3 |
| "Tracking failed" in console | `pixel_id` missing → init threw | §2 |
| First event sends, repeats don't | 15-min dedupe | §3 |
| 200 sent but no attribution | `_bhc` cookie not captured | §4 |
| Network request blocked/red | CSP or ad-blocker | §1 |
