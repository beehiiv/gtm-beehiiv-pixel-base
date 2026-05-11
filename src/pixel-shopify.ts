import { version as SCRIPT_VERSION } from '../package.json';
import type { CookieJar, CookieName } from './lib/cookies';
import { parseClickId } from './lib/cookies';
import { buildPayload } from './lib/payload';
import { sendToApiary } from './lib/transport';
import type { TrackData } from './lib/types';
import { generateUUID } from './lib/utils';

// Shopify Custom Pixel sandbox globals. These don't exist anywhere else, so
// declaring them ambient keeps the rest of the file plain TypeScript.
declare const analytics: {
  subscribe(eventName: string, callback: (event: ShopifyEvent) => void): void;
};
declare const browser: {
  cookie: {
    get(name: string): Promise<string | null>;
    set(name: string, value: string): Promise<void>;
  };
};

interface ShopifyEvent {
  id?: string;
  name?: string;
  timestamp?: string;
  context?: {
    document?: { location?: { href?: string } };
    navigator?: { userAgent?: string };
  };
  data?: {
    checkout?: {
      email?: string;
      order?: { id?: string };
      currencyCode?: string;
      totalPrice?: { amount?: number };
    };
  };
}

// IMPORTANT: Replace PIXEL_ID with the value from your beehiiv Advertiser Portal
// before pasting this snippet into Shopify's Customer Events / Custom Pixel UI.
const PIXEL_ID = 'PIXEL_ID';

// Adapter for Shopify's async browser.cookie API. Naming is plain (_bhc / _bhp)
// because Shopify storefronts aren't on beehiiv-owned domains, so the
// host-suffix collision avoidance that DocumentCookieJar handles doesn't apply.
class ShopifyCookieJar implements CookieJar {
  async get(name: CookieName): Promise<string> {
    return (await browser.cookie.get(name)) || '';
  }
  async set(name: CookieName, value: string): Promise<void> {
    await browser.cookie.set(name, value);
  }
}

const cookies = new ShopifyCookieJar();

async function ensureProfileId(): Promise<void> {
  if (!(await cookies.get('_bhp'))) {
    await cookies.set('_bhp', generateUUID());
  }
}

async function captureClickIdFromUrl(url: string | undefined): Promise<void> {
  if (!url) return;
  const clickId = parseClickId(url);
  if (!clickId) return;
  const existing = await cookies.get('_bhc');
  if (existing !== clickId) {
    await cookies.set('_bhc', clickId);
  }
}

async function track(eventName: string, event: ShopifyEvent, data: TrackData): Promise<void> {
  try {
    const url = event.context?.document?.location?.href || '';
    const userAgent = event.context?.navigator?.userAgent || '';

    const payload = await buildPayload({
      pixelId: PIXEL_ID,
      eventName: eventName.toLowerCase(),
      url,
      userAgent,
      scriptVersion: SCRIPT_VERSION,
      cookies,
      data,
    });

    await sendToApiary([payload]);
  } catch (error) {
    console.error('[bhpx-shopify] track failed:', error);
  }
}

// page_viewed: every page navigation on the storefront. We use it to capture
// ?bhcl_id=... on landing (writes _bhc) and to fire a pageview event.
analytics.subscribe('page_viewed', async (event: ShopifyEvent) => {
  await ensureProfileId();
  await captureClickIdFromUrl(event.context?.document?.location?.href);
  await track('pageview', event, {});
});

// checkout_completed: the conversion event. _bhc was set by page_viewed when
// the user landed from a beehiiv ad, so attribution flows through unchanged.
analytics.subscribe('checkout_completed', async (event: ShopifyEvent) => {
  const checkout = event.data?.checkout;
  await track('purchase', event, {
    order_id: checkout?.order?.id,
    email: checkout?.email,
    currency: checkout?.currencyCode,
    value_cents: checkout?.totalPrice?.amount
      ? Math.round(checkout.totalPrice.amount * 100)
      : undefined,
  });
});
